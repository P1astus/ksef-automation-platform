import { NextResponse } from 'next/server';
import { requireActiveSubscription } from '@/lib/entitlements';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { ClientLimitReachedError, createClientWithinPlan } from '@/lib/client-cap';

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await query(`
        SELECT c.id, c.client_name, c.nip, c.auth_method, c.certificate_id,
            c.certificate_expiry, c.permission_level, c.hwm_sales,
            c.hwm_purchases, c.last_sync_success, c.last_sync_error,
            c.sync_enabled, c.contact_email, c.contact_phone,
            c.monthly_invoice_volume, c.preferred_session_mode, c.created_at,
            c.updated_at, c.street, c.city, c.postal_code, c.tax_office_code,
            c.taxpayer_type, c.first_name, c.last_name, c.birth_date,
            c.anonymized_at,
            (SELECT COUNT(*) FROM invoices i WHERE i.client_nip = c.nip AND i.firm_id = c.firm_id) as invoice_count
        FROM clients c
        WHERE c.firm_id = $1
        ORDER BY c.client_name ASC
    `, [session.firmId]);

    return NextResponse.json({ clients: result.rows });
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const planError = await requireActiveSubscription(session.firmId);
    if (planError) return planError;

    try {
        const { nip, client_name } = await request.json();

        if (!nip || !client_name) {
            return NextResponse.json({ error: 'NIP i nazwa firmy są wymagane' }, { status: 400 });
        }

        // Validate NIP (10 digits)
        const cleanNip = nip.replace(/[-\s]/g, '');
        if (!/^\d{10}$/.test(cleanNip)) {
            return NextResponse.json({ error: 'NIP musi zawierać dokładnie 10 cyfr' }, { status: 400 });
        }

        const created = await createClientWithinPlan(session.firmId, {
            nip: cleanNip,
            clientName: client_name.trim(),
            authMethod: 'token',
            permissionLevel: 'read_write',
            syncEnabled: true,
        });
        if (!created) {
            return NextResponse.json({ error: 'Klient z tym NIP już istnieje na Twoim koncie' }, { status: 409 });
        }

        const result = await query(
            `SELECT id, client_name, nip, auth_method, certificate_id, certificate_expiry,
                permission_level, hwm_sales, hwm_purchases, last_sync_success, last_sync_error,
                sync_enabled, contact_email, contact_phone, monthly_invoice_volume,
                preferred_session_mode, created_at, updated_at, street, city, postal_code,
                tax_office_code, taxpayer_type, first_name, last_name, birth_date, anonymized_at
             FROM clients WHERE firm_id = $1 AND nip = $2`,
            [session.firmId, cleanNip]
        );

        await logActivity(session.firmId, 'client_added', `Dodano klienta: ${client_name.trim()} (${cleanNip})`);
        return NextResponse.json({ client: result.rows[0] }, { status: 201 });

    } catch (error: unknown) {
        console.error('Add client error:', error);
        const pgError = error as { code?: string };
        if (error instanceof ClientLimitReachedError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        if (pgError.code === '23505') {
            return NextResponse.json({ error: 'Klient z tym NIP już istnieje w systemie' }, { status: 409 });
        }
        return NextResponse.json({ error: 'Błąd serwera' }, { status: 500 });
    }
}
