import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Plain ESM script (no build step: it runs in the image with bare node); types come from its JSDoc.
import * as runner from '../../../scripts/lib/migrations.mjs';

// Phase 0 of the local-first work: one cutover baseline + a runner with three paths
// (fresh / adopt / upgrade). These tests run the real runner against PGlite.

const REPO = join(__dirname, '..', '..', '..', '..');
const DB_DIR = join(REPO, 'db');

// The historical, documented application order. It is archive material now - the runner never runs
// it - but it defines "what a legacy database looks like", so adoption is tested against exactly it.
const LEGACY_ORDER = [
    'ksef-schema.sql',
    'ksef-holidays-init.sql',
    'ksef-schema-migration.sql',
    'ksef-schema-migration-v2.sql',
    'migrations/sprint9-13.sql',
    'migrations/2026-09-13-tenancy-fix.sql',
    'migrations/2026-09-13-jpk-preparations-fix.sql',
    'migrations/2026-09-13-offline-invoice-linking.sql',
    'migrations/2026-09-13-drop-dead-offline-columns.sql',
    'migrations/2026-09-14-bound-next-business-day.sql',
    'migrations/2026-09-14-correction-invoices.sql',
    'migrations/2026-09-14-client-notifications.sql',
    'migrations/2026-09-14-upo-storage.sql',
    'migrations/2026-09-14-gdpr-erasure.sql',
    'migrations/2026-09-16-address-columns.sql',
    'migrations/2026-09-16-upo-session-reference.sql',
    'migrations/2026-09-16-invoice-status-vocabulary.sql',
    'migrations/2026-09-19-jpk-row-markers.sql',
    'migrations/2026-09-19-operators.sql',
    'migrations/2026-09-19-firm-imap.sql',
    'migrations/2026-09-19-auth-rate-limits.sql',
    'migrations/2026-09-19-firm-user-reset.sql',
    'migrations/2026-09-19-jpk-v7m3-envelope.sql',
    'migrations/2026-09-19-jpk-remaining-fields.sql',
    'migrations/2026-09-19-jpk-margin-taxable-base.sql',
    'migrations/2026-09-19-zus-declarations.sql',
    'migrations/2026-09-19-jpk-test-gateway-submissions.sql',
];

