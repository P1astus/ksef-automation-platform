// Apply the schema: fresh install -> baseline; existing database -> audit then adopt; then any
// post-cutover migrations. Runs as the one-shot `ksef_migrate` compose service and by hand:
//   docker compose run --rm ksef_migrate
//
// Exit codes: 0 ok | 1 unexpected failure | 2 adoption audit mismatch | 3 audit passed but adoption
// not confirmed (set MIGRATIONS_CONFIRM_ADOPTION=1 after taking a backup).
//
// Environment: DATABASE_URL (required), MIGRATIONS_CONFIRM_ADOPTION, MIGRATIONS_ALLOW_CHECKSUM_DRIFT,
// MIGRATIONS_DIR (defaults to ./db in the image, ../../db in the repo). Never logs the connection string.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate, fromPgClient, MigrationError } from './lib/migrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function resolveDbDir() {
    if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
    for (const candidate of [path.resolve(here, '../db'), path.resolve(here, '../../db')]) {
        if (existsSync(path.join(candidate, 'migrations', 'manifest.json'))) return candidate;
    }
    throw new MigrationError('cannot find the db directory; set MIGRATIONS_DIR', 'DIR_MISSING');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
try {
    await client.connect();
    const result = await migrate(fromPgClient(client), {
        dbDir: resolveDbDir(),
        env: process.env,
        log: msg => console.log(`[migrate] ${msg}`),
    });
    console.log(`[migrate] done: ${result.path}${result.applied.length ? ` (applied: ${result.applied.join(', ')})` : ''}`);
    process.exitCode = 0;
} catch (err) {
    console.error(err instanceof MigrationError ? err.message : `[migrate] unexpected failure: ${err.message}`);
    process.exitCode = err.code === 'ADOPTION_MISMATCH' ? 2 : err.code === 'ADOPTION_NOT_CONFIRMED' ? 3 : 1;
} finally {
    await client.end().catch(() => {});
}
