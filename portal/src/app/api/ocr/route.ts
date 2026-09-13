import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import pool from '@/lib/db';
import { recognize } from 'tesseract.js';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session || !session.firmId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File;
        
        if (!file) {
            return NextResponse.json({ error: 'Brak pliku' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        let text = '';

        if (file.type === 'application/pdf') {
            const pdfParse = require('pdf-parse');
            const pdfData = await pdfParse(buffer);
            text = pdfData.text;
        } else if (file.type.startsWith('image/')) {
            const { data } = await recognize(buffer, 'pol');
            text = data.text;
        } else {
            return NextResponse.json({ error: 'Nieobsługiwany format pliku. Użyj PDF lub JPEG/PNG.' }, { status: 400 });
        }

        // --- Basic Regex Extractors for MVP ---
        // Clean up the text for easier matching
        const cleanText = text.replace(/\s+/g, ' ');
        
        // NIP matcher (looks for NIP keywords, ignores hyphens temporarily)
        const nipRegex = /(?:NIP|NIP:|NIP\s*:)?\s*([0-9]{3}[\s-]?[0-9]{3}[\s-]?[0-9]{2}[\s-]?[0-9]{2})/i;
        const nipMatch = cleanText.match(nipRegex);
        const nip = nipMatch ? nipMatch[1].replace(/[\s-]/g, '') : 'NIEZNANY';

        // Invoice Number finder (Faktura VAT nr ..., FV ...)
        const invRegex = /(?:Faktura\sVAT\snr|Faktura\snr|FV|Faktura\s+Nr)\s*:?\s*([A-Za-z0-9/\-]+)/i;
        const invMatch = cleanText.match(invRegex);
        const invoice_number = invMatch ? invMatch[1] : `MANUAL-${Date.now()}`;

        // Simple money extractors (Assuming "Do zapłaty: 123,45 PLN" or "Brutto: 123.45")
        // Just look for the largest number near 'Brutto' or 'Razem' or 'Do zapłaty'
        let gross_amount = 0.00;
        let net_amount = 0.00;
        let vat_amount = 0.00;
        
        const moneyMatches = cleanText.match(/\d+[.,]\d{2}/g);
        if (moneyMatches && moneyMatches.length > 0) {
            const numbers = moneyMatches.map(m => parseFloat(m.replace(',', '.')));
            numbers.sort((a,b) => b - a);
            // The largest number on an invoice is usually the Gross (Brutto)
            gross_amount = numbers[0];
            // Infer Netto assuming 23% VAT for MVP defaults
            net_amount = Number((gross_amount / 1.23).toFixed(2));
            vat_amount = Number((gross_amount - net_amount).toFixed(2));
        }

        // --- Save to Database ---
        const client = await pool.connect();
        try {
            // Check if client exists, if not, create a fallback
            let clientRes = await client.query('SELECT nip FROM clients WHERE firm_id = $1 AND nip = $2', [session.firmId, nip]);
            if (clientRes.rows.length === 0) {
                await client.query(
                    'INSERT INTO clients (firm_id, nip, client_name) VALUES ($1, $2, $3)',
                    [session.firmId, nip, `Manual OCR Client - ${nip}`]
                );
            }

            const issueDate = new Date().toISOString(); 
            const defaultKsef = `OCR-${Math.random().toString(36).substr(2, 10).toUpperCase()}`; // Mock KSeF number since it doesn't have one

            // Save the invoice to the DB
            await client.query(`
                INSERT INTO invoices (
                    invoice_number, ksef_number, client_nip, seller_nip, seller_name, buyer_nip, buyer_name,
                    issue_date, net_amount, vat_amount, gross_amount, currency, direction
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                invoice_number,
                defaultKsef,
                nip, // Associate with this client
                nip, // Assume it's a purchase from them for MVP manual uploads
                `OCR Vendor`,
                session.firmId, // Assume we bought it
                `My Firm`,
                issueDate,
                net_amount,
                vat_amount,
                gross_amount,
                'PLN',
                'purchase'
            ]);

            return NextResponse.json({
                success: true,
                extracted: {
                    nip,
                    invoice_number,
                    net_amount,
                    vat_amount,
                    gross_amount
                }
            });

        } finally {
            client.release();
        }

    } catch (e: any) {
        console.error('OCR Error:', e);
        return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
    }
}