// activity_log is created lazily by application code and defined by no migration; a live database
// therefore has it. The baseline includes it (that gap is why a code-created table is in the baseline).
const LAZY_ACTIVITY_LOG = `CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY, firm_id INTEGER NOT NULL, event_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;

async function legacyDatabase(): Promise<PGlite> {
    const db = new PGlite();
    for (const f of LEGACY_ORDER) await db.exec(readFileSync(join(REPO, f), 'utf8'));
    await db.exec(LAZY_ACTIVITY_LOG);
    return db;
}

const tableExists = async (db: PGlite, name: string) =>
    (await db.query<{ t: string | null }>(`SELECT to_regclass('public.${name}') AS t`)).rows[0].t !== null;

const quiet = { env: {} as Record<string, string>, log: () => {} };

describe('baseline cutover: fresh database', () => {
    it('applies the baseline, records it, and a second run is a no-op', async () => {
        const db = new PGlite();
        const a = await runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, ...quiet });
        expect(a).toEqual({ path: 'fresh', applied: [] });

        const rec = await db.query<{ version: string; adopted: boolean }>('SELECT version, adopted FROM schema_migrations');
        expect(rec.rows).toEqual([{ version: 'baseline-2026-09-20', adopted: false }]);

        // The bug this phase exists to fix: a fresh install had no `firms` table at all.
        expect(await tableExists(db, 'firms')).toBe(true);
        expect(await tableExists(db, 'activity_log')).toBe(true);
        const days = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM business_days');
        expect(days.rows[0].n).toBe(1096);

        const b = await runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, ...quiet });
        expect(b).toEqual({ path: 'noop', applied: [] });
    });

    it('ships the calendar reference data, so next_business_day() works on a clean install', async () => {
        const db = new PGlite();
        await runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, ...quiet });
        const r = await db.query<{ d: string }>(`SELECT next_business_day('2026-09-18'::date)::text AS d`);
        expect(r.rows[0].d).toBe('2026-09-21'); // Friday -> Monday
    });

    it('the checked-in invariants are exactly what a fresh apply produces (they are derived, never hand-written)', async () => {
        const db = new PGlite();
        await runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, ...quiet });
        const live = runner.serializeSnapshot(await runner.snapshotSchema(runner.fromPglite(db)));
        expect(live).toBe(readFileSync(join(DB_DIR, 'baseline-2026-09-20.invariants.json'), 'utf8'));
    });
});

describe('baseline cutover: adopting an existing (legacy) database', () => {
    it('a database built by the historical order is structurally identical to the baseline', async () => {
        const db = await legacyDatabase();
        const expected = JSON.parse(readFileSync(join(DB_DIR, 'baseline-2026-09-20.invariants.json'), 'utf8'));
        const diff = runner.diffSnapshots(expected, await runner.snapshotSchema(runner.fromPglite(db)));
        expect(diff.missing).toEqual([]);
        expect(diff.different).toEqual([]);
        expect(diff.ok).toBe(true);
    });

    it('a passing audit still records NOTHING without explicit confirmation', async () => {
        const db = await legacyDatabase();
        await expect(runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, ...quiet }))
            .rejects.toMatchObject({ code: 'ADOPTION_NOT_CONFIRMED' });
        expect(await tableExists(db, 'schema_migrations')).toBe(false);
    });

    it('records the baseline as adopted when confirmed, applies nothing, and is then a no-op', async () => {
        const db = await legacyDatabase();
        const rowsBefore = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM business_days')).rows[0].n;
        const r = await runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, env: { MIGRATIONS_CONFIRM_ADOPTION: '1' }, log: () => {} });
        expect(r.path).toBe('adopted');
        const rec = await db.query<{ version: string; adopted: boolean }>('SELECT version, adopted FROM schema_migrations');
        expect(rec.rows).toEqual([{ version: 'baseline-2026-09-20', adopted: true }]);
        expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM business_days')).rows[0].n).toBe(rowsBefore);
        expect((await runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, ...quiet })).path).toBe('noop');
    });

    // The deliberately-broken copies: each must produce a remediation report, never a repair attempt.
    const broken: [string, string, RegExp][] = [
        ['a missing column', 'ALTER TABLE invoices DROP COLUMN jpk_margin_taxable_gross', /column invoices\.jpk_margin_taxable_gross/],
        ['a missing table', 'DROP TABLE zus_declaration_events', /table zus_declaration_events/],
        ['a changed column type', 'ALTER TABLE invoices ALTER COLUMN buyer_nip TYPE VARCHAR(10)', /invoices\.buyer_nip/],
        ['a dropped constraint', 'ALTER TABLE firms DROP CONSTRAINT firms_subscription_tier_check', /constraint firms\.firms_subscription_tier_check/],
        ['a changed constraint', "ALTER TABLE firms DROP CONSTRAINT firms_subscription_tier_check, ADD CONSTRAINT firms_subscription_tier_check CHECK (subscription_tier IN ('start','pro'))", /firms\.firms_subscription_tier_check/],
        ['a missing function', 'DROP FUNCTION next_business_day(date)', /function next_business_day/],
        ['an empty calendar', 'DELETE FROM business_days', /business_days/],
    ];
    for (const [name, sql, pattern] of broken) {
        it(`refuses ${name}, reports it, and changes nothing`, async () => {
            const db = await legacyDatabase();
            await db.exec(sql);
            await expect(runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, env: { MIGRATIONS_CONFIRM_ADOPTION: '1' }, log: () => {} }))
                .rejects.toMatchObject({ code: 'ADOPTION_MISMATCH', message: expect.stringMatching(pattern) });
            // Even with confirmation, a mismatch records nothing and creates no tracking table.
            expect(await tableExists(db, 'schema_migrations')).toBe(false);
        });
    }

    it('objects that are merely EXTRA do not block adoption (reported as informational)', async () => {
        const db = await legacyDatabase();
        await db.exec('CREATE TABLE local_notes (id int)');
        const r = await runner.migrate(runner.fromPglite(db), { dbDir: DB_DIR, env: { MIGRATIONS_CONFIRM_ADOPTION: '1' }, log: () => {} });
        expect(r.path).toBe('adopted');
    });
});

// Post-cutover migrations run from an isolated directory so the tests never touch the real manifest.
function workDir(manifest: unknown, files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'ksef-migrations-'));
    mkdirSync(join(dir, 'migrations'));
    for (const f of ['baseline-2026-09-20.sql', 'baseline-2026-09-20.invariants.json']) copyFileSync(join(DB_DIR, f), join(dir, f));
    writeFileSync(join(dir, 'migrations', 'manifest.json'), JSON.stringify(manifest));
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, 'migrations', name), sql);
    return dir;
}

describe('post-cutover migrations', () => {
    let db: PGlite;
    beforeEach(async () => { db = new PGlite(); });

    it('applies pending migrations in manifest order, once', async () => {
        const dir = workDir(
            { migrations: [{ version: 'm1', file: 'm1.sql' }, { version: 'm2', file: 'm2.sql' }] },
            { 'm1.sql': 'CREATE TABLE t1 (id int)', 'm2.sql': 'ALTER TABLE t1 ADD COLUMN note text' },
        );
        const a = await runner.migrate(runner.fromPglite(db), { dbDir: dir, ...quiet });
        expect(a).toEqual({ path: 'fresh', applied: ['m1', 'm2'] });
        const b = await runner.migrate(runner.fromPglite(db), { dbDir: dir, ...quiet });
        expect(b).toEqual({ path: 'noop', applied: [] });
    });

    it('a failing migration rolls back together with its bookkeeping row', async () => {
        const dir = workDir(
            { migrations: [{ version: 'm1', file: 'm1.sql' }, { version: 'bad', file: 'bad.sql' }] },
            { 'm1.sql': 'CREATE TABLE t1 (id int)', 'bad.sql': 'CREATE TABLE t2 (id int); SELECT 1/0' },
        );
        await expect(runner.migrate(runner.fromPglite(db), { dbDir: dir, ...quiet }))
            .rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
        expect(await tableExists(db, 't2')).toBe(false);                     // statement effects rolled back
        const v = await db.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
        expect(v.rows.map(r => r.version)).toEqual(['baseline-2026-09-20', 'm1']); // no row for "bad"
    });

    it('a migration edited after it was applied stops the upgrade (checksum drift)', async () => {
        const dir = workDir({ migrations: [{ version: 'm1', file: 'm1.sql' }] }, { 'm1.sql': 'CREATE TABLE t1 (id int)' });
        await runner.migrate(runner.fromPglite(db), { dbDir: dir, ...quiet });
        writeFileSync(join(dir, 'migrations', 'm1.sql'), 'CREATE TABLE t1 (id int, sneaky text)');
        await expect(runner.migrate(runner.fromPglite(db), { dbDir: dir, ...quiet }))
            .rejects.toMatchObject({ code: 'CHECKSUM_DRIFT' });
        const ok = await runner.migrate(runner.fromPglite(db), { dbDir: dir, env: { MIGRATIONS_ALLOW_CHECKSUM_DRIFT: 'true' }, log: () => {} });
        expect(ok.path).toBe('noop');
    });

    it('a line-ending-only change is NOT drift (checksums are over LF-normalized text)', async () => {
        expect(runner.checksum('a\r\nb\r\n')).toBe(runner.checksum('a\nb\n'));
        const dir = workDir({ migrations: [{ version: 'm1', file: 'm1.sql' }] }, { 'm1.sql': 'CREATE TABLE t1 (id int);\n' });
        await runner.migrate(runner.fromPglite(db), { dbDir: dir, ...quiet });
        writeFileSync(join(dir, 'migrations', 'm1.sql'), 'CREATE TABLE t1 (id int);\r\n');
        expect((await runner.migrate(runner.fromPglite(db), { dbDir: dir, ...quiet })).path).toBe('noop');
    });

    it('an older application tolerates a NEWER database (application rollback without database rollback)', async () => {
        const newer = workDir({ migrations: [{ version: 'm1', file: 'm1.sql' }] }, { 'm1.sql': 'CREATE TABLE t1 (id int)' });
        await runner.migrate(runner.fromPglite(db), { dbDir: newer, ...quiet });
        const older = workDir({ migrations: [] }, {});
        const notes: string[] = [];
        const r = await runner.migrate(runner.fromPglite(db), { dbDir: older, env: {}, log: (m: string) => notes.push(m) });
        expect(r.path).toBe('noop');
        expect(notes.join('\n')).toMatch(/m1/);
    });

    it('refuses an out-of-order state (a later migration applied while an earlier one is not)', async () => {
        const first = workDir({ migrations: [{ version: 'm2', file: 'm2.sql' }] }, { 'm2.sql': 'CREATE TABLE t2 (id int)' });
        await runner.migrate(runner.fromPglite(db), { dbDir: first, ...quiet });
        const second = workDir(
            { migrations: [{ version: 'm1', file: 'm1.sql' }, { version: 'm2', file: 'm2.sql' }] },
            { 'm1.sql': 'CREATE TABLE t1 (id int)', 'm2.sql': 'CREATE TABLE t2 (id int)' },
        );
        await expect(runner.migrate(runner.fromPglite(db), { dbDir: second, ...quiet }))
            .rejects.toMatchObject({ code: 'OUT_OF_ORDER' });
    });

    it('a rollback file can never enter the executable manifest', () => {
        const dir = workDir({ migrations: [{ version: 'x', file: '2026-09-13-tenancy-fix-rollback.sql' }] }, {});
        expect(() => runner.loadManifest(dir)).toThrow(/rollback/);
    });

    it('a non-transactional migration must be declared, and is recorded after it runs', async () => {
        const dir = workDir(
            { migrations: [{ version: 'idx', file: 'idx.sql', transactional: false }] },
            { 'idx.sql': 'CREATE TABLE t9 (id int)' },
        );
        const notes: string[] = [];
        const r = await runner.migrate(runner.fromPglite(db), { dbDir: dir, env: {}, log: (m: string) => notes.push(m) });
        expect(r.applied).toEqual(['idx']);
        expect(notes.join('\n')).toMatch(/NON-transactional/);
    });
});
