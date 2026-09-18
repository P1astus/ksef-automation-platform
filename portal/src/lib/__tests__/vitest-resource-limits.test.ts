import { describe, expect, it } from 'vitest';
import config from '../../../vitest.config';

describe('Vitest resource limits', () => {
    it('bounds fork concurrency for PGlite-heavy integration tests', () => {
        expect(config.test?.pool).toBe('forks');
        expect(config.test?.poolOptions?.forks?.maxForks).toBeGreaterThan(0);
        expect(config.test?.poolOptions?.forks?.maxForks).toBeLessThanOrEqual(4);
    });

    it('allows database setup hooks to finish on a busy runner', () => {
        expect(config.test?.hookTimeout).toBeGreaterThanOrEqual(30_000);
    });
});
