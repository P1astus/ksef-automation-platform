import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { registerFirstFirm, insertFirmInTransaction, FirstRunClosedError, InvalidSetupTokenError, type FirstFirm } from '../first-run';
import { hashSetupToken as hashTs, generateSetupToken } from '../setup-token';
// Plain ESM script (no build step); types come from its JSDoc.
import { issueSetupToken, hashSetupToken as hashMjs, SetupTokenError } from '../../../scripts/lib/setup-token.mjs';

// The local edition's first run: only the holder of the one-time setup token can create the first firm.

const firm = (over: Partial<FirstFirm> = {}): FirstFirm => ({
    firmName: 'Biuro Testowe', firmNip: null, adminEmail: 'admin@example.invalid',
    passwordHash: 'hash', subscriptionTier: 'pro', maxClients: 999, ...over,
});

let db: PGlite;
const connect = () => Promise.resolve({ query: (t: string, p?: unknown[]) => db.query(t, p as any[]) as any, release: () => {} });
const firmCount = async () => (await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM firms')).rows[0].n;
const tokenRows = async () => (await db.query<{ consumed_at: string | null }>('SELECT consumed_at FROM setup_token')).rows;

beforeEach(async () => {
    db = new PGlite();
    await applyCurrentSchema(db);
});

describe('setup token hashing', () => {
    it('the portal (TS) and the installer script (mjs) hash identically', () => {
        for (const t of ['abc', generateSetupToken(), '  padded  ']) expect(hashTs(t)).toBe(hashMjs(t));
        expect(hashTs('x')).toMatch(/^[0-9a-f]{64}$/);
    });
    it('generated tokens are high entropy (32 bytes) and unique', () => {
        const a = generateSetupToken();
        expect(Buffer.from(a, 'base64url').length).toBe(32);
        expect(generateSetupToken()).not.toBe(a);
    });
});

describe('issueSetupToken (installer / rotation)', () => {
    it('stores only the SHA-256, never the raw token', async () => {
        const raw = await issueSetupToken({ query: (t: string, p?: any[]) => db.query(t, p) });
        const rows = (await db.query<{ token_hash: string }>('SELECT token_hash FROM setup_token')).rows;
        expect(rows).toEqual([{ token_hash: hashMjs(raw) }]);
        expect(JSON.stringify(rows)).not.toContain(raw);
    });

    it('rotating replaces the unconsumed token, so the lost one stops working', async () => {
        const q = { query: (t: string, p?: any[]) => db.query(t, p) };
        const lost = await issueSetupToken(q);
        const fresh = await issueSetupToken(q);
        expect(fresh).not.toBe(lost);
        expect((await tokenRows()).length).toBe(1);
        await expect(registerFirstFirm(connect, lost, firm())).rejects.toBeInstanceOf(InvalidSetupTokenError);
        await expect(registerFirstFirm(connect, fresh, firm())).resolves.toBeGreaterThan(0);
    });

    it('refuses once a firm exists: it is a first-run credential, not a way back in', async () => {
        const q = { query: (t: string, p?: any[]) => db.query(t, p) };
        const raw = await issueSetupToken(q);
        await registerFirstFirm(connect, raw, firm());
        await expect(issueSetupToken(q)).rejects.toMatchObject({ code: 'FIRM_EXISTS' });
        await expect(issueSetupToken(q)).rejects.toBeInstanceOf(SetupTokenError);
    });

    it('fails clearly when the schema has not been applied', async () => {
        const empty = new PGlite();
        await expect(issueSetupToken({ query: (t: string, p?: any[]) => empty.query(t, p) })).rejects.toMatchObject({ code: 'SCHEMA_MISSING' });
    });
});

describe('registerFirstFirm', () => {
    it('creates an ACTIVE Pro firm with no trial clock, and consumes the token, in one go', async () => {
        const raw = await issueSetupToken({ query: (t: string, p?: any[]) => db.query(t, p) });
        const id = await registerFirstFirm(connect, raw, firm());
        const f = (await db.query<any>('SELECT subscription_tier, subscription_status, trial_expires_at, max_clients, is_active FROM firms WHERE id = $1', [id])).rows[0];
        expect(f).toMatchObject({ subscription_tier: 'pro', subscription_status: 'active', trial_expires_at: null, max_clients: 999, is_active: true });
        expect((await tokenRows())[0].consumed_at).not.toBeNull();
    });

    it('without a valid token nothing is created and no token is burned', async () => {
        const raw = await issueSetupToken({ query: (t: string, p?: any[]) => db.query(t, p) });
        for (const bad of ['', 'wrong', raw + 'x']) {
            await expect(registerFirstFirm(connect, bad, firm())).rejects.toBeInstanceOf(InvalidSetupTokenError);
        }
        expect(await firmCount()).toBe(0);
        expect((await tokenRows())[0].consumed_at).toBeNull(); // still usable by the real administrator
    });

    it('a consumed token cannot be replayed', async () => {
        const q = { query: (t: string, p?: any[]) => db.query(t, p) };
        const raw = await issueSetupToken(q);
        await registerFirstFirm(connect, raw, firm());
        await db.exec('DELETE FROM firms'); // even with the firm gone, the token is spent
        await expect(registerFirstFirm(connect, raw, firm())).rejects.toBeInstanceOf(InvalidSetupTokenError);
    });

    it('once a firm exists first-run is closed, even for a brand-new valid token, and that token is not burned', async () => {
        const raw = await issueSetupToken({ query: (t: string, p?: any[]) => db.query(t, p) });
        await registerFirstFirm(connect, raw, firm());
        await db.query('INSERT INTO setup_token (token_hash) VALUES ($1)', [hashTs('late')]);
        await expect(registerFirstFirm(connect, 'late', firm({ adminEmail: 'second@example.invalid' }))).rejects.toBeInstanceOf(FirstRunClosedError);
        expect(await firmCount()).toBe(1);
        expect((await tokenRows()).filter(r => r.consumed_at === null).length).toBe(1);
    });

    it('a failure after the token claim (bad insert) rolls the claim back too', async () => {
        const raw = await issueSetupToken({ query: (t: string, p?: any[]) => db.query(t, p) });
        await expect(registerFirstFirm(connect, raw, firm({ subscriptionTier: 'not-a-tier' }))).rejects.toThrow();
        expect(await firmCount()).toBe(0);
        expect((await tokenRows())[0].consumed_at).toBeNull();
    });
});

describe('slug collision inside a transaction (the savepoint fix)', () => {
    const seedExisting = async () => {
        await db.query(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, subscription_tier, max_clients) VALUES ('Old','taken-1','old@example.invalid','h','start',15)`
        );
    };
    const slugs = (...list: string[]) => { let i = 0; return () => list[Math.min(i++, list.length - 1)]; };

    it('retries with a fresh slug and the transaction stays usable', async () => {
        await seedExisting();
        await db.query('BEGIN');
        const id = await insertFirmInTransaction({ query: (t, p) => db.query(t, p as any[]) as any }, firm(), slugs('taken-1', 'free-2'));
        await db.query('COMMIT');
        expect((await db.query<{ slug: string }>('SELECT slug FROM firms WHERE id = $1', [id])).rows[0].slug).toBe('free-2');
    });

    it('WITHOUT a savepoint the same retry is dead: this is the bug the savepoint prevents', async () => {
        await seedExisting();
        await db.query('BEGIN');
        const insert = (slug: string) => db.query(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, subscription_tier, max_clients) VALUES ('N',$1,'n@example.invalid','h','start',15)`, [slug]);
        await expect(insert('taken-1')).rejects.toMatchObject({ code: '23505' });
        await expect(insert('free-2')).rejects.toThrow(/aborted/i); // the retry that "should" have worked
        await db.query('ROLLBACK');
    });

    it('gives up after the attempt limit and surfaces the error instead of looping or swallowing it', async () => {
        await seedExisting();
        await db.query('BEGIN');
        await expect(insertFirmInTransaction({ query: (t, p) => db.query(t, p as any[]) as any }, firm(), slugs('taken-1'), 3)).rejects.toMatchObject({ code: '23505' });
        await db.query('ROLLBACK');
    });
});
