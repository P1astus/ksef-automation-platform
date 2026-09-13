import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';

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
    await ensureTables();

    const body = await request.json().catch(() => ({}));
    const { email, role = 'member' } = body;

    if (!email || !email.includes('@')) {
        return NextResponse.json({ error: 'Nieprawidłowy adres email' }, { status: 400 });
    }
    if (!['admin', 'member', 'readonly'].includes(role)) {
        return NextResponse.json({ error: 'Nieprawidłowa rola' }, { status: 400 });
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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const inviteUrl = `${appUrl}/invite/accept?token=${token}`;
    await sendInviteEmail(email, firmName, inviteUrl).catch(() => {});

    await logActivity(session.firmId, 'team_invite', `Zaproszenie wysłano do ${email} (rola: ${role})`);

    return NextResponse.json({ ok: true, inviteUrl });
}

// DELETE /api/team?memberId=x or ?inviteId=x
export async function DELETE(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

async function sendInviteEmail(email: string, firmName: string, inviteUrl: string) {
    const key = process.env.RESEND_API_KEY;
    if (!key) return;
    const FROM = process.env.RESEND_FROM_EMAIL || 'KSeF Auto <noreply@ksef.auto>';
    await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: FROM,
            to: email,
            subject: `Zaproszenie do ${firmName} w KSeF Auto`,
            html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
                <h1 style="color:#6366f1;font-size:22px">Zaproszenie do zespołu</h1>
                <p style="color:#555;font-size:15px">Zostałeś zaproszony do biura <strong>${firmName}</strong> w KSeF Auto.</p>
                <a href="${inviteUrl}" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Dołącz do zespołu →</a>
                <p style="color:#999;font-size:12px;margin-top:24px">Link ważny 7 dni. KSeF Auto</p>
            </div>`,
        }),
    });
}
