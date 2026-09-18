import { NextResponse } from 'next/server';
import { requireActiveSubscription } from '@/lib/entitlements';
import { getSession, requireRole } from '@/lib/auth';
import pool from '@/lib/db';
import { ClientLimitReachedError, createClientWithinPlan } from '@/lib/client-cap';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { extractTextFromFile, extractInvoiceFields, needsManualReview } from '@/lib/ocr-extraction';
import { saveUploadedFile, shortFileType } from '@/lib/file-storage';
import { decryptSecret } from '@/lib/credential-crypto';

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
        const planError = await requireActiveSubscription(session.firmId);
        if (planError) return planError;

        const settings = await pool.query(
            `SELECT host, port, username, password_encrypted, use_tls, mailbox
             FROM firm_imap_settings WHERE firm_id = $1`,
            [session.firmId]
        );
        const mailbox = settings.rows[0];
        if (!mailbox) {
            return NextResponse.json(
                { error: 'Skonfiguruj skrzynkę IMAP w ustawieniach tego biura przed synchronizacją.' },
                { status: 503 }
            );
        }
        const imapConfig = {
            imap: {
                user: mailbox.username,
                password: decryptSecret(mailbox.password_encrypted, `firm:${session.firmId}:imap-password`),
                host: mailbox.host,
                port: mailbox.port,
                tls: mailbox.use_tls,
                authTimeout: 3000
            }
        };

        const connection = await imaps.connect(imapConfig);
        await connection.openBox(mailbox.mailbox);

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], struct: true, markSeen: false };
        
        const messages = await connection.search(searchCriteria, fetchOptions);
        const parsedResults = [];

        for (const message of messages) {
            let messageFailed = false;
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
                        messageFailed = true;
                    }
                }
            }
            // Do not drain another firm's or a transiently failing message.
            // Each firm has its own mailbox settings; a message is marked seen
            // only after every relevant attachment was handled successfully.
            if (!messageFailed && message.attributes?.uid) {
                await connection.addFlags(message.attributes.uid, '\\Seen');
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
