import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { appUrl } from '@/lib/app-url';
import { sendPasswordReset } from '@/lib/email';
import { assertMailTransportConfigured } from '@/lib/mail-transport';
import { consumeRateLimit, rateLimitResponse, requestIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { action } = body;

        // ─── Action: request reset ───────────────────────────────────────
        if (action === 'request') {
            const { email } = body;
            if (!email) {
                return NextResponse.json({ error: 'Email jest wymagany' }, { status: 400 });
            }

            const ipLimit = await consumeRateLimit('reset-request-ip', requestIp(request), 10, 60 * 60 * 1000);
            if (!ipLimit.allowed) return rateLimitResponse(ipLimit);
            const emailLimit = await consumeRateLimit('reset-request-email', String(email), 5, 60 * 60 * 1000);
            if (!emailLimit.allowed) return rateLimitResponse(emailLimit);

            const allowDevUrl = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_RESET_URL === 'true';
            const base = appUrl() || (allowDevUrl ? 'http://localhost:3000' : '');
            let emailConfigured = true;
            try {
                assertMailTransportConfigured();
            } catch {
                emailConfigured = false;
            }
            if ((!emailConfigured || !base) && !allowDevUrl) {
                return NextResponse.json(
                    { error: 'Wysyłka e-mail nie jest skonfigurowana. Skontaktuj się z administratorem.' },
                    { status: 503 }
                );
            }

            const normalizedEmail = String(email).trim().toLowerCase();
            const targets = await query(
                `SELECT 'owner' AS account_type, id FROM firms WHERE admin_email = $1 AND is_active = true
                 UNION ALL
                 SELECT 'member' AS account_type, fu.id
                 FROM firm_users fu JOIN firms f ON f.id = fu.firm_id
                 WHERE fu.email = $1 AND fu.is_active = true AND f.is_active = true`,
                [normalizedEmail]
            );
            const resetUrls: string[] = [];
            try {
                for (const target of targets.rows) {
                    const token = crypto.randomBytes(32).toString('hex');
                    const expires = new Date(Date.now() + 60 * 60 * 1000);
                    if (target.account_type === 'owner') {
                        await query('UPDATE firms SET reset_token = $1, reset_token_expires_at = $2 WHERE id = $3', [token, expires, target.id]);
                    } else {
                        await query('UPDATE firm_users SET reset_token = $1, reset_token_expires_at = $2 WHERE id = $3', [token, expires, target.id]);
                    }
                    const resetUrl = `${base}/reset-password/${token}`;
                    resetUrls.push(resetUrl);
                    if (emailConfigured) await sendPasswordReset(normalizedEmail, resetUrl);
                }
            } catch (error) {
                console.error('Reset email delivery failed:', error);
                return NextResponse.json({ error: 'Nie udało się wysłać wiadomości resetującej. Spróbuj ponownie później.' }, { status: 502 });
            }

            return NextResponse.json({
                success: true,
                message: 'Jeśli konto istnieje, link został wysłany na podany adres e-mail.',
                ...(allowDevUrl && resetUrls.length > 0 && { resetUrl: resetUrls[0] }),
            });
        }

        // ─── Action: confirm reset ───────────────────────────────────────
        if (action === 'confirm') {
            const { token, newPassword } = body;

            if (!token || !newPassword) {
                return NextResponse.json({ error: 'Token i nowe hasło są wymagane' }, { status: 400 });
            }

            if (newPassword.length < 8) {
                return NextResponse.json({ error: 'Hasło musi mieć co najmniej 8 znaków' }, { status: 400 });
            }

            const confirmLimit = await consumeRateLimit('reset-confirm-ip', requestIp(request), 15, 60 * 60 * 1000);
            if (!confirmLimit.allowed) return rateLimitResponse(confirmLimit);

            const result = await query(
                `SELECT 'owner' AS account_type, id FROM firms
                 WHERE reset_token = $1 AND reset_token_expires_at > NOW()
                 UNION ALL
                 SELECT 'member' AS account_type, id FROM firm_users
                 WHERE reset_token = $1 AND reset_token_expires_at > NOW()`,
                [token]
            );

            if (result.rows.length === 0) {
                return NextResponse.json(
                    { error: 'Link wygasł lub jest nieprawidłowy. Poproś o nowy link.' },
                    { status: 400 }
                );
            }

            const hash = await bcrypt.hash(newPassword, 10);

            const target = result.rows[0];
            if (target.account_type === 'owner') {
                await query(
                    `UPDATE firms SET admin_password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL WHERE id = $2`,
                    [hash, target.id]
                );
            } else {
                await query(
                    `UPDATE firm_users SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL WHERE id = $2`,
                    [hash, target.id]
                );
            }

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Nieprawidłowa akcja' }, { status: 400 });

    } catch (error) {
        console.error('Reset password error:', error);
        return NextResponse.json({ error: 'Błąd serwera — spróbuj ponownie' }, { status: 500 });
    }
}
