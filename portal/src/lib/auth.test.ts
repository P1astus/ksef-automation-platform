import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('auth JWT_SECRET handling (D9)', () => {
    const originalSecret = process.env.JWT_SECRET;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
    });

    it('throws at module load instead of falling back to an insecure default when JWT_SECRET is missing', async () => {
        delete process.env.JWT_SECRET;
        await expect(import('./auth')).rejects.toThrow(/JWT_SECRET is not set/);
    });

    it('does not throw, and signs/verifies correctly, when JWT_SECRET is set', async () => {
        process.env.JWT_SECRET = 'test-only-secret-not-a-real-credential';
        const auth = await import('./auth');
        const token = await auth.encrypt({ firmId: 1, adminEmail: 'a@b.com' });
        const payload = await auth.decrypt(token);
        expect(payload.firmId).toBe(1);
        expect(payload.adminEmail).toBe('a@b.com');
    });
});
