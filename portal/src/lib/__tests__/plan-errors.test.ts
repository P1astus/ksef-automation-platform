import { describe, it, expect } from 'vitest';
import { interpretApiFailure, readApiFailure } from '../plan-errors';
import { subscriptionInactiveResponse, upgradeRequiredResponse } from '../entitlements';

describe('interpretApiFailure', () => {
    it('flags the real 403 PLAN_UPGRADE_REQUIRED response as a plan error', async () => {
        const res = upgradeRequiredResponse('exports');
        const f = await readApiFailure(res as unknown as Response, 'x');
        expect(f.isPlanError).toBe(true);
        expect(f.status).toBe(403);
        expect(f.message).toMatch(/wymaga planu/);
    });

    it('flags the real 402 SUBSCRIPTION_INACTIVE response as a plan error', async () => {
        const res = subscriptionInactiveResponse('canceled');
        const f = await readApiFailure(res as unknown as Response, 'x');
        expect(f.isPlanError).toBe(true);
        expect(f.status).toBe(402);
    });

    it('does not treat an unrelated 403 as a plan error', () => {
        const f = interpretApiFailure(403, { error: 'Brak uprawnień' }, 'x');
        expect(f.isPlanError).toBe(false);
        expect(f.message).toBe('Brak uprawnień');
    });

    it('falls back when the body has no usable error text', () => {
        expect(interpretApiFailure(500, null, 'Błąd').message).toBe('Błąd');
        expect(interpretApiFailure(500, { error: 42 }, 'Błąd').message).toBe('Błąd');
    });

    it('tolerates a non-JSON body', async () => {
        const res = new Response('<html>oops</html>', { status: 502 });
        const f = await readApiFailure(res, 'Błąd wysyłki');
        expect(f).toEqual({ message: 'Błąd wysyłki', isPlanError: false, status: 502 });
    });
});
