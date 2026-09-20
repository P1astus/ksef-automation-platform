import { readFileSync } from 'fs';
import { join } from 'path';
import * as runner from '../../../../scripts/lib/migrations.mjs';

// The one place tests get "the current schema": the same db/baseline-2026-09-20.sql the migration runner
// applies to a fresh install, so tests exercise the schema production actually has. (Tests that exist to
// prove a specific historical migration's behaviour still apply that archived SQL directly.)
export const BASELINE_SQL = join(__dirname, '..', '..', '..', '..', '..', 'db', 'baseline-2026-09-20.sql');

export async function applyBaseline(db: { exec(sql: string): Promise<unknown> }): Promise<void> {
    await db.exec(readFileSync(BASELINE_SQL, 'utf8'));
}

export const DB_DIR = join(__dirname, '..', '..', '..', '..', '..', 'db');

/**
 * The full current schema: the baseline PLUS every post-cutover migration in db/migrations/manifest.json, applied
 * through the real runner (so a new migration is exercised by every test that uses this, not just its own).
 */
export async function applyCurrentSchema(db: Parameters<typeof runner.fromPglite>[0]): Promise<void> {
    await runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, env: {}, log: () => {} });
}
