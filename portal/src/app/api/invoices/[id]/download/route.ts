import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await getSession();
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // Fetch invoice — verify firm ownership via JOIN
        const res = await query(`
            SELECT i.ksef_number, i.invoice_number, i.raw_xml
            FROM invoices i
            JOIN clients c ON i.client_nip = c.nip
            WHERE i.id = $1 AND c.firm_id = $2
        `, [id, session.firmId]);

        if (res.rows.length === 0) {
            return NextResponse.json({ error: 'Faktura nie znaleziona' }, { status: 404 });
        }

        const invoice = res.rows[0];

        // If no XML cached yet, tell the user clearly
        if (!invoice.raw_xml) {
            return NextResponse.json({
                error: 'XML tej faktury nie został jeszcze pobrany przez system. Poczekaj na kolejny cykl synchronizacji n8n (co 30 min).'
            }, { status: 404 });
        }

        const filename = `${invoice.invoice_number || invoice.ksef_number}.xml`
            .replace(/[/\\:*?"<>|]/g, '_');

        return new NextResponse(invoice.raw_xml, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Download error:', msg);
        return NextResponse.json({ error: `Błąd pobierania: ${msg}` }, { status: 500 });
    }
}
