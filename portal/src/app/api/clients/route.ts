import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { ClientLimitReachedError, createClientWithinPlan } from '@/lib/client-cap';

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await query(`
        SELECT c.*,
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
            'SELECT * FROM clients WHERE firm_id = $1 AND nip = $2',
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
