// Regenerate db/baseline-2026-09-20.invariants.json from a database on which the baseline has just
// been applied to an EMPTY database. The invariants are DERIVED, never hand-written, so the adoption
// audit cannot drift from the baseline. A test asserts the checked-in file matches a fresh apply.
//   DATABASE_URL=postgresql://... node scripts/generate-baseline-invariants.mjs
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { BASELINE, fromPgClient, snapshotSchema, serializeSnapshot } from './lib/migrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
    const out = path.resolve(here, '../../db', BASELINE.invariants);
    writeFileSync(out, serializeSnapshot(await snapshotSchema(fromPgClient(client))));
    console.log(`wrote ${out}`);
} finally {
    await client.end();
}
