import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { requireActiveSubscription } from '@/lib/entitlements';
import { normalizeJpkMarkers, InvalidJpkMarkerError } from '@/lib/jpk-markers';

// Sets the row-level JPK_V7M(3) markers (GTU_xx / procedure flags) on a sales
// invoice. Works on any sales invoice, including ones synced in from KSeF
// (those carry no marker data), and is deliberately allowed after the invoice
// was included in a generated JPK - the fix is to edit and regenerate.
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const subscriptionError = await requireActiveSubscription(session.firmId);
    if (subscriptionError) return subscriptionError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    let markers;
    try {
        markers = normalizeJpkMarkers({ gtu: body.gtu, procedures: body.procedures });
    } catch (err) {
        if (err instanceof InvalidJpkMarkerError) return NextResponse.json({ error: err.message }, { status: 400 });
        throw err;
    }

    // Ownership is checked directly against invoices.firm_id (same reason as
    // the payment route: a NIP can belong to more than one firm).
    const check = await query('SELECT direction FROM invoices WHERE id = $1 AND firm_id = $2', [id, session.firmId]);
    if (!check.rows[0]) return NextResponse.json({ error: 'Nie znaleziono faktury' }, { status: 404 });
    if (check.rows[0].direction !== 'sales') {
        return NextResponse.json({ error: 'Oznaczenia GTU i procedur dotyczą wyłącznie faktur sprzedaży' }, { status: 400 });
    }

    await query(
        'UPDATE invoices SET jpk_gtu = $1, jpk_procedures = $2 WHERE id = $3 AND firm_id = $4',
        [markers.gtu, markers.procedures, id, session.firmId]
    );
    await logActivity(
        session.firmId,
        'jpk_markers_updated',
        `Faktura #${id}: GTU [${markers.gtu.join(', ')}], procedury [${markers.procedures.join(', ')}]`
    );

    return NextResponse.json({ ok: true, ...markers });
}
