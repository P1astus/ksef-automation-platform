import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { requireActiveSubscription } from '@/lib/entitlements';
import { isValidTaxOfficeCode } from '@/lib/tax-office-codes';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const clientRes = await query(
        `SELECT c.id, c.client_name, c.nip, c.auth_method, c.certificate_id,
            c.certificate_expiry, c.permission_level, c.hwm_sales,
            c.hwm_purchases, c.last_sync_success, c.last_sync_error,
            c.sync_enabled, c.contact_email, c.contact_phone,
            c.monthly_invoice_volume, c.preferred_session_mode, c.created_at,
            c.updated_at, c.street, c.city, c.postal_code, c.tax_office_code,
            c.taxpayer_type, c.first_name, c.last_name, c.birth_date,
            c.anonymized_at,
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
    const subscriptionError = await requireActiveSubscription(session.firmId);
    if (subscriptionError) return subscriptionError;

    const { id } = await params;
    const body = await request.json();

    const check = await query('SELECT id FROM clients WHERE id = $1 AND firm_id = $2', [id, session.firmId]);
    if (!check.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (typeof body.sync_enabled === 'boolean') {
        await query('UPDATE clients SET sync_enabled = $1 WHERE id = $2', [body.sync_enabled, id]);
    }

    // Tax office (Naglowek/KodUrzedu of the JPK_V7M(3) file): only a code from
    // the official MF list is stored; empty clears it.
    if ('tax_office_code' in body) {
        const code = body.tax_office_code === '' ? null : body.tax_office_code;
        if (code !== null && !isValidTaxOfficeCode(code)) {
            return NextResponse.json({ error: 'Nieprawidłowy kod urzędu skarbowego (4 cyfry z listy MF)' }, { status: 400 });
        }
        body.tax_office_code = code;
    }

    // Taxpayer identity for JPK Podmiot1: a sole trader (individual) is filed as
    // OsobaFizyczna and needs first name, surname and date of birth.
    if ('taxpayer_type' in body && body.taxpayer_type !== 'company' && body.taxpayer_type !== 'individual') {
        return NextResponse.json({ error: 'Nieprawidłowy typ podatnika' }, { status: 400 });
    }
    if ('birth_date' in body) {
        const d = body.birth_date === '' ? null : body.birth_date;
        if (d !== null && !(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))) {
            return NextResponse.json({ error: 'Data urodzenia: oczekiwano RRRR-MM-DD' }, { status: 400 });
        }
        body.birth_date = d;
    }
    for (const f of ['first_name', 'last_name'] as const) {
        if (f in body && body[f] === '') body[f] = null;
    }

    // CRM + address fields update
    const crmFields = ['contact_person', 'contact_email', 'contact_phone', 'notes', 'tags', 'street', 'city', 'postal_code', 'tax_office_code', 'taxpayer_type', 'first_name', 'last_name', 'birth_date'] as const;
    const crmUpdates = crmFields.filter(f => f in body);
    if (crmUpdates.length > 0) {
        const sets = crmUpdates.map((f, i) => `${f} = $${i + 1}`).join(', ');
        const values = crmUpdates.map(f => body[f]);
        values.push(id);
        await query(`UPDATE clients SET ${sets} WHERE id = $${values.length}`, values);
    }

    return NextResponse.json({ success: true });
}
