import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import pool from '@/lib/db';
import { ClientLimitReachedError, createClientWithinPlan } from '@/lib/client-cap';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { extractTextFromFile, extractInvoiceFields, needsManualReview } from '@/lib/ocr-extraction';
import { saveUploadedFile, shortFileType } from '@/lib/file-storage';

// Routes an email attachment through ocr_queue exactly like ocr/route.ts's
// manual upload path now does — a low-confidence extraction (see
// needsManualReview()) used to go straight into invoices with no review
// step at all; email sync has no human even looking at the message, so
// this path is if anything more exposed to a bad extraction than the
// manual-upload one.
async function extractAndQueueInvoice(buffer: Buffer, mimeType: string, firmId: number, sourceFilename: string) {
    const text = await extractTextFromFile(buffer, mimeType);
    const fields = extractInvoiceFields(text);
    const needsReview = needsManualReview(fields);
    const invoiceNumber = fields.invoiceNumber || `EMAIL-${Date.now()}`;
    const filePath = await saveUploadedFile(buffer, sourceFilename);

    const client = await pool.connect();
    try {
        // ocr_queue.client_nip has a NOT NULL foreign key into clients(nip)
        // — a placeholder row must exist even for "NIEZNANY" (see
        // ocr/route.ts's identical comment; found the same way, via a
        // pglite test failure).
        await createClientWithinPlan(firmId, {
            nip: fields.nip,
            clientName: fields.nipMatched ? `Email Client - ${fields.nip}` : 'Nieznany klient (OCR)',
        });

        const queueRes = await client.query(
            `INSERT INTO ocr_queue (firm_id, client_nip, source_type, file_path, file_type, ocr_status, extracted_data, confidence_score)
             VALUES ($1, $2, 'email', $3, $4, $5, $6, $7) RETURNING id`,
            [
                firmId, fields.nip, filePath, shortFileType(mimeType),
                needsReview ? 'manual_review' : 'completed',
                JSON.stringify({ ...fields, invoiceNumber }),
                needsReview ? 0.3 : 0.9,
            ]
        );
        const queueId = queueRes.rows[0].id;

        if (!needsReview) {
            const firmRes = await client.query('SELECT firm_nip, firm_name FROM firms WHERE id = $1', [firmId]);
            const firm = firmRes.rows[0];
            const issueDate = new Date().toISOString();
            const ksefNumber = `EMAIL-${Math.random().toString(36).substr(2, 10).toUpperCase()}`;

            await client.query(
                `INSERT INTO invoices (
                    firm_id, invoice_number, ksef_number, client_nip, seller_nip, seller_name, buyer_nip, buyer_name,
                    issue_date, net_amount, vat_amount, gross_amount, currency, direction
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'purchase')`,
                [
                    firmId, invoiceNumber, ksefNumber, fields.nip, fields.nip, sourceFilename,
                    firm?.firm_nip || null, firm?.firm_name || 'My Firm',
                    issueDate, fields.netAmount, fields.vatAmount, fields.grossAmount, 'PLN',
                ]
            );
            await client.query(`UPDATE ocr_queue SET matched_ksef_number = $1, processed_at = NOW() WHERE id = $2`, [ksefNumber, queueId]);
        }

        return { invoice_number: invoiceNumber, gross_amount: fields.grossAmount, needsReview };
    } finally {
        client.release();
    }
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session || !session.firmId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const roleError = await requireRole(session, ['owner', 'admin', 'member']);
        if (roleError) return roleError;

        // In a real app, these would come from the Firm's DB settings, but we use hardcoded 
        // environment variables or fallback values for the MVP demo.
        const imapConfig = {
            imap: {
                user: process.env.IMAP_USER || 'faktury@example.com',
                password: process.env.IMAP_PASSWORD || 'password123',
                host: process.env.IMAP_HOST || 'imap.example.com',
                port: parseInt(process.env.IMAP_PORT || '993', 10),
                tls: true,
                authTimeout: 3000
            }
        };

        // For MVP demo purposes, if no IMAP credentials exist in env, we simulate fetching an email
        if (imapConfig.imap.user === 'faktury@example.com' || imapConfig.imap.host === 'imap.example.com') {
            return NextResponse.json({ 
                message: 'No real IMAP credentials provided in .env. Mocking successful email fetch.',
                emailsProcessed: 0,
                invoicesParsed: []
            });
        }

        const connection = await imaps.connect(imapConfig);
        await connection.openBox('INBOX');

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], struct: true, markSeen: true };
        
        const messages = await connection.search(searchCriteria, fetchOptions);
        const parsedResults = [];

        for (const message of messages) {
            const struct = message.attributes.struct as any[];
            if (!struct) continue;

            const parts = imaps.getParts(struct);
            const attachments = parts.filter((part: any) => part.disposition && part.disposition.type.toUpperCase() === 'ATTACHMENT');

            for (const attachment of attachments) {
                const partData = await connection.getPartData(message, attachment);
                let mimeType = 'application/octet-stream';
                if (attachment.subtype === 'pdf') mimeType = 'application/pdf';
                else if (attachment.subtype === 'jpeg' || attachment.subtype === 'png') mimeType = `image/${attachment.subtype}`;

                if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
                    try {
                        const buffer = Buffer.from(partData);
                        const result = await extractAndQueueInvoice(buffer, mimeType, session.firmId, "Email Sender");
                        parsedResults.push(result);
                    } catch (err) {
                        console.error('Failed to parse attachment:', err);
                    }
                }
            }
        }

        connection.end();

        return NextResponse.json({ 
            message: `Processed ${messages.length} new emails.`,
            emailsProcessed: messages.length,
            invoicesParsed: parsedResults
        });

    } catch (e: any) {
        console.error('Email Sync Error:', e);
        if (e instanceof ClientLimitReachedError) {
            return NextResponse.json({ error: e.message }, { status: 403 });
        }
        // Special mapping for connection errors clearly
        if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') {
            return NextResponse.json({ error: 'Niewłaściwe dane logowania IMAP lub serwer poczty jest niedostępny.' }, { status: 500 });
        }
        return NextResponse.json({ error: 'Failed to sync emails: ' + e.message }, { status: 500 });
    }
}
