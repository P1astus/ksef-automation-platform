import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // Ownership check directly against invoices.firm_id, matching every
    // other per-invoice route (xml, download, payment) — see those for why
    // a client_nip join alone isn't safe post-tenancy-fix.
    const res = await query(
        `SELECT upo_xml, upo_retrieved_at, ksef_number
         FROM invoices WHERE id = $1 AND firm_id = $2`,
        [id, session.firmId]
    );

    if (!res.rows[0]) return NextResponse.json({ error: 'Faktura nie znaleziona' }, { status: 404 });
    const { upo_xml, upo_retrieved_at, ksef_number } = res.rows[0];

    if (!upo_xml) {
        return NextResponse.json(
            { error: ksef_number ? 'UPO jeszcze niedostępne — spróbuj ponownie za chwilę' : 'Faktura nie została jeszcze wysłana do KSeF' },
            { status: 404 }
        );
    }

    return NextResponse.json({ upoXml: upo_xml, retrievedAt: upo_retrieved_at });
}
