import { readFileSync } from 'fs';
import { join } from 'path';

// The one place tests get "the current schema": the same db/baseline-2026-09-20.sql the migration runner
// applies to a fresh install, so tests exercise the schema production actually has. (Tests that exist to
// prove a specific historical migration's behaviour still apply that archived SQL directly.)
export const BASELINE_SQL = join(__dirname, '..', '..', '..', '..', '..', 'db', 'baseline-2026-09-20.sql');

export async function applyBaseline(db: { exec(sql: string): Promise<unknown> }): Promise<void> {
    await db.exec(readFileSync(BASELINE_SQL, 'utf8'));
}
