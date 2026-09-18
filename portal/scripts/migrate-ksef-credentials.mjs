import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const keyText = process.env.KSEF_CREDENTIALS_KEY || '';
const legacyFormat = process.env.KSEF_LEGACY_FORMAT;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!['raw', 'base64'].includes(legacyFormat)) {
    throw new Error('Set KSEF_LEGACY_FORMAT=raw or base64 explicitly; unprefixed legacy rows are ambiguous');
}
const key = /^[0-9a-f]{64}$/i.test(keyText) ? Buffer.from(keyText, 'hex') : Buffer.from(keyText, 'base64');
if (key.length !== 32) throw new Error('KSEF_CREDENTIALS_KEY must contain exactly 32 bytes');

function encrypt(plaintext, id) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`ksef-client:${id}`));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['enc', 'v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
    await client.query('BEGIN');
    const rows = await client.query(
        `SELECT id, ksef_token_encrypted FROM clients
         WHERE ksef_token_encrypted IS NOT NULL AND ksef_token_encrypted NOT LIKE 'enc:v1:%'
         FOR UPDATE`
    );
    for (const row of rows.rows) {
        const plaintext = legacyFormat === 'base64'
            ? Buffer.from(row.ksef_token_encrypted, 'base64').toString('utf8')
            : row.ksef_token_encrypted;
        await client.query('UPDATE clients SET ksef_token_encrypted = $1 WHERE id = $2', [encrypt(plaintext, row.id), row.id]);
    }
    await client.query('COMMIT');
    console.log(`Migrated ${rows.rowCount} KSeF credential row(s).`);
} catch (error) {
    await client.query('ROLLBACK');
    throw error;
} finally {
    client.release();
    await pool.end();
}
