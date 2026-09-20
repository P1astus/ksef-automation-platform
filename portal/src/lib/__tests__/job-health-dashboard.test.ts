import { describe, expect, it, vi } from 'vitest';
import { loadJobHealth } from '../jobs/dashboard';

describe('job health dashboard data', () => {
    it('loads occurrences, alert delivery errors, and latest health rows including SMTP', async () => {
        const query = vi.fn(async (sql: string) => {
            if (sql.includes('job_occurrences')) return { rows: [{ job_name: 'health-check', state: 'failed', attempts: 3, last_error: 'timeout' }] };
            if (sql.includes('system_alerts')) return { rows: [{ firm_id: 7, source: 'health-check', delivery_error: 'smtp down' }] };
            return { rows: [{ check_type: 'smtp', status: 'error', details: { error: 'connection refused' } }] };
        });
        const result = await loadJobHealth({ query }, 7);

        expect(result.occurrences[0]).toMatchObject({ attempts: 3, last_error: expect.stringContaining('operatorowi') });
        expect(result.alerts[0]).toMatchObject({ delivery_error: 'smtp down' });
        expect(result.health[0]).toMatchObject({ check_type: 'smtp', status: 'error' });
        const alertCall = (query.mock.calls as any[][]).find(([sql]) => sql.includes('system_alerts'))!;
        expect(alertCall[1]).toEqual([7, 50]);
    });
});

 it('does not disclose other firms through global occurrence results or errors', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('job_occurrences') ? [{
        id: '1', job_name: 'invoice-retrieval', last_error: 'secret other client token error',
        result: { processed: 4, detail: { perClient: [{ nip: 'other-nip' }] }, failures: [
            { firmId: 7, subject: 'ours', error: 'ours failed' },
            { firmId: 8, subject: 'other secret client', error: 'other failed' },
        ] },
    }] : [] }));
    const result = await loadJobHealth({ query }, 7);
    const json = JSON.stringify(result);
    expect(json).toContain('ours failed');
    expect(json).not.toContain('other');
    expect(json).not.toContain('perClient');
 });
