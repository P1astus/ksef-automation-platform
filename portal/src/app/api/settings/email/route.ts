import { requireLicenceWrite } from '@/lib/entitlements';
import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { decryptSecret, encryptSecret, MissingCredentialKeyError } from '@/lib/credential-crypto';
import { requireActiveSubscription } from '@/lib/entitlements';

const context = (firmId: number) => `firm:${firmId}:imap-password`;

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin']);
    if (roleError) return roleError;

    const result = await query(
        `SELECT host, port, username, use_tls, mailbox, password_encrypted
         FROM firm_imap_settings WHERE firm_id = $1`,
        [session.firmId]
    );
    const row = result.rows[0];
    return NextResponse.json(row ? {
        configured: true,
        host: row.host,
        port: row.port,
        username: row.username,
        use_tls: row.use_tls,
        mailbox: row.mailbox,
        has_password: !!row.password_encrypted,
    } : { configured: false });
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const roleError = await requireRole(session, ['owner', 'admin']);
        if (roleError) return roleError;
        const subscriptionError = await requireActiveSubscription(session.firmId);
        if (subscriptionError) return subscriptionError;

        const body = await request.json();
        const host = String(body.host || '').trim();
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const mailbox = String(body.mailbox || 'INBOX').trim();
        const port = Number(body.port || 993);
        const useTls = body.use_tls !== false;
        if (!host || !username || !mailbox || !Number.isInteger(port) || port < 1 || port > 65535) {
            return NextResponse.json({ error: 'Podaj poprawne ustawienia serwera IMAP' }, { status: 400 });
        }

        let passwordEncrypted: string;
        if (password) {
            passwordEncrypted = encryptSecret(password, context(session.firmId));
        } else {
            const current = await query('SELECT password_encrypted FROM firm_imap_settings WHERE firm_id = $1', [session.firmId]);
            if (!current.rows[0]?.password_encrypted) {
                return NextResponse.json({ error: 'Hasło IMAP jest wymagane' }, { status: 400 });
            }
            // Validate that the configured key can still decrypt the retained password.
            decryptSecret(current.rows[0].password_encrypted, context(session.firmId));
            passwordEncrypted = current.rows[0].password_encrypted;
        }

        await query(
            `INSERT INTO firm_imap_settings (firm_id, host, port, username, password_encrypted, use_tls, mailbox)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (firm_id) DO UPDATE SET
                 host = EXCLUDED.host, port = EXCLUDED.port, username = EXCLUDED.username,
                 password_encrypted = EXCLUDED.password_encrypted, use_tls = EXCLUDED.use_tls,
                 mailbox = EXCLUDED.mailbox, updated_at = NOW()`,
            [session.firmId, host, port, username, passwordEncrypted, useTls, mailbox]
        );
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof MissingCredentialKeyError) {
            return NextResponse.json({ error: 'Szyfrowanie danych uwierzytelniających nie jest skonfigurowane' }, { status: 503 });
        }
        console.error('IMAP settings save failed:', error);
        return NextResponse.json({ error: 'Nie udało się zapisać ustawień IMAP' }, { status: 500 });
    }
}

export async function DELETE() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin']);
    if (roleError) return roleError;
    const licenceError = await requireLicenceWrite(session.firmId);
    if (licenceError) return licenceError;
    await query('DELETE FROM firm_imap_settings WHERE firm_id = $1', [session.firmId]);
    return NextResponse.json({ success: true });
}
