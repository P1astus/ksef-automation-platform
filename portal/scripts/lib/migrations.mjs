// Migration runner: one cutover baseline, then ordered, checksummed, post-cutover migrations.
//
// Deliberately plain ESM JavaScript with no build step: it runs inside the runtime image with just
// `node`, the same way scripts/create-operator.mjs does, and the vitest suite imports it directly.
//
// Three paths, never one "probe and guess" path (see the plan, Phase 0):
//   fresh    empty database          -> apply the baseline, record it
//   adopt    existing legacy database -> READ-ONLY audit against the baseline's invariants; on a full
//                                        match (and explicit confirmation) record the baseline as
//                                        adopted, apply nothing; on any mismatch stop with a report
//   upgrade  baseline recorded        -> apply post-cutover migrations from the manifest, in order
//
// Historical SQL (root ksef-schema-migration*.sql, migrations/*) is archive material and is never run.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const BASELINE = {
    version: 'baseline-2026-09-20',
    file: 'baseline-2026-09-20.sql',
    invariants: 'baseline-2026-09-20.invariants.json',
};

// Blocking (not try_) session-level advisory lock: a second instance must WAIT and then find
// everything applied, never skip ahead and serve against a half-migrated database.
const LOCK_KEY = '7263540125001';

export class MigrationError extends Error {
    constructor(message, code = 'MIGRATION_FAILED') {
        super(message);
        this.name = 'MigrationError';
        this.code = code;
    }
}

