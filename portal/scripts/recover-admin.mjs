// Filesystem-authorized emergency recovery for a local installation.
// Run only from a trusted shell with access to the installation's DATABASE_URL:
//
//   node scripts/recover-admin.mjs owner@example.com
//
// The command prints one URL. Opening it uses the normal password-reset page;
// a successful reset clears the token, and an unused token expires in one hour.
import { randomBytes as secureRandomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export async function createAdminRecovery({
    query,
    email,
    appUrl,
    now = new Date(),
    randomBytes = secureRandomBytes,
}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail.includes('@')) throw new Error('A valid owner email is required');

    const base = String(appUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) {
        throw new Error('NEXT_PUBLIC_APP_URL must be an absolute http(s) URL');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    const result = await query(
        `UPDATE firms
         SET reset_token = $2, reset_token_expires_at = $3
         WHERE admin_email = $1 AND is_active = true
         RETURNING id, admin_email`,
        [normalizedEmail, token, expiresAt]
    );
    if (result.rows.length !== 1) {
        throw new Error(`No active owner found for ${normalizedEmail}`);
    }

    return {
        email: result.rows[0].admin_email,
        resetUrl: `${base}/reset-password/${token}`,
        expiresAt,
    };
}

async function main() {
    const email = process.argv[2];
    if (!email) throw new Error('Usage: node scripts/recover-admin.mjs <owner-email>');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    if (!process.env.NEXT_PUBLIC_APP_URL) throw new Error('NEXT_PUBLIC_APP_URL is not set');

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        const result = await createAdminRecovery({
            query: client.query.bind(client),
            email,
            appUrl: process.env.NEXT_PUBLIC_APP_URL,
        });
        console.log(result.resetUrl);
    } finally {
        await client.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
