import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendReceivablesDigest } from '@/lib/email';
import { safeEqual } from '@/lib/auth';

// Called weekly by workflows/09-client-notifications.json. Same shared-
// secret pattern as digest/route.ts and notify/offline24/route.ts.
//
// Informational only — a periodic summary of the client's own overdue
// receivables, sent to clients.contact_email. Deliberately not a dunning
// notice to the invoice's buyer: buyer_nip/buyer_name are free-text with no
// captured contact info anywhere in the schema, so there's nothing to email
// them at without adding new data collection (a real, separate feature).
export async function POST(request: Request) {
    const auth = request.headers.get('Authorization');
    const secret = process.env.NOTIFY_SECRET;
    if (secret && !safeEqual(auth || '', `Bearer ${secret}`)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const overdue = await query(`
        SELECT c.id AS client_id, c.contact_email, c.client_name,
               i.invoice_number, i.gross_amount, i.due_date
        FROM invoices i
        JOIN clients c ON i.client_nip = c.nip AND i.firm_id = c.firm_id
        WHERE i.direction = 'sales' AND i.payment_status = 'unpaid'
          AND i.due_date IS NOT NULL AND i.due_date < NOW()
          AND c.contact_email IS NOT NULL
        ORDER BY c.id, i.due_date ASC
    `);

    const byClient = new Map<number, { contact_email: string; client_name: string; invoices: { invoice_number: string; gross_amount: string; due_date: string }[] }>();
    for (const row of overdue.rows) {
        if (!byClient.has(row.client_id)) {
            byClient.set(row.client_id, { contact_email: row.contact_email, client_name: row.client_name, invoices: [] });
        }
        byClient.get(row.client_id)!.invoices.push({
            invoice_number: row.invoice_number,
            gross_amount: row.gross_amount,
            due_date: row.due_date,
        });
    }

    let sent = 0;
    for (const client of byClient.values()) {
        try {
            await sendReceivablesDigest(client.contact_email, client.client_name, client.invoices);
            sent++;
        } catch { /* best-effort - next week's run retries */ }
    }

    return NextResponse.json({ ok: true, sent, clientsWithOverdue: byClient.size });
}