/** sha256 over LF-normalized text, so a CRLF/LF-only change never counts as drift. */
export function checksum(text) {
    return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Adapt a node-postgres Client (or Pool client) to the small interface the runner needs.
 * `exec` uses the simple protocol, which allows multi-statement files.
 */
export function fromPgClient(client) {
    return {
        query: (text, params) => client.query(text, params),
        exec: async text => { await client.query(text); },
    };
}

/** Adapt a PGlite instance (used by the vitest suite). */
export function fromPglite(pglite) {
    return {
        query: (text, params) => pglite.query(text, params),
        exec: async text => { await pglite.exec(text); },
    };
}

// ---------------------------------------------------------------------------------------------
// Schema snapshot: a structural fingerprint that ignores column order and dump formatting.
// ---------------------------------------------------------------------------------------------

const SNAPSHOT_COLUMNS = `
    SELECT c.relname AS tbl, a.attname AS col,
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null,
           pg_get_expr(d.adbin, d.adrelid) AS dflt
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
     ORDER BY 1, 2`;

const SNAPSHOT_CONSTRAINTS = `
    SELECT c.relname AS tbl, con.conname AS name, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname <> 'schema_migrations'
       AND con.contype <> 'n'
     ORDER BY 1, 2`;

const SNAPSHOT_INDEXES = `
    SELECT indexname AS name, indexdef AS def
      FROM pg_indexes
     WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
     ORDER BY 1`;

const SNAPSHOT_FUNCTIONS = `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
           md5(p.prosrc) AS body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
     ORDER BY 1`;

const SNAPSHOT_SEED = `
    SELECT CASE WHEN to_regclass('public.business_days') IS NULL
                THEN 0 ELSE (SELECT count(*) FROM business_days) END::int AS n`;

// Postgres deparses the SAME constraint differently across major versions, e.g. a CHECK ... IN (..) is
// `= ANY (ARRAY[('a'::character varying)::text, ...])` on one and `= ANY ((ARRAY['a'::character varying,
// ...])::text[])` on another. An audit that compared raw deparsed text would fail at the next Postgres
// upgrade, so definitions are compared in a normalized form: lower-cased, well-known type casts and all
// brackets removed, whitespace collapsed. The cast list is explicit (never `::\w+ ...`) so a normalizer
// can never swallow real predicate text such as `::text AND other = 1`.
const CAST = /::(?:timestamp with time zone|timestamp without time zone|character varying|character|varchar|text|integer|bigint|smallint|numeric|boolean|date|regclass)(?:\[\])?/g;
export function normalizeSql(text) {
    if (text === null || text === undefined) return null;
    return String(text).toLowerCase().replace(CAST, '').replace(/[()\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

export async function snapshotSchema(db) {
    const snap = { tables: {}, indexes: {}, functions: {}, seed: {} };

    for (const r of (await db.query(SNAPSHOT_COLUMNS)).rows) {
        const t = (snap.tables[r.tbl] ||= { columns: {}, constraints: {} });
        t.columns[r.col] = { type: r.type, notNull: !!r.not_null, default: normalizeSql(r.dflt) };
    }
    for (const r of (await db.query(SNAPSHOT_CONSTRAINTS)).rows) {
        const t = (snap.tables[r.tbl] ||= { columns: {}, constraints: {} });
        t.constraints[r.name] = normalizeSql(r.def);
    }
    for (const r of (await db.query(SNAPSHOT_INDEXES)).rows) snap.indexes[r.name] = normalizeSql(r.def);
    for (const r of (await db.query(SNAPSHOT_FUNCTIONS)).rows) snap.functions[r.name] = r.body;
    snap.seed.business_days = (await db.query(SNAPSHOT_SEED)).rows[0].n;
    return sortKeys(snap);
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
    }
    return value;
}

/** Stable JSON text of a snapshot (what the checked-in invariants file contains). */
export function serializeSnapshot(snap) {
    return JSON.stringify(sortKeys(snap), null, 2) + '\n';
}

/**
 * Compare a live snapshot against the baseline's required invariants.
 *   missing    -> required object absent            (blocking)
 *   different  -> present but structurally different (blocking)
 *   extra      -> present but not in the baseline    (informational, never blocking)
 */
export function diffSnapshots(expected, actual) {
    const missing = [];
    const different = [];
    const extra = [];

    const cmp = (kind, name, e, a) => {
        if (a === undefined) missing.push(`${kind} ${name}`);
        else if (JSON.stringify(e) !== JSON.stringify(a)) {
            different.push(`${kind} ${name}: expected ${JSON.stringify(e)}, found ${JSON.stringify(a)}`);
        }
    };

    for (const [tbl, et] of Object.entries(expected.tables)) {
        const at = actual.tables[tbl];
        if (!at) { missing.push(`table ${tbl}`); continue; }
        for (const [col, ec] of Object.entries(et.columns)) cmp('column', `${tbl}.${col}`, ec, at.columns[col]);
        for (const [name, def] of Object.entries(et.constraints)) cmp('constraint', `${tbl}.${name}`, def, at.constraints[name]);
        for (const col of Object.keys(at.columns)) if (!(col in et.columns)) extra.push(`column ${tbl}.${col}`);
        for (const name of Object.keys(at.constraints)) if (!(name in et.constraints)) extra.push(`constraint ${tbl}.${name}`);
    }
    for (const tbl of Object.keys(actual.tables)) if (!(tbl in expected.tables)) extra.push(`table ${tbl}`);

    for (const [name, def] of Object.entries(expected.indexes)) cmp('index', name, def, actual.indexes[name]);
    for (const name of Object.keys(actual.indexes)) if (!(name in expected.indexes)) extra.push(`index ${name}`);

    for (const [name, body] of Object.entries(expected.functions)) cmp('function', name, body, actual.functions[name]);
    for (const name of Object.keys(actual.functions)) if (!(name in expected.functions)) extra.push(`function ${name}`);

    // Reference data: the calendar must be at least as complete as the baseline's.
    if ((actual.seed.business_days ?? 0) < expected.seed.business_days) {
        missing.push(`reference data business_days: expected >= ${expected.seed.business_days} rows, found ${actual.seed.business_days}`);
    }

    return { ok: missing.length === 0 && different.length === 0, missing, different, extra };
}

export function formatAuditReport(diff) {
    const lines = [];
    lines.push(diff.ok ? 'ADOPTION AUDIT: the database matches baseline-2026-09-20.' : 'ADOPTION AUDIT: the database does NOT match baseline-2026-09-20.');
    if (diff.missing.length) { lines.push('', `Missing (${diff.missing.length}):`, ...diff.missing.map(m => `  - ${m}`)); }
    if (diff.different.length) { lines.push('', `Different (${diff.different.length}):`, ...diff.different.map(m => `  - ${m}`)); }
    if (diff.extra.length) { lines.push('', `Present but not in the baseline (${diff.extra.length}, informational):`, ...diff.extra.map(m => `  - ${m}`)); }
    if (!diff.ok) {
        lines.push(
            '',
            'Nothing was changed. The runner will not guess which historical migrations to run.',
            'Remediation: take a backup, then bring the objects above in line with the baseline by hand',
            '(the historical SQL under migrations/ is the reference), and re-run the audit.',
        );
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

export function loadManifest(dbDir) {
    const file = path.join(dbDir, 'migrations', 'manifest.json');
    if (!existsSync(file)) throw new MigrationError(`manifest not found: ${file}`, 'MANIFEST_MISSING');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const list = parsed.migrations;
    if (!Array.isArray(list)) throw new MigrationError('manifest.migrations must be an array', 'MANIFEST_INVALID');
    const seen = new Set();
    for (const m of list) {
        if (!m.version || !m.file) throw new MigrationError(`manifest entry needs version and file: ${JSON.stringify(m)}`, 'MANIFEST_INVALID');
        if (seen.has(m.version)) throw new MigrationError(`duplicate manifest version: ${m.version}`, 'MANIFEST_INVALID');
        seen.add(m.version);
        if (/rollback/i.test(m.file)) throw new MigrationError(`a rollback file must never be in the executable manifest: ${m.file}`, 'MANIFEST_INVALID');
    }
    return list.map(m => ({ version: m.version, file: m.file, transactional: m.transactional !== false }));
}

function readSql(dbDir, relative) {
    const file = path.join(dbDir, relative);
    if (!existsSync(file)) throw new MigrationError(`migration file not found: ${file}`, 'FILE_MISSING');
    return readFileSync(file, 'utf8');
}

async function userTableCount(db) {
    const r = await db.query(`
        SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'`);
    return r.rows[0].n;
}

async function hasMigrationsTable(db) {
    return (await db.query(`SELECT to_regclass('public.schema_migrations') AS t`)).rows[0].t !== null;
}

const CREATE_TRACKING = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        adopted    boolean NOT NULL DEFAULT false
    )`;

async function recordVersion(db, version, sum, adopted) {
    await db.query(
        'INSERT INTO schema_migrations (version, checksum, adopted) VALUES ($1, $2, $3)',
        [version, sum, adopted],
    );
}

/**
 * Bring the database to the current schema. Returns { path, applied } where path is one of
 * 'fresh' | 'adopted' | 'upgrade' | 'noop'.
 *
 * env: MIGRATIONS_CONFIRM_ADOPTION=1        record the baseline for an existing database
 *      MIGRATIONS_ALLOW_CHECKSUM_DRIFT=true continue (with a warning) when a checksum differs
 */
/**
 * @param {{ query: (text: string, params?: any[]) => Promise<{ rows: any[] }>, exec: (text: string) => Promise<void> }} db
 * @param {{ dbDir: string, env?: Record<string, string | undefined>, log?: (message: string) => void }} options
 * @returns {Promise<{ path: 'fresh' | 'adopted' | 'upgrade' | 'noop', applied: string[] }>}
 */
export async function migrate(db, { dbDir, env = process.env, log = () => {} }) {
    const allowDrift = env.MIGRATIONS_ALLOW_CHECKSUM_DRIFT === 'true';
    const confirmAdoption = env.MIGRATIONS_CONFIRM_ADOPTION === '1';
    const manifest = loadManifest(dbDir);
    const baselineSql = readSql(dbDir, BASELINE.file);
    const baselineSum = checksum(baselineSql);

    await db.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
        let path_;
        const applied = [];

        const tracked = (await hasMigrationsTable(db))
            ? (await db.query('SELECT version, checksum FROM schema_migrations ORDER BY applied_at, version')).rows
            : [];
        const trackedBaseline = tracked.find(r => r.version === BASELINE.version);

        if (!trackedBaseline) {
            const tables = await userTableCount(db);
            if (tables === 0) {
                // ---- fresh ----
                log(`fresh database: applying ${BASELINE.version}`);
                await db.exec('BEGIN');
                try {
                    await db.exec(baselineSql);
                    await db.exec(CREATE_TRACKING);
                    await recordVersion(db, BASELINE.version, baselineSum, false);
                    await db.exec('COMMIT');
                } catch (err) {
                    await db.exec('ROLLBACK');
                    throw new MigrationError(`baseline failed and was rolled back: ${err.message}`, 'BASELINE_FAILED');
                }
                path_ = 'fresh';
            } else {
                // ---- adopt: read-only audit first ----
                log(`existing database with ${tables} tables and no recorded baseline: auditing (read-only)`);
                const expected = JSON.parse(readSql(dbDir, BASELINE.invariants));
                const diff = diffSnapshots(expected, await snapshotSchema(db));
                const report = formatAuditReport(diff);
                if (!diff.ok) throw new MigrationError(report, 'ADOPTION_MISMATCH');
                log(report);
                if (!confirmAdoption) {
                    throw new MigrationError(
                        'The audit passed. Nothing has been recorded. Take a backup (pg_dump), then re-run with ' +
                        'MIGRATIONS_CONFIRM_ADOPTION=1 to record this database as baseline-2026-09-20.',
                        'ADOPTION_NOT_CONFIRMED',
                    );
                }
                await db.exec('BEGIN');
                try {
                    await db.exec(CREATE_TRACKING);
                    await recordVersion(db, BASELINE.version, baselineSum, true);
                    await db.exec('COMMIT');
                } catch (err) {
                    await db.exec('ROLLBACK');
                    throw err;
                }
                path_ = 'adopted';
            }
        } else if (trackedBaseline.checksum !== baselineSum) {
            const msg = `baseline checksum differs from the recorded one (recorded ${trackedBaseline.checksum.slice(0, 12)}, ` +
                `file ${baselineSum.slice(0, 12)}); a released baseline must never be edited`;
            if (!allowDrift) throw new MigrationError(msg, 'CHECKSUM_DRIFT');
            log(`WARNING: ${msg} (continuing: MIGRATIONS_ALLOW_CHECKSUM_DRIFT=true)`);
        }

        // ---- post-cutover migrations (applies to every path) ----
        const appliedNow = new Map(
            (await db.query('SELECT version, checksum FROM schema_migrations')).rows.map(r => [r.version, r.checksum]),
        );
        const manifestVersions = new Set(manifest.map(m => m.version));
        for (const v of appliedNow.keys()) {
            // An older application image against a newer database is the rollback case: allowed.
            if (v !== BASELINE.version && !manifestVersions.has(v)) {
                log(`note: database has migration ${v} that this application does not know (application rollback?)`);
            }
        }

        let sawPending = false;
        for (const m of manifest) {
            const sql = readSql(dbDir, path.join('migrations', m.file));
            const sum = checksum(sql);
            if (appliedNow.has(m.version)) {
                if (sawPending) throw new MigrationError(`migration ${m.version} is applied but an earlier one is not`, 'OUT_OF_ORDER');
                if (appliedNow.get(m.version) !== sum) {
                    const msg = `migration ${m.version} was edited after it was applied`;
                    if (!allowDrift) throw new MigrationError(msg, 'CHECKSUM_DRIFT');
                    log(`WARNING: ${msg} (continuing: MIGRATIONS_ALLOW_CHECKSUM_DRIFT=true)`);
                }
                continue;
            }
            sawPending = true;
            log(`applying ${m.version}${m.transactional ? '' : ' (NON-transactional, by declaration)'}`);
            if (m.transactional) {
                // The migration and its bookkeeping row commit together or not at all.
                await db.exec('BEGIN');
                try {
                    await db.exec(sql);
                    await recordVersion(db, m.version, sum, false);
                    await db.exec('COMMIT');
                } catch (err) {
                    await db.exec('ROLLBACK');
                    throw new MigrationError(`${m.version} failed and was rolled back: ${err.message}`, 'MIGRATION_FAILED');
                }
            } else {
                await db.exec(sql);
                await recordVersion(db, m.version, sum, false);
            }
            applied.push(m.version);
        }

        if (!path_) path_ = applied.length ? 'upgrade' : 'noop';
        return { path: path_, applied };
    } finally {
        await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
}
