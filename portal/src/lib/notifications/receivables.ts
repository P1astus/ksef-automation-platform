import { sendReceivablesDigest } from '@/lib/email';
import type { JobFailure, JobResult } from '@/lib/jobs/types';
import type { NotificationRunContext } from './offline24';

type Invoice = { invoice_number: string; gross_amount: string; due_date: string };
type ClientDigest = {
    firmId: number;
    clientNip: string;
    contactEmail: string;
    clientName: string;
    invoices: Invoice[];
};

function abortIfNeeded(signal: AbortSignal) {
    if (!signal.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

export async function notifyReceivables(ctx: NotificationRunContext): Promise<JobResult & { detail: { clientsWithOverdue: number } }> {
    abortIfNeeded(ctx.signal);
    const overdue = await ctx.db.query(
        `SELECT c.id AS client_id, c.firm_id, c.nip AS client_nip, c.contact_email, c.client_name,
                i.invoice_number, i.gross_amount, i.due_date
           FROM invoices i
           JOIN clients c ON i.client_nip = c.nip AND i.firm_id = c.firm_id
          WHERE i.direction = 'sales' AND i.payment_status = 'unpaid'
            AND i.due_date IS NOT NULL AND i.due_date < NOW()
            AND c.contact_email IS NOT NULL
          ORDER BY c.id, i.due_date ASC`
    );

    const byClient = new Map<number, ClientDigest>();
    for (const row of overdue.rows) {
        if (!byClient.has(row.client_id)) {
            byClient.set(row.client_id, {
                firmId: row.firm_id, clientNip: row.client_nip,
                contactEmail: row.contact_email, clientName: row.client_name, invoices: [],
            });
        }
        byClient.get(row.client_id)!.invoices.push({
            invoice_number: row.invoice_number, gross_amount: row.gross_amount, due_date: row.due_date,
        });
    }

    let processed = 0;
    let skipped = 0;
    const failures: JobFailure[] = [];
    for (const client of byClient.values()) {
        abortIfNeeded(ctx.signal);
        if (ctx.shadow) {
            processed++;
            skipped++;
            continue;
        }
        try {
            await sendReceivablesDigest(client.contactEmail, client.clientName, client.invoices);
            processed++;
        } catch (error) {
            abortIfNeeded(ctx.signal);
            failures.push({
                subject: `receivables digest for ${client.clientName}`,
                error: error instanceof Error ? error.message : String(error),
                firmId: client.firmId,
                clientNip: client.clientNip,
            });
        }
    }
    return { processed, skipped, failures, detail: { clientsWithOverdue: byClient.size } };
}
