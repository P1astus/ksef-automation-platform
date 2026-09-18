import { NextResponse } from 'next/server';
import { requireFeature } from '@/lib/entitlements';
import { getSession } from '@/lib/auth';
import pool from '@/lib/db';
import { generateOptimaXml, OptimaExportError } from '@/lib/optima-mapper';
import { generateSymfoniaTxt } from '@/lib/symfonia-mapper';
import { generateInsertEpp } from '@/lib/insert-mapper';
import { logActivity } from '@/lib/activity';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const planError = await requireFeature(session.firmId, 'exports');
        if (planError) return planError;

        const body = await request.json();
        const invoiceIds = body.invoiceIds;
        const system = body.system || 'optima';

        if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
            return NextResponse.json({ error: 'No invoice IDs provided' }, { status: 400 });
        }

        // Connect to DB and fetch the selected invoices
        const client = await pool.connect();
        try {
            // Ensure the firm only exports their own invoices - filtered directly
            // on invoices.firm_id, not via a clients join on client_nip (a NIP can
            // now belong to more than one firm, so that join alone isn't safe)
            const query = `
        SELECT i.*
        FROM invoices i
        WHERE i.id = ANY($1::int[]) AND i.firm_id = $2
      `;
            const result = await client.query(query, [invoiceIds, session.firmId]);

            const invoices = result.rows;
            if (invoices.length === 0) {
                return NextResponse.json({ error: 'No matching invoices found or access denied' }, { status: 403 });
            }

            let exportData = '';
            let contentType = 'application/xml';
            let filename = 'export.xml';

            if (system === 'csv') {
                const headers = [
                    'Data wystawienia', 'Nr faktury', 'Nr KSeF', 'Klient (NIP)',
                    'Sprzedawca', 'NIP sprzedawcy', 'Nabywca', 'NIP nabywcy',
                    'Kierunek', 'Kwota netto', 'Kwota VAT', 'Kwota brutto', 'Waluta',
                ];
                const escape = (v: unknown) => {
                    const s = v == null ? '' : String(v);
                    return s.includes(',') || s.includes('"') || s.includes('\n')
                        ? `"${s.replace(/"/g, '""')}"` : s;
                };
                const rows = invoices.map(i => [
                    i.issue_date ? new Date(i.issue_date).toLocaleDateString('pl-PL') : '',
                    i.invoice_number || '',
                    i.ksef_number || '',
                    i.client_nip || '',
                    i.seller_name || '',
                    i.seller_nip || '',
                    i.buyer_name || '',
                    i.buyer_nip || '',
                    i.direction === 'sales' ? 'Sprzedaż' : 'Zakup',
                    i.net_amount != null ? Number(i.net_amount).toFixed(2) : '',
                    i.vat_amount != null ? Number(i.vat_amount).toFixed(2) : '',
                    i.gross_amount != null ? Number(i.gross_amount).toFixed(2) : '',
                    i.currency || 'PLN',
                ].map(escape).join(','));
                exportData = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
                contentType = 'text/csv; charset=utf-8';
                filename = 'faktury-export.csv';
            } else if (system === 'symfonia') {
                exportData = generateSymfoniaTxt(invoices);
                contentType = 'text/plain; charset=utf-8';
                filename = 'symfonia-export.txt';
            } else if (system === 'insert') {
                exportData = generateInsertEpp(invoices);
                contentType = 'text/plain; charset=utf-8';
                filename = 'insert-export.epp';
            } else {
                exportData = generateOptimaXml(invoices).xml;
                contentType = 'application/xml';
                filename = 'optima-export.xml';
            }

            const formatLabel: Record<string, string> = { csv: 'CSV', symfonia: 'Symfonia TXT', insert: 'INSERT EPP', optima: 'Optima XML' };
            await logActivity(session.firmId, 'export', `Eksport ${formatLabel[system] || system} — ${invoices.length} faktur`);

            // Return the payload as a downloadable file
            return new NextResponse(exportData, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Disposition': `attachment; filename="${filename}"`
                }
            });

        } finally {
            client.release();
        }
    } catch (error) {
        if (error instanceof OptimaExportError) {
            return NextResponse.json({ error: error.message, failures: error.failures }, { status: 422 });
        }
        console.error('Error exporting invoices:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
