import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import pool from '@/lib/db';
import { ClientLimitReachedError, createClientWithinPlan } from '@/lib/client-cap';
import { extractTextFromFile, extractInvoiceFields, needsManualReview } from '@/lib/ocr-extraction';
import { saveUploadedFile, shortFileType } from '@/lib/file-storage';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session || !session.firmId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const roleError = await requireRole(session, ['owner', 'admin', 'member']);
        if (roleError) return roleError;

        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'Brak pliku' }, { status: 400 });
        }
        if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Nieobsługiwany format pliku. Użyj PDF lub JPEG/PNG.' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const text = await extractTextFromFile(buffer, file.type);
        const fields = extractInvoiceFields(text);
        const needsReview = needsManualReview(fields);
        const invoiceNumber = fields.invoiceNumber || `MANUAL-${Date.now()}`;
        const filePath = await saveUploadedFile(buffer, file.name);

        const client = await pool.connect();
        try {
            // ocr_queue.client_nip has a NOT NULL foreign key into
            // clients(nip) — a placeholder client row has to exist even for
            // the "NIEZNANY" (NIP not found) case, or the insert below
            // violates that constraint. Found via a pglite test failure,
            // not live: a naive "only create a client when the NIP looks
            // real" version of this would have made every unmatched-NIP
            // scan — exactly the case meant to land in the review queue —
            // throw instead.
            await createClientWithinPlan(session.firmId, {
                nip: fields.nip,
                clientName: fields.nipMatched ? `Manual OCR Client - ${fields.nip}` : 'Nieznany klient (OCR)',
            });

            const queueRes = await client.query(
                `INSERT INTO ocr_queue (firm_id, client_nip, source_type, file_path, file_type, ocr_status, extracted_data, confidence_score)
                 VALUES ($1, $2, 'upload', $3, $4, $5, $6, $7) RETURNING id`,
                [
                    session.firmId,
                    fields.nip,
                    filePath,
                    shortFileType(file.type),
                    needsReview ? 'manual_review' : 'completed',
                    JSON.stringify({ ...fields, invoiceNumber }),
                    needsReview ? 0.3 : 0.9,
                ]
            );
            const queueId = queueRes.rows[0].id;

            // Clean extractions auto-promote straight to invoices, same as
            // before this change — a flagged one waits in the queue for a
            // human via PATCH /api/ocr-queue/[id] and touches invoices not
            // at all until then.
            if (!needsReview) {
                // firms.firm_nip, not session.firmId — the previous code
                // wrote the firm's internal integer id into buyer_nip (a
                // column meant to hold a 10-digit NIP), a bug found while
                // rewiring this route through the review queue.
                const firmRes = await client.query('SELECT firm_nip, firm_name FROM firms WHERE id = $1', [session.firmId]);
                const firm = firmRes.rows[0];
                const issueDate = new Date().toISOString();
                const ksefNumber = `OCR-${Math.random().toString(36).substr(2, 10).toUpperCase()}`;

                await client.query(
                    `INSERT INTO invoices (
                        firm_id, invoice_number, ksef_number, client_nip, seller_nip, seller_name, buyer_nip, buyer_name,
                        issue_date, net_amount, vat_amount, gross_amount, currency, direction
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'purchase')`,
                    [
                        session.firmId, invoiceNumber, ksefNumber, fields.nip, fields.nip, 'OCR Vendor',
                        firm?.firm_nip || null, firm?.firm_name || 'My Firm',
                        issueDate, fields.netAmount, fields.vatAmount, fields.grossAmount, 'PLN',
                    ]
                );
                await client.query(`UPDATE ocr_queue SET matched_ksef_number = $1, processed_at = NOW() WHERE id = $2`, [ksefNumber, queueId]);
            }

            return NextResponse.json({
                success: true,
                needsReview,
                extracted: { nip: fields.nip, invoice_number: invoiceNumber, net_amount: fields.netAmount, vat_amount: fields.vatAmount, gross_amount: fields.grossAmount },
            });
        } finally {
            client.release();
        }
    } catch (e: any) {
        console.error('OCR Error:', e);
        if (e instanceof ClientLimitReachedError) {
            return NextResponse.json({ error: e.message }, { status: 403 });
        }
        return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
    }
}
