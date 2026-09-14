import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';

// db.ts silently fell back to
// 'postgresql://ksef_app:temp_pw@localhost:5433/ksef_platform' when
// DATABASE_URL was unset - not a real credential for anything (docker-compose's
// ksef_db is reachable as ksef_db:5432 from inside a container, not
// localhost:5433, and temp_pw was never the real password), but a missing
// env var failed with a confusing pg connection error instead of saying
// plainly what was wrong. Same class of fix as D9's JWT_SECRET fallback,
// same lazy-check pattern (a module-level throw breaks `next build`, which
// statically imports every route with no DATABASE_URL available).

describe('db.ts DATABASE_URL handling', () => {
    const originalUrl = process.env.DATABASE_URL;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        if (originalUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalUrl;
    });

    it('does not throw at import time (next build statically imports every route module with no DATABASE_URL available)', async () => {
        delete process.env.DATABASE_URL;
        await expect(import('./db')).resolves.toBeDefined();
    });

    it('query() throws instead of falling back to a placeholder connection string when DATABASE_URL is missing', async () => {
        delete process.env.DATABASE_URL;
        const db = await import('./db');
        await expect(db.query('SELECT 1')).rejects.toThrow(/DATABASE_URL is not set/);
    });

    it('the default pool export also enforces the check, not just query()', async () => {
        delete process.env.DATABASE_URL;
        const db = await import('./db');
        expect(() => db.default.connect).toThrow(/DATABASE_URL is not set/);
    });

    it('does not throw, and constructs a real pg Pool, when DATABASE_URL is set', async () => {
        process.env.DATABASE_URL = 'postgresql://test-only-not-a-real-credential@localhost:1/db';
        const db = await import('./db');
        // No network I/O happens just by accessing these - pg's Pool only
        // connects on an actual query/connect call.
        expect(typeof db.default.query).toBe('function');
        expect(typeof db.query).toBe('function');
    });
});
