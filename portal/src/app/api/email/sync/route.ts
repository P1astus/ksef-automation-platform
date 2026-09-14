import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import pool from '@/lib/db';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { recognize } from 'tesseract.js';

// MVP Extractor Helper
async function extractAndSaveInvoice(buffer: Buffer, mimeType: string, firmId: number, sourceName: string) {
    let text = '';
    if (mimeType === 'application/pdf') {
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(buffer);
        text = pdfData.text;
    } else if (mimeType.startsWith('image/')) {
        const { data } = await recognize(buffer, 'pol');
        text = data.text;
    } else {
        throw new Error('Unsupported format');
    }

    const cleanText = text.replace(/\s+/g, ' ');
    const nipMatch = cleanText.match(/(?:NIP|NIP:|NIP\s*:)?\s*([0-9]{3}[\s-]?[0-9]{3}[\s-]?[0-9]{2}[\s-]?[0-9]{2})/i);
    const nip = nipMatch ? nipMatch[1].replace(/[\s-]/g, '') : 'NIEZNANY';

    const invMatch = cleanText.match(/(?:Faktura\sVAT\snr|Faktura\snr|FV|Faktura\s+Nr)\s*:?\s*([A-Za-z0-9/\-]+)/i);
    const invoice_number = invMatch ? invMatch[1] : `EMAIL-${Date.now()}`;

    let gross_amount = 0.00;
    let net_amount = 0.00;
    let vat_amount = 0.00;
    
    const moneyMatches = cleanText.match(/\d+[.,]\d{2}/g);
    if (moneyMatches && moneyMatches.length > 0) {
        const numbers = moneyMatches.map(m => parseFloat(m.replace(',', '.')));
        numbers.sort((a,b) => b - a);
        gross_amount = numbers[0];
        net_amount = Number((gross_amount / 1.23).toFixed(2));
        vat_amount = Number((gross_amount - net_amount).toFixed(2));
    }

    const client = await pool.connect();
    try {
        let clientRes = await client.query('SELECT nip FROM clients WHERE firm_id = $1 AND nip = $2', [firmId, nip]);
        if (clientRes.rows.length === 0) {
            await client.query(
                'INSERT INTO clients (firm_id, nip, client_name) VALUES ($1, $2, $3)',
                [firmId, nip, `Email Client - ${nip}`]
            );
        }

        const issueDate = new Date().toISOString(); 
        const defaultKsef = `EMAIL-${Math.random().toString(36).substr(2, 10).toUpperCase()}`;

        await client.query(`
            INSERT INTO invoices (
                firm_id, invoice_number, ksef_number, client_nip, seller_nip, seller_name, buyer_nip, buyer_name,
                issue_date, net_amount, vat_amount, gross_amount, currency, direction
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
            firmId, invoice_number, defaultKsef, nip, nip, sourceName, firmId, `My Firm`, issueDate, net_amount, vat_amount, gross_amount, 'PLN', 'purchase'
        ]);

        return { invoice_number, gross_amount };
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
                        const result = await extractAndSaveInvoice(buffer, mimeType, session.firmId, "Email Sender");
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
        // Special mapping for connection errors clearly
        if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') {
            return NextResponse.json({ error: 'Niewłaściwe dane logowania IMAP lub serwer poczty jest niedostępny.' }, { status: 500 });
        }
        return NextResponse.json({ error: 'Failed to sync emails: ' + e.message }, { status: 500 });
    }
}
