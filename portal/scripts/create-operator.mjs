// Creates (or resets the password of) a vendor-console operator.
//
//   cd portal
//   DATABASE_URL=postgresql://ksef_app:<KSEF_DB_PASSWORD>@localhost:5433/ksef_platform \
//   OPERATOR_PASSWORD='<at least 12 chars>' node scripts/create-operator.mjs you@example.com
//
// The password comes from the environment, not argv, so it stays out of `ps`.
// Re-running for an existing email resets the password and re-activates it.
import bcrypt from 'bcryptjs';
import pg from 'pg';

const email = (process.argv[2] || '').trim().toLowerCase();
const password = process.env.OPERATOR_PASSWORD || '';
if (!email.includes('@')) { console.error('usage: OPERATOR_PASSWORD=... node scripts/create-operator.mjs <email>'); process.exit(2); }
if (password.length < 12) { console.error('OPERATOR_PASSWORD must be at least 12 characters'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
    const hash = await bcrypt.hash(password, 12);
    const res = await client.query(
        `INSERT INTO operators (email, password_hash) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true
         RETURNING id, (xmax = 0) AS created`,
        [email, hash]
    );
    console.log(`${res.rows[0].created ? 'created' : 'updated'} operator #${res.rows[0].id} (${email})`);
} finally {
    await client.end();
}
