import { determineJpkStatus, generateJpkV7M, type JpkInvoiceRow } from '@/lib/jpk-generator';
import { sendMail } from '@/lib/mail-transport';
import type { Job, JobFailure, JobResult } from './types';

type Client = {
    firm_id: number;
    client_nip: string;
    client_name: string;
    tax_office_code: string | null;
    contact_email: string | null;
    taxpayer_type: 'company' | 'individual' | null;
    first_name: string | null;
    last_name: string | null;
    birth_date: string | Date | null;
    firm_name: string;
    accountant_email: string;
};

function abortIfNeeded(signal: AbortSignal) {
    if (!signal.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function preparationPeriod(now: Date): { period: string; start: string; end: string } {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now).map(part => [part.type, part.value]));
    let year = Number(parts.year);
    let month = Number(parts.month);
    if (Number(parts.day) === 5) {
        month--;
        if (month === 0) { year--; month = 12; }
    }
    const mm = String(month).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { period: `${year}-${mm}`, start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

function csvCell(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function dateCell(value: string | Date | null | undefined): string {
    if (!value) return '';
    if (value instanceof Date) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    return String(value).slice(0, 10);
}

function csvReport(invoices: JpkInvoiceRow[]): string {
    const header = ['Numer_faktury', 'Data', 'NIP_kontrahenta', 'Kwota_netto', 'Kwota_VAT', 'Kwota_brutto', 'NrKSeF', 'OFF', 'BFK', 'DI', 'Numer_KSeF'];
    const rows = invoices.map(invoice => {
        const nip = invoice.direction === 'sales' ? invoice.buyer_nip : invoice.seller_nip;
        return [
            invoice.invoice_number, dateCell(invoice.issue_date), nip ?? '',
            Number(invoice.net_amount || 0).toFixed(2), Number(invoice.vat_amount || 0).toFixed(2), Number(invoice.gross_amount || 0).toFixed(2),
            invoice.ksef_number ? 'TAK' : '', invoice.jpk_marker === 'OFF' ? 'TAK' : '',
            invoice.jpk_marker === 'BFK' ? 'TAK' : '', invoice.jpk_marker === 'DI' ? 'TAK' : '', invoice.ksef_number ?? '',
        ].map(csvCell).join(';');
    });
    return `\uFEFF${[header.join(';'), ...rows].join('\r\n')}\r\n`;
}

export const jpkPreparationJob: Job = {
    name: 'jpk-preparation',
    schedule: { kind: 'cron', expr: '0 8 5 * *', timezone: 'Europe/Warsaw' },
    timeoutMs: 60 * 60_000,
    maxAttempts: 3,
    lookbackMinutes: 2880,
    // IDEMPOTENCY BOUNDARY: UNIQUE (firm_id, client_nip, period) makes the preparation an upsert. There is no mail
    // delivery marker in the current schema, so a crash after SMTP acceptance can repeat the attachment on retry.
    async run(ctx): Promise<JobResult> {
        abortIfNeeded(ctx.signal);
        const { period, start, end } = preparationPeriod(ctx.now());
        const clients = await ctx.db.query(
            `SELECT DISTINCT i.firm_id, i.client_nip, c.client_name, c.tax_office_code, c.contact_email,
                    c.taxpayer_type, c.first_name, c.last_name, c.birth_date,
                    f.firm_name, f.admin_email AS accountant_email
               FROM invoices i
               JOIN clients c ON c.nip = i.client_nip AND c.firm_id = i.firm_id
               JOIN firms f ON f.id = i.firm_id
              WHERE i.jpk_period = $1 OR (i.jpk_period IS NULL AND i.issue_date BETWEEN $2 AND $3)
              ORDER BY c.client_name`,
            [period, start, end]
        );

        let processed = 0;
        let skipped = 0;
        const failures: JobFailure[] = [];
        for (const client of clients.rows as Client[]) {
            abortIfNeeded(ctx.signal);
            try {
                const invoiceResult = await ctx.db.query(
                    `SELECT i.id, i.invoice_number, i.issue_date, i.seller_name, i.seller_nip, i.buyer_name, i.buyer_nip,
                            i.net_amount, i.vat_amount, i.gross_amount, i.direction,
                            i.jpk_marker, i.jpk_period, i.jpk_correction_needed, i.ksef_number,
                            i.cost_category, i.invoice_lines, i.jpk_gtu, i.jpk_procedures, i.jpk_doc_type, i.jpk_import,
                            i.delivery_date, i.ksef_acquisition_date, i.jpk_counterparty_country, i.jpk_margin_gross,
                            i.jpk_margin_taxable_gross, i.jpk_margin_vat_rate, i.jpk_margin_method,
                            original.invoice_lines AS corrected_original_lines
                       FROM invoices i
                       LEFT JOIN invoices original ON original.id = i.corrects_invoice_id AND original.firm_id = i.firm_id
                      WHERE i.client_nip = $1 AND i.firm_id = $2
                        AND (i.jpk_period = $3 OR (i.jpk_period IS NULL AND i.issue_date BETWEEN $4 AND $5))
                      ORDER BY i.issue_date, i.id`,
                    [client.client_nip, client.firm_id, period, start, end]
                );
                const invoices = invoiceResult.rows as JpkInvoiceRow[];
                const xml = generateJpkV7M({
                    nip: client.client_nip, name: client.client_name || client.firm_name,
                    taxOfficeCode: client.tax_office_code, email: client.contact_email,
                    taxpayerType: client.taxpayer_type, firstName: client.first_name,
                    lastName: client.last_name, birthDate: client.birth_date,
                }, period, invoices);
                const status = determineJpkStatus(invoices);
                const stats = {
                    total: invoices.length,
                    nrKsef: invoices.filter(i => Boolean(i.ksef_number)).length,
                    off: invoices.filter(i => !i.ksef_number && i.jpk_marker === 'OFF').length,
                    bfk: invoices.filter(i => !i.ksef_number && i.jpk_marker === 'BFK').length,
                    di: invoices.filter(i => !i.ksef_number && i.jpk_marker === 'DI').length,
                };
                const csv = csvReport(invoices);
                if (ctx.shadow) {
                    processed++;
                    skipped++;
                    continue;
                }
                abortIfNeeded(ctx.signal);
                await ctx.db.query(
                    `INSERT INTO jpk_preparations
                        (firm_id, client_nip, period, export_data, status, total_invoices, nr_ksef_count, off_count, bfk_count, di_count, generated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                     ON CONFLICT (firm_id, client_nip, period) DO UPDATE SET
                        export_data = EXCLUDED.export_data, status = EXCLUDED.status,
                        total_invoices = EXCLUDED.total_invoices, nr_ksef_count = EXCLUDED.nr_ksef_count,
                        off_count = EXCLUDED.off_count, bfk_count = EXCLUDED.bfk_count,
                        di_count = EXCLUDED.di_count, generated_at = NOW()`,
                    [client.firm_id, client.client_nip, period, xml, status, stats.total, stats.nrKsef, stats.off, stats.bfk, stats.di]
                );
                abortIfNeeded(ctx.signal);
                await sendMail({
                    to: client.accountant_email,
                    subject: `JPK_VAT ${period} — ${client.client_name}`,
                    html: `<p>Przygotowano JPK_VAT za <strong>${period}</strong> dla klienta <strong>${client.client_name}</strong>.</p><p>Status: ${status}. Faktury: ${stats.total}.</p>`,
                    attachments: [{
                        filename: `JPK_VAT_${client.client_nip}_${period}.csv`,
                        content: Buffer.from(csv, 'utf8'),
                        contentType: 'text/csv; charset=utf-8',
                    }],
                });
                processed++;
            } catch (error) {
                abortIfNeeded(ctx.signal);
                failures.push({
                    subject: `JPK preparation for ${client.client_name} (${client.client_nip})`,
                    error: error instanceof Error ? error.message : String(error),
                    firmId: client.firm_id,
                    clientNip: client.client_nip,
                });
            }
        }
        return { processed, skipped, failures, detail: { period, clients: clients.rows.length } };
    },
};
