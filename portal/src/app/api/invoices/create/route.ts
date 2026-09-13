import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { buildKSeFInvoiceXml } from '@/lib/ksef-invoice-builder';
import type { InvoiceLine } from '@/lib/ksef-invoice-builder';

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { clientId, invoiceNumber, issueDate, dueDate, buyerNip, buyerName, lines, totals } = body;

    if (!clientId || !invoiceNumber || !issueDate || !buyerNip || !buyerName || !lines?.length) {
        return NextResponse.json({ error: 'Brakujące dane faktury' }, { status: 400 });
    }

    // Verify client belongs to firm + get seller NIP
    const clientRes = await query(
        'SELECT id, nip, client_name FROM clients WHERE id = $1 AND firm_id = $2',
        [clientId, session.firmId]
    );
    if (!clientRes.rows[0]) return NextResponse.json({ error: 'Klient nie znaleziony' }, { status: 404 });
    const client = clientRes.rows[0];

    // Also get firm data for seller info
    const firmRes = await query('SELECT firm_name FROM firms WHERE id = $1', [session.firmId]);
    const firmName = firmRes.rows[0]?.firm_name || '';

    // Build XML
    const xml = buildKSeFInvoiceXml({
        invoiceNumber,
        issueDate,
        dueDate: dueDate || undefined,
        seller: { nip: client.nip, name: client.client_name || firmName },
        buyer: { nip: buyerNip, name: buyerName },
        lines: lines as InvoiceLine[],
    });

    // Insert invoice record
    const insertRes = await query(
        `INSERT INTO invoices
         (firm_id, client_nip, invoice_number, seller_name, buyer_name, buyer_nip,
          net_amount, vat_amount, gross_amount, issue_date, due_date,
          direction, processing_status, invoice_lines, raw_xml)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sales','new',$12,$13)
         RETURNING id`,
        [
            session.firmId,
            client.nip,
            invoiceNumber,
            client.client_name || firmName,
            buyerName,
            buyerNip,
            totals.totalNet,
            totals.totalVat,
            totals.totalGross,
            issueDate,
            dueDate || null,
            JSON.stringify(lines),
            xml,
        ]
    );

    const invoiceId = insertRes.rows[0]?.id;
    await logActivity(session.firmId, 'invoice_created', `Wystawiono fakturę: ${invoiceNumber} dla ${buyerName}`);

    return NextResponse.json({ id: invoiceId, ok: true });
}
