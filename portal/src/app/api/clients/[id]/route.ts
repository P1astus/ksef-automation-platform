import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const clientRes = await query(
        `SELECT c.*,
            (SELECT COUNT(*) FROM invoices i WHERE i.client_nip = c.nip AND i.firm_id = c.firm_id) as invoice_count,
            (SELECT COUNT(*) FROM invoices i WHERE i.client_nip = c.nip AND i.firm_id = c.firm_id AND i.direction = 'sales') as sales_count,
            (SELECT COUNT(*) FROM invoices i WHERE i.client_nip = c.nip AND i.firm_id = c.firm_id AND i.direction = 'purchase') as purchase_count,
            (SELECT SUM(gross_amount) FROM invoices i WHERE i.client_nip = c.nip AND i.firm_id = c.firm_id AND i.direction = 'sales') as total_sales,
            (SELECT SUM(gross_amount) FROM invoices i WHERE i.client_nip = c.nip AND i.firm_id = c.firm_id AND i.direction = 'purchase') as total_purchases
         FROM clients c
         WHERE c.id = $1 AND c.firm_id = $2`,
        [id, session.firmId]
    );

    if (!clientRes.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const invoicesRes = await query(
        `SELECT id, invoice_number, ksef_number, issue_date, direction,
                seller_name, buyer_name, gross_amount, currency, processing_status
         FROM invoices
         WHERE client_nip = $1 AND firm_id = $2
         ORDER BY created_at DESC
         LIMIT 20`,
        [clientRes.rows[0].nip, session.firmId]
    );

    return NextResponse.json({
        client: clientRes.rows[0],
        recentInvoices: invoicesRes.rows,
    });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;

    const { id } = await params;
    const body = await request.json();

    const check = await query('SELECT id FROM clients WHERE id = $1 AND firm_id = $2', [id, session.firmId]);
    if (!check.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (typeof body.sync_enabled === 'boolean') {
        await query('UPDATE clients SET sync_enabled = $1 WHERE id = $2', [body.sync_enabled, id]);
    }

    // CRM + address fields update
    const crmFields = ['contact_person', 'contact_email', 'contact_phone', 'notes', 'tags', 'street', 'city', 'postal_code'] as const;
    const crmUpdates = crmFields.filter(f => f in body);
    if (crmUpdates.length > 0) {
        const sets = crmUpdates.map((f, i) => `${f} = $${i + 1}`).join(', ');
        const values = crmUpdates.map(f => body[f]);
        values.push(id);
        await query(`UPDATE clients SET ${sets} WHERE id = $${values.length}`, values);
    }

    return NextResponse.json({ success: true });
}
