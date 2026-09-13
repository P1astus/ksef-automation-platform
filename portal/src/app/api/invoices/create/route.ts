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
    const { clientId, invoiceNumber, issueDate, dueDate, buyerNip, buyerName, lines, totals, offlineMode } = body;

    if (!clientId || !invoiceNumber || !issueDate || !buyerNip || !buyerName || !lines?.length) {
        return NextResponse.json({ error: 'Brakujące dane faktury' }, { status: 400 });
    }

    const OFFLINE_MODES = ['offline24', 'unavailability', 'emergency', 'total_outage'];
    if (offlineMode !== undefined && offlineMode !== null && !OFFLINE_MODES.includes(offlineMode)) {
        return NextResponse.json({ error: `Nieprawidłowy tryb offline: ${offlineMode}` }, { status: 400 });
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

    // Offline24: the invoice is issued now but KSeF wasn't reachable, so the
    // compliance clock (upload_deadline, escalating alerts) starts here. The
    // deadline is the end of the next business day after issueDate - per
    // CLAUDE.md's rule, computed via next_business_day(), never ad-hoc JS
    // date math, since it has to account for weekends and Polish holidays
    // (business_days table). offline_invoices is what
    // 05-offline24-monitor.json exclusively queries; invoice_id links back
    // here so the offline queue can display real invoice data without
    // duplicating it onto offline_invoices itself.
    if (offlineMode) {
        await query(
            `INSERT INTO offline_invoices
             (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline, invoice_id)
             VALUES ($1, $2, $3, $4, NOW(), (next_business_day($5::date) + INTERVAL '1 day' - INTERVAL '1 second'), $6)`,
            [session.firmId, client.nip, invoiceNumber, offlineMode, issueDate, invoiceId]
        );
    }

    return NextResponse.json({ id: invoiceId, ok: true });
}
