import { NextResponse } from 'next/server';
import { requireFeature } from '@/lib/entitlements';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { appUrl } from '@/lib/app-url';
import { sendTeamInvite } from '@/lib/email';

// Ensure tables exist (idempotent)
async function ensureTables() {
    await query(`
        CREATE TABLE IF NOT EXISTS firm_users (
            id SERIAL PRIMARY KEY,
            firm_id INT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(255),
            role VARCHAR(20) DEFAULT 'member',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(firm_id, email)
        )
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS invitations (
            id SERIAL PRIMARY KEY,
            firm_id INT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            token VARCHAR(64) UNIQUE NOT NULL,
            role VARCHAR(20) DEFAULT 'member',
            accepted BOOLEAN DEFAULT false,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
}

// GET /api/team — list members + pending invites
export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await ensureTables();

    const [membersRes, invitesRes] = await Promise.all([
        query(
            `SELECT id, email, full_name, role, is_active, created_at FROM firm_users WHERE firm_id = $1 ORDER BY created_at ASC`,
            [session.firmId]
        ),
        query(
            `SELECT id, email, role, accepted, expires_at, created_at FROM invitations WHERE firm_id = $1 AND accepted = false AND expires_at > NOW() ORDER BY created_at DESC`,
            [session.firmId]
        ),
    ]);

    return NextResponse.json({ members: membersRes.rows, pendingInvites: invitesRes.rows });
}

// POST /api/team — create invitation
export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin']);
    if (roleError) return roleError;
    const planError = await requireFeature(session.firmId, 'team');
    if (planError) return planError;
    await ensureTables();

    const body = await request.json().catch(() => ({}));
    const { email, role = 'member' } = body;

    if (!email || !email.includes('@')) {
        return NextResponse.json({ error: 'Nieprawidłowy adres email' }, { status: 400 });
    }
    if (!['admin', 'member', 'readonly'].includes(role)) {
        return NextResponse.json({ error: 'Nieprawidłowa rola' }, { status: 400 });
    }
    const base = appUrl();
    if (!base) {
        return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL nie jest skonfigurowany' }, { status: 503 });
    }

    // Delete old expired or unaccepted invite for same email
    await query(
        `DELETE FROM invitations WHERE firm_id = $1 AND email = $2 AND accepted = false`,
        [session.firmId, email]
    );

    // Generate token
    const { randomBytes } = await import('crypto');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

    await query(
        `INSERT INTO invitations (firm_id, email, token, role, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [session.firmId, email, token, role, expiresAt]
    );

    // Get firm name for email
    const firmRes = await query('SELECT firm_name FROM firms WHERE id = $1', [session.firmId]);
    const firmName = firmRes.rows[0]?.firm_name || 'KSeF Auto';

    // Send invite email (non-critical)
    const inviteUrl = `${base}/invite/accept?token=${token}`;
    const emailSent = await sendTeamInvite(email, firmName, inviteUrl).then(() => true).catch(() => false);

    await logActivity(session.firmId, 'team_invite', `Zaproszenie wysłano do ${email} (rola: ${role})`);

    return NextResponse.json({ ok: true, inviteUrl, emailSent });
}

// DELETE /api/team?memberId=x or ?inviteId=x
export async function DELETE(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin']);
    if (roleError) return roleError;

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');
    const inviteId = searchParams.get('inviteId');

    if (memberId) {
        await query(`DELETE FROM firm_users WHERE id = $1 AND firm_id = $2`, [memberId, session.firmId]);
    } else if (inviteId) {
        await query(`DELETE FROM invitations WHERE id = $1 AND firm_id = $2`, [inviteId, session.firmId]);
    }

    return NextResponse.json({ ok: true });
}
