import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '@/lib/db';

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

            const token = crypto.randomBytes(32).toString('hex');
            const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            // Update the token regardless of whether the email exists (security: don't reveal existence)
            await query(
                `UPDATE firms
                 SET reset_token = $1, reset_token_expires_at = $2
                 WHERE admin_email = $3`,
                [token, expires, email.toLowerCase()]
            );

            const resetUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/reset-password/${token}`;

            // Send email if RESEND_API_KEY is configured
            const resendKey = process.env.RESEND_API_KEY;
            if (resendKey) {
                await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${resendKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: 'KSeF Auto <noreply@ksef.auto>',
                        to: email,
                        subject: 'Reset hasła — KSeF Auto',
                        html: `
                            <h2>Reset hasła</h2>
                            <p>Kliknij poniższy link, aby ustawić nowe hasło. Link jest ważny przez 1 godzinę.</p>
                            <a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
                                Ustaw nowe hasło →
                            </a>
                            <p style="margin-top:24px;color:#94a3b8;font-size:13px;">
                                Jeśli nie prosiłeś o reset hasła, zignoruj tę wiadomość.
                            </p>
                        `,
                    }),
                }).catch(() => { /* log but don't throw — don't reveal email state */ });
            }

            // In dev mode, return the URL so it can be tested without email
            const devMode = process.env.NODE_ENV !== 'production';
            return NextResponse.json({
                success: true,
                message: 'Jeśli konto istnieje, link został wysłany na podany adres e-mail.',
                ...(devMode && { resetUrl }),
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

            const result = await query(
                `SELECT id FROM firms
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

            await query(
                `UPDATE firms
                 SET admin_password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL
                 WHERE id = $2`,
                [hash, result.rows[0].id]
            );

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Nieprawidłowa akcja' }, { status: 400 });

    } catch (error) {
        console.error('Reset password error:', error);
        return NextResponse.json({ error: 'Błąd serwera — spróbuj ponownie' }, { status: 500 });
    }
}
