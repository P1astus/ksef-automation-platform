import { describe, expect, it, vi } from 'vitest';

describe('recover-admin CLI core', () => {
    it('creates a one-hour reset URL for the requested active owner', async () => {
        const { createAdminRecovery } = await import('../../../scripts/recover-admin.mjs');
        const query = vi.fn(async () => ({ rows: [{ id: 9, admin_email: 'owner@example.test' }] }));

        const result = await createAdminRecovery({
            query,
            email: ' OWNER@example.test ',
            appUrl: 'https://ksef.lan/',
            now: new Date('2026-09-20T12:00:00.000Z'),
            randomBytes: () => Buffer.alloc(32, 0xab),
        });

        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE firms'),
            [
                'owner@example.test',
                'ab'.repeat(32),
                new Date('2026-09-20T13:00:00.000Z'),
            ]
        );
        expect(result).toEqual({
            email: 'owner@example.test',
            resetUrl: `https://ksef.lan/reset-password/${'ab'.repeat(32)}`,
            expiresAt: new Date('2026-09-20T13:00:00.000Z'),
        });
    });

    it('does not print a plausible URL when the owner does not exist', async () => {
        const { createAdminRecovery } = await import('../../../scripts/recover-admin.mjs');
        const query = vi.fn(async () => ({ rows: [] }));

        await expect(createAdminRecovery({
            query,
            email: 'missing@example.test',
            appUrl: 'https://ksef.lan',
        })).rejects.toThrow(/active owner/i);
    });
});
