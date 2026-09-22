import { NextResponse } from 'next/server';
import { getSession, requireRole, invalidateFirmActiveCache } from '@/lib/auth';
import { capabilities } from '@/lib/deployment';
import pool, { query } from '@/lib/db';
import { licenceExpired, licencePublicKey, licenceWarningDays, loadFirmLicence, verifyLicence, LicenceError } from '@/lib/licence';
import { verifySameOrigin } from '@/lib/csrf';

export async function GET() {
    if (capabilities().accessProvider !== 'licence') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const session = await getSession();
    const denied = await requireRole(session, ['owner']);
    if (denied) return denied;
    try {
        const current = await loadFirmLicence(session!.firmId);
        return NextResponse.json({ state: current.state, plan: current.payload?.plan ?? null, maxClients: current.payload?.max_clients ?? null, expiresOn: current.payload?.expires_on ?? null, warningDays: current.payload ? licenceWarningDays(current.payload) : null });
    } catch (e) {
        if (e instanceof LicenceError) return NextResponse.json({ error: e.message, code: 'LICENCE_INVALID' }, { status: 409 });
        throw e;
    }
}

export async function POST(request: Request) {
    if (capabilities().accessProvider !== 'licence') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const origin = verifySameOrigin(request);
    if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: 403 });
    const session = await getSession();
    const denied = await requireRole(session, ['owner']);
    if (denied) return denied;
    let blob: string;
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        const body = await request.json().catch(() => null);
        blob = typeof body?.licence === 'string' ? body.licence : '';
    } else blob = await request.text();
    try {
        const payload = verifyLicence(blob, licencePublicKey());
        if (licenceExpired(payload)) throw new LicenceError('Licence has expired');
        const firm = await query('SELECT firm_nip, firm_name FROM firms WHERE id = $1', [session!.firmId]);
        if (payload.firm_nip !== firm.rows[0]?.firm_nip) throw new LicenceError('Licence NIP does not match firm NIP');
        if (payload.firm_name !== firm.rows[0]?.firm_name) throw new LicenceError('Licence firm name does not match');
        const tx = await pool.connect();
        try {
            await tx.query('BEGIN');
            const existing = await tx.query('SELECT 1 FROM firm_licences WHERE firm_id = $1 FOR UPDATE', [session!.firmId]);
            await tx.query(`INSERT INTO firm_licences (firm_id, signed_blob) VALUES ($1, $2)
                ON CONFLICT (firm_id) DO UPDATE SET signed_blob = EXCLUDED.signed_blob, installed_at = now()`, [session!.firmId, blob]);
            await tx.query(`UPDATE firms SET subscription_tier = $1, subscription_status = 'active', max_clients = $2,
                trial_expires_at = $3 WHERE id = $4`, [payload.plan, payload.max_clients, new Date(Date.parse(`${payload.expires_on}T00:00:00.000Z`) + 86400000), session!.firmId]);
            await tx.query(`INSERT INTO audit_log (firm_id, action, workflow_name, details, success)
                VALUES ($1, $2, 'licence', $3::jsonb, true)`, [session!.firmId, existing.rows.length ? 'licence_replaced' : 'licence_activated', JSON.stringify({ plan: payload.plan, max_clients: payload.max_clients, expires_on: payload.expires_on })]);
            await tx.query('COMMIT');
        } catch (error) { await tx.query('ROLLBACK'); throw error; }
        finally { tx.release(); }
        invalidateFirmActiveCache(session!.firmId);
        return NextResponse.json({ success: true, plan: payload.plan, maxClients: payload.max_clients, expiresOn: payload.expires_on });
    } catch (e) {
        if (e instanceof LicenceError) return NextResponse.json({ error: e.message, code: 'LICENCE_INVALID' }, { status: 400 });
        throw e;
    }
}
