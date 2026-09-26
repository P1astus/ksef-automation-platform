import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { revokeSessions } from '@/lib/auth';
import { sendWelcome } from '@/lib/email';
import { assertMailTransportConfigured } from '@/lib/mail-transport';
import { appUrl } from '@/lib/app-url';
import { consumeRateLimit, rateLimitResponse, requestIp } from '@/lib/rate-limit';
import { hashVerifyToken, issueEmailVerification } from '@/lib/email-verification';

// POST { action: 'confirm', token }  - open a link from the e-mail
// POST { action: 'resend', email }   - send a new sign-up link
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));

        if (body.action === 'confirm') {
            const limit = await consumeRateLimit('verify-confirm-ip', requestIp(request), 30, 60 * 60 * 1000);
            if (!limit.allowed) return rateLimitResponse(limit);
            const token = typeof body.token === 'string' ? body.token : '';
            if (!token) return NextResponse.json({ error: 'Brak tokenu' }, { status: 400 });
            const tokenHash = hashVerifyToken(token);

            const found = await query(
                `SELECT id, firm_name, admin_email, pending_email FROM firms
                 WHERE email_verify_token = $1 AND email_verify_expires_at > NOW()`,
                [tokenHash]
            );
            const firm = found.rows[0];
            if (!firm) {
                return NextResponse.json({ error: 'Link wygasł lub został już użyty.' }, { status: 400 });
            }

            if (firm.pending_email) {
                // Login e-mail change: the new address is now proven.
                try {
                    const changed = await query(
                        `UPDATE firms SET admin_email = pending_email, pending_email = NULL,
                             email_verify_token = NULL, email_verify_expires_at = NULL,
                             email_verified_at = NOW()
                         WHERE id = $1 AND email_verify_token = $2 RETURNING id`,
                        [firm.id, tokenHash]
                    );
                    if (!changed.rows[0]) return NextResponse.json({ error: 'Link wygasł lub został już użyty.' }, { status: 400 });
                } catch (err: any) {
                    if (err?.code === '23505') {
                        await query('UPDATE firms SET pending_email = NULL, email_verify_token = NULL, email_verify_expires_at = NULL WHERE id = $1', [firm.id]);
                        return NextResponse.json({ error: 'Ten adres e-mail jest już zajęty przez inne konto.' }, { status: 409 });
                    }
                    throw err;
                }
                // Sessions signed in under the old address end.
                await revokeSessions(firm.id, null);
                return NextResponse.json({ success: true, emailChanged: true });
            }

            const verified = await query(
                `UPDATE firms SET email_verified_at = NOW(), email_verify_token = NULL, email_verify_expires_at = NULL
                 WHERE id = $1 AND email_verify_token = $2 RETURNING id`,
                [firm.id, tokenHash]
            );
            if (!verified.rows[0]) return NextResponse.json({ error: 'Link wygasł lub został już użyty.' }, { status: 400 });
            sendWelcome(firm.admin_email, firm.firm_name).catch(() => {});
            return NextResponse.json({ success: true, emailChanged: false });
        }

        if (body.action === 'resend') {
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
            if (!email) return NextResponse.json({ error: 'Email jest wymagany' }, { status: 400 });
            try {
                assertMailTransportConfigured();
            } catch {
                return NextResponse.json({ error: 'Wysyłka e-mail nie jest skonfigurowana.' }, { status: 503 });
            }
            if (!appUrl()) return NextResponse.json({ error: 'Brak adresu portalu.' }, { status: 503 });
            const ipLimit = await consumeRateLimit('verify-resend-ip', requestIp(request), 10, 60 * 60 * 1000);
            if (!ipLimit.allowed) return rateLimitResponse(ipLimit);
            const emailLimit = await consumeRateLimit('verify-resend-email', email, 5, 60 * 60 * 1000);
            if (!emailLimit.allowed) return rateLimitResponse(emailLimit);

            const pending = await query('SELECT id FROM firms WHERE admin_email = $1 AND email_verified_at IS NULL AND is_active = true', [email]);
            if (pending.rows[0]) {
                try {
                    await issueEmailVerification(pending.rows[0].id, email, 'signup');
                } catch (err) {
                    console.error('Verification resend failed:', err);
                }
            }
            // Same answer whether or not an unconfirmed account exists.
            return NextResponse.json({ success: true, message: 'Jeśli konto czeka na potwierdzenie, wysłaliśmy nowy link.' });
        }

        return NextResponse.json({ error: 'Nieprawidłowa akcja' }, { status: 400 });
    } catch (error) {
        console.error('Email verification error:', error);
        return NextResponse.json({ error: 'Błąd serwera — spróbuj ponownie' }, { status: 500 });
    }
}
