import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { PLAN_MAX_CLIENTS } from '@/lib/plans';
import pool from '@/lib/db';
import { capabilities } from '@/lib/deployment';
import { consumeRateLimit, rateLimitResponse, requestIp } from '@/lib/rate-limit';
import { assertMailTransportConfigured } from '@/lib/mail-transport';
import { appUrl } from '@/lib/app-url';
import { issueEmailVerification } from '@/lib/email-verification';
import { FirstRunClosedError, InvalidSetupTokenError, generateFirmSlug, registerFirstFirm } from '@/lib/first-run';

export async function POST(request: Request) {
    try {
        const { firm_name, firm_nip, admin_email, password, plan, setup_token } = await request.json();

        // Validate required fields
        if (!firm_name || !admin_email || !password) {
            return NextResponse.json(
                { error: 'Nazwa firmy, e-mail i hasło są wymagane' },
                { status: 400 }
            );
        }

        if (password.length < 8) {
            return NextResponse.json(
                { error: 'Hasło musi mieć co najmniej 8 znaków' },
                { status: 400 }
            );
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(admin_email)) {
            return NextResponse.json(
                { error: 'Nieprawidłowy adres e-mail' },
                { status: 400 }
            );
        }

        if (firm_nip && !/^\d{10}$/.test(firm_nip.replace(/[-\s]/g, ''))) {
            return NextResponse.json(
                { error: 'NIP musi mieć 10 cyfr' },
                { status: 400 }
            );
        }

        const ipLimit = await consumeRateLimit('register-ip', requestIp(request), 10, 60 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitResponse(ipLimit);

        if (capabilities().accessProvider === 'licence' && !firm_nip) {
            return NextResponse.json({ error: 'NIP firmy jest wymagany do aktywacji licencji' }, { status: 400 });
        }

        // Local edition: registration is closed. The FIRST firm may only be created by the holder of the one-time setup
        // token (printed by the installer), in one transaction with a "no firm yet" re-check. The hosted branch below
        // is unchanged.
        if (!capabilities().openRegistration) {
            const token = typeof setup_token === 'string' ? setup_token.trim() : '';
            if (!token) {
                return NextResponse.json(
                    { error: 'Rejestracja jest zamknięta. Podaj token instalacyjny.', code: 'SETUP_TOKEN_REQUIRED' },
                    { status: 403 }
                );
            }
            try {
                const firmId = await registerFirstFirm(
                    () => pool.connect(),
                    token,
                    {
                        firmName: firm_name.trim(),
                        firmNip: firm_nip ? firm_nip.replace(/[-\s]/g, '') : null,
                        adminEmail: admin_email.toLowerCase(),
                        passwordHash: await bcrypt.hash(password, 10),
                        // Access policy decides ACTIVITY (active, no trial clock); the tier decides FEATURES, so a
                        // local firm is a Pro firm and no tier check anywhere disagrees with a route.
                        subscriptionTier: 'pro',
                        maxClients: PLAN_MAX_CLIENTS.pro,
                    }
                );
                await createSession(firmId, admin_email.toLowerCase());
                return NextResponse.json({ success: true, redirectUrl: '/dashboard/onboarding' });
            } catch (err) {
                if (err instanceof FirstRunClosedError || err instanceof InvalidSetupTokenError) {
                    return NextResponse.json({ error: err.message, code: err instanceof FirstRunClosedError ? 'FIRST_RUN_CLOSED' : 'SETUP_TOKEN_INVALID' }, { status: 403 });
                }
                throw err;
            }
        }

        // Check email uniqueness
        // Hosted sign-up is only effective once the owner confirms the address
        // from their inbox, so an account needs working mail to be created.
        try {
            assertMailTransportConfigured();
        } catch {
            return NextResponse.json({ error: 'Rejestracja jest chwilowo niedostępna (wysyłka e-mail nie jest skonfigurowana).' }, { status: 503 });
        }
        if (!appUrl()) {
            return NextResponse.json({ error: 'Rejestracja jest chwilowo niedostępna (brak adresu portalu).' }, { status: 503 });
        }

        // An unconfirmed sign-up whose link has expired must not keep the
        // address reserved: someone could otherwise squat another person's
        // e-mail. It never signed in, so it holds no data.
        await query(
            `DELETE FROM firms WHERE admin_email = $1 AND email_verified_at IS NULL
               AND (email_verify_expires_at IS NULL OR email_verify_expires_at < NOW())`,
            [admin_email.toLowerCase()]
        ).catch(() => undefined);

        const existing = await query(
            'SELECT id FROM firms WHERE admin_email = $1',
            [admin_email.toLowerCase()]
        );
        if (existing.rows.length > 0) {
            return NextResponse.json(
                { error: 'Konto z tym adresem e-mail już istnieje' },
                { status: 409 }
            );
        }

        const subscriptionTier = PLAN_MAX_CLIENTS[plan] ? plan : 'start';
        const maxClients = PLAN_MAX_CLIENTS[subscriptionTier];
        const passwordHash = await bcrypt.hash(password, 10);

        // Try inserting with a unique slug (retry once on collision)
        let firm: { id: number } | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const slug = generateFirmSlug(firm_name);
            try {
                const result = await query(
                    `INSERT INTO firms
                        (firm_name, firm_nip, slug, admin_email, admin_password_hash,
                         subscription_tier, max_clients, trial_expires_at, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '14 days', true)
                     RETURNING id`,
                    [
                        firm_name.trim(),
                        firm_nip ? firm_nip.replace(/[-\s]/g, '') : null,
                        slug,
                        admin_email.toLowerCase(),
                        passwordHash,
                        subscriptionTier,
                        maxClients,
                    ]
                );
                firm = result.rows[0];
                break;
            } catch (err: any) {
                if (err.code === '23505' && attempt < 2) continue; // slug collision, retry
                throw err;
            }
        }

        if (!firm) throw new Error('Failed to create account after retries');

        try {
            await issueEmailVerification(firm.id, admin_email.toLowerCase(), 'signup');
        } catch (err) {
            // Without the link the account could never be used: undo it so
            // the owner can simply try again.
            console.error('Sign-up verification e-mail failed:', err);
            await query('DELETE FROM firms WHERE id = $1 AND email_verified_at IS NULL', [firm.id]).catch(() => undefined);
            return NextResponse.json({ error: 'Nie udało się wysłać e-maila potwierdzającego. Spróbuj ponownie później.' }, { status: 502 });
        }
        return NextResponse.json({ success: true, verifyEmail: true });

    } catch (error) {
        console.error('Register error:', error);
        return NextResponse.json(
            { error: 'Błąd serwera — spróbuj ponownie' },
            { status: 500 }
        );
    }
}
