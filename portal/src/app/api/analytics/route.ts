import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request) {
    const session = await getSession();
    if (!session || !session.firmId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Find current month's invoices for the firm
        // Since we are assuming PostgreSQL
        const currentMonthRes = await query(`
            SELECT direction, SUM(net_amount) as net_sum, SUM(vat_amount) as vat_sum, SUM(gross_amount) as gross_sum
            FROM invoices i
            WHERE i.firm_id = $1
              AND EXTRACT(MONTH FROM i.issue_date) = EXTRACT(MONTH FROM CURRENT_DATE)
              AND EXTRACT(YEAR FROM i.issue_date) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY direction
        `, [session.firmId]);

        let salesNet = 0;
        let salesVat = 0;
        let purchaseNet = 0;
        let purchaseVat = 0;

        currentMonthRes.rows.forEach(row => {
            if (row.direction === 'sales') {
                salesNet = parseFloat(row.net_sum || '0');
                salesVat = parseFloat(row.vat_sum || '0');
            } else if (row.direction === 'purchase') {
                purchaseNet = parseFloat(row.net_sum || '0');
                purchaseVat = parseFloat(row.vat_sum || '0');
            }
        });

        const estimatedVatLiability = salesVat - purchaseVat;
        // D6: an income tax estimate used to be computed here as a flat 19%
        // of (salesNet - purchaseNet), assuming every client is on liniowy.
        // Clients can be on skala (12/32%), liniowy (19%), ryczałt (varies)
        // or CIT - removed rather than guessed. Comes back once a per-client
        // tax regime exists (clients.tax_regime + a rate column, default
        // NULL, estimate only returned when the regime is set).

        return NextResponse.json({
            currentMonth: {
                sales: { net: salesNet, vat: salesVat, gross: salesNet + salesVat },
                purchases: { net: purchaseNet, vat: purchaseVat, gross: purchaseNet + purchaseVat },
                estimates: {
                    vatLiability: estimatedVatLiability,
                }
            }
        });

    } catch (e: any) {
        console.error('Analytics API Error:', e);
        return NextResponse.json({ error: 'Failed to fetch analytics data' }, { status: 500 });
    }
}
