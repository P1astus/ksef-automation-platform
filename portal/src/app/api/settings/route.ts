import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession, requireRole, sessionRole, invalidateFirmActiveCache } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { capabilities } from '@/lib/deployment';
import { requireActiveSubscription } from '@/lib/entitlements';

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await query(
        'SELECT firm_name, firm_nip, admin_email, subscription_tier, max_clients, trial_expires_at FROM firms WHERE id = $1',
        [session.firmId]
    );

    // The frontend needs to know whether this session can manage firm-level
    // settings at all (owner/admin) before rendering those sections — a
    // member/readonly session would otherwise see forms that 403 on submit.
    return NextResponse.json({
        ...result.rows[0],
        role: sessionRole(session),
        isOwner: session.userId == null,
        licenceMode: capabilities().accessProvider === 'licence',
    });
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
        if (capabilities().accessProvider === 'licence') {
            const block = await requireActiveSubscription(session.firmId);
            if (block) return block;
            return NextResponse.json({
                error: 'Nazwa i NIP biura są związane z licencją; zmiana wymaga nowej licencji.',
                code: 'LICENCE_IDENTITY_LOCKED',
            }, { status: 409 });
        }
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
        if (capabilities().accessProvider === 'licence') {
            const block = await requireActiveSubscription(session.firmId);
            if (block) return block;
        }
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
    // Always changes the calling session's OWN credential, scoped by
    // session.userId/firmId (never user-supplied) — no role gate needed,
    // since this can never touch anyone else's password. Branches by
    // account kind: the owner has no firm_users row (userId is null) and
    // authenticates via firms.admin_password_hash; an invited team member
    // (userId set — see auth/login/route.ts) has their own firm_users row.
    // Before this branch existed, a team member had no way to ever change
    // the password they were invited with.
    if (action === 'update_password') {
        const { current_password, new_password } = body;
        if (!current_password || !new_password) {
            return NextResponse.json({ error: 'Podaj obecne i nowe hasło' }, { status: 400 });
        }
        if (new_password.length < 8) {
            return NextResponse.json({ error: 'Nowe hasło musi mieć co najmniej 8 znaków' }, { status: 400 });
        }

        if (session.userId) {
            const result = await query('SELECT password_hash FROM firm_users WHERE id = $1 AND firm_id = $2', [session.userId, session.firmId]);
            const isValid = await bcrypt.compare(current_password, result.rows[0]?.password_hash || '');
            if (!isValid) {
                return NextResponse.json({ error: 'Nieprawidłowe obecne hasło' }, { status: 401 });
            }
            const hash = await bcrypt.hash(new_password, 10);
            await query('UPDATE firm_users SET password_hash = $1 WHERE id = $2', [hash, session.userId]);
            return NextResponse.json({ success: true });
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

    // ── Deactivate account ─────────────────────────────────────────────
    // Owner-only self-service account closure. Deliberately NOT an
    // immediate cascading hard-delete of the firm's data: the firm is
    // itself a data controller with its own retention obligations for the
    // accounting work it performed, and an irreversible mass-delete
    // triggered by one click is a bigger, riskier action than this fix
    // should take unprompted. Sets is_active=false — the same flag
    // auth/login/route.ts already checks and rejects on — so the account
    // is immediately unusable; an actual data-purge policy is a separate
    // product decision for a future round, not built here.
    if (action === 'deactivate_account') {
        const roleError = await requireRole(session, ['owner']);
        if (roleError) return roleError;
        const { current_password } = body;
        if (!current_password) {
            return NextResponse.json({ error: 'Podaj hasło, aby potwierdzić' }, { status: 400 });
        }

        const result = await query('SELECT admin_password_hash, firm_name FROM firms WHERE id = $1', [session.firmId]);
        const isValid = await bcrypt.compare(current_password, result.rows[0]?.admin_password_hash || '');
        if (!isValid) {
            return NextResponse.json({ error: 'Nieprawidłowe hasło' }, { status: 401 });
        }

        await query('UPDATE firms SET is_active = false WHERE id = $1', [session.firmId]);
        invalidateFirmActiveCache(session.firmId);
        await logActivity(session.firmId, 'account_deactivated', `Konto biura "${result.rows[0].firm_name}" zostało dezaktywowane przez właściciela`);

        return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Nieprawidłowa akcja' }, { status: 400 });
}
