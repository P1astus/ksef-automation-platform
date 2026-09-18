import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { tierHasFeature } from '@/lib/plans';

// GET /api/team/accept?token=xxx — validate token, return invite info
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Brak tokenu' }, { status: 400 });

    const invRes = await query(
        `SELECT i.*, f.firm_name, f.subscription_tier FROM invitations i JOIN firms f ON f.id = i.firm_id
         WHERE i.token = $1 AND i.accepted = false AND i.expires_at > NOW()`,
        [token]
    ).catch(() => ({ rows: [] }));

    if (!invRes.rows[0]) return NextResponse.json({ error: 'Zaproszenie nieważne lub wygasło' }, { status: 404 });
    const inv = invRes.rows[0];
    if (!tierHasFeature(inv.subscription_tier, 'team')) {
        return NextResponse.json({ error: 'Plan tego biura nie obejmuje kont zespołu', code: 'PLAN_UPGRADE_REQUIRED', feature: 'team' }, { status: 403 });
    }
    return NextResponse.json({ email: inv.email, firmName: inv.firm_name, role: inv.role });
}

// POST /api/team/accept — complete registration
export async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    const { token, fullName, password } = body;

    if (!token || !password || !fullName) {
        return NextResponse.json({ error: 'Brakujące dane' }, { status: 400 });
    }
    if (password.length < 8) {
        return NextResponse.json({ error: 'Hasło musi mieć co najmniej 8 znaków' }, { status: 400 });
    }

    const invRes = await query(
        `SELECT i.*, f.subscription_tier FROM invitations i JOIN firms f ON f.id = i.firm_id
         WHERE i.token = $1 AND i.accepted = false AND i.expires_at > NOW()`,
        [token]
    ).catch(() => ({ rows: [] }));

    if (!invRes.rows[0]) return NextResponse.json({ error: 'Zaproszenie nieważne lub wygasło' }, { status: 404 });
    const inv = invRes.rows[0];
    if (!tierHasFeature(inv.subscription_tier, 'team')) {
        return NextResponse.json({ error: 'Plan tego biura nie obejmuje kont zespołu', code: 'PLAN_UPGRADE_REQUIRED', feature: 'team' }, { status: 403 });
    }

    // Round 11 fix: this used to be a dynamic `import('bcryptjs').catch(...)`
    // whose failure silently fell back to an identity function — meaning a
    // failed import would have stored the real plaintext password in
    // firm_users.password_hash. register/login already use a static import
    // (line 2 above); there's no reason this route should be the one place
    // that can silently degrade instead of just failing loud like everything
    // else that hashes a password.
    const passwordHash = bcrypt.hashSync(password, 10);

    await query(
        `INSERT INTO firm_users (firm_id, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (firm_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, role = EXCLUDED.role`,
        [inv.firm_id, inv.email, passwordHash, fullName, inv.role]
    );

    await query(`UPDATE invitations SET accepted = true WHERE id = $1`, [inv.id]);

    return NextResponse.json({ ok: true, email: inv.email });
}
