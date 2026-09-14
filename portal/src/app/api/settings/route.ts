import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await query(
        'SELECT firm_name, firm_nip, admin_email, subscription_tier, max_clients, trial_expires_at FROM firms WHERE id = $1',
        [session.firmId]
    );

    return NextResponse.json(result.rows[0] || {});
}

export async function PATCH(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { action } = body;

    // ── Update firm details ──────────────────────────────────────────
    // Firm-level (name/NIP): a delegated admin can reasonably manage this.
    if (action === 'update_firm') {
        const roleError = await requireRole(session, ['owner', 'admin']);
        if (roleError) return roleError;
        const { firm_name, firm_nip } = body;
        if (!firm_name?.trim()) {
            return NextResponse.json({ error: 'Nazwa firmy jest wymagana' }, { status: 400 });
        }
        if (firm_nip && !/^\d{10}$/.test(firm_nip.replace(/[-\s]/g, ''))) {
            return NextResponse.json({ error: 'NIP musi mieć 10 cyfr' }, { status: 400 });
        }
        await query(
            'UPDATE firms SET firm_name = $1, firm_nip = $2 WHERE id = $3',
            [firm_name.trim(), firm_nip ? firm_nip.replace(/[-\s]/g, '') : null, session.firmId]
        );
        return NextResponse.json({ success: true });
    }

    // ── Change email ────────────────────────────────────────────────
    // This is the firm owner's own login identity — owner only, not a
    // delegated admin.
    if (action === 'update_email') {
        const roleError = await requireRole(session, ['owner']);
        if (roleError) return roleError;
        const { new_email } = body;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!new_email || !emailRegex.test(new_email)) {
            return NextResponse.json({ error: 'Nieprawidłowy adres e-mail' }, { status: 400 });
        }
        const existing = await query('SELECT id FROM firms WHERE admin_email = $1 AND id != $2', [new_email.toLowerCase(), session.firmId]);
        if (existing.rows.length > 0) {
            return NextResponse.json({ error: 'Ten adres e-mail jest już zajęty' }, { status: 409 });
        }
        await query('UPDATE firms SET admin_email = $1 WHERE id = $2', [new_email.toLowerCase(), session.firmId]);
        return NextResponse.json({ success: true });
    }

    // ── Change password ──────────────────────────────────────────────
    // This changes firms.admin_password_hash — the firm owner's own login
    // credential — owner only, not a delegated admin.
    if (action === 'update_password') {
        const roleError = await requireRole(session, ['owner']);
        if (roleError) return roleError;
        const { current_password, new_password } = body;
        if (!current_password || !new_password) {
            return NextResponse.json({ error: 'Podaj obecne i nowe hasło' }, { status: 400 });
        }
        if (new_password.length < 8) {
            return NextResponse.json({ error: 'Nowe hasło musi mieć co najmniej 8 znaków' }, { status: 400 });
        }

        const result = await query('SELECT admin_password_hash FROM firms WHERE id = $1', [session.firmId]);
        const isValid = await bcrypt.compare(current_password, result.rows[0]?.admin_password_hash || '');
        if (!isValid) {
            return NextResponse.json({ error: 'Nieprawidłowe obecne hasło' }, { status: 401 });
        }

        const hash = await bcrypt.hash(new_password, 10);
        await query('UPDATE firms SET admin_password_hash = $1 WHERE id = $2', [hash, session.firmId]);
        return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Nieprawidłowa akcja' }, { status: 400 });
}
