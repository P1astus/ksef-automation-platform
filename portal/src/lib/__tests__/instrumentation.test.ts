import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@/lib/deployment', () => ({
    capabilities: () => ({ emailTransport: 'smtp' }),
}));
vi.mock('@/lib/mail-transport', () => ({
    checkMailTransportOperationally: mocks.check,
}));

describe('server startup instrumentation', () => {
    beforeEach(() => mocks.check.mockReset().mockResolvedValue(undefined));

    it('runs the operational SMTP check on Node server startup', async () => {
        vi.stubEnv('NEXT_RUNTIME', 'nodejs');
        const { register } = await import('../../instrumentation');

        await register();

        expect(mocks.check).toHaveBeenCalledOnce();
    });
});
