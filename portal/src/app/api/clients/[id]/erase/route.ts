import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';

// GDPR erasure, scoped narrowly on purpose — see
// migrations/2026-09-14-gdpr-erasure.sql's comment for why this only ever
// clears CRM/contact fields and never touches invoices: those are a filed
// tax record (Polish tax law requires retention regardless of an erasure
// request), and rewriting buyer_name/seller_name after the fact would
// falsify what was actually submitted to KSeF.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin']);
    if (roleError) return roleError;

    const { id } = await params;

    const check = await query('SELECT id, client_name FROM clients WHERE id = $1 AND firm_id = $2', [id, session.firmId]);
    const client = check.rows[0];
    if (!client) return NextResponse.json({ error: 'Klient nie znaleziony' }, { status: 404 });

    await query(
        `UPDATE clients
         SET contact_person = NULL, contact_email = NULL, contact_phone = NULL, notes = NULL, tags = NULL,
             anonymized_at = NOW()
         WHERE id = $1`,
        [id]
    );

    await logActivity(session.firmId, 'gdpr_erasure', `Usunięto dane kontaktowe klienta: ${client.client_name} (dane faktur zachowane zgodnie z przepisami podatkowymi)`);

    return NextResponse.json({ ok: true });
}
