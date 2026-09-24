import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { clientNotificationsOffline24Job, clientNotificationsReceivablesJob } from '@/lib/jobs/client-notifications';

const root = join(__dirname, '..', '..', '..', '..');

describe('health and notification workflow failure handling', () => {
    it('binds all health status and JSON detail values in both serialized copies', () => {
        const workflow = JSON.parse(readFileSync(join(root, 'workflows', '03-health-check.json'), 'utf8'));
        for (const nodes of [workflow.nodes, workflow.activeVersion.nodes]) {
            const logHealth = nodes.find((node: { name: string }) => node.name === 'Log Health Status');
            expect(logHealth.parameters.query).toContain("('ksef_api', $1, $2, NOW())");
            expect(logHealth.parameters.query).toContain("('java_sidecar', $3, $4, NOW())");
            expect(logHealth.parameters.query).toContain("('app_database', $5, $6, NOW())");
            expect(logHealth.parameters.query).not.toContain('{{');
            expect(logHealth.parameters.options.queryReplacement).toContain('JSON.stringify');
        }
    });

    it('routes an unhealthy health-check result to the alert branch in both serialized copies', () => {
        const workflow = JSON.parse(readFileSync(join(root, 'workflows', '03-health-check.json'), 'utf8'));
        for (const graph of [workflow.connections, workflow.activeVersion.connections]) {
            const branches = graph['All Healthy?'].main;
            expect(branches[0][0].node).toBe('Send Health Alert'); // notEquals healthy = true branch
            expect(branches[1][0].node).toBe('Log Health Status');
        }
    });

    it('retires workflow 09 while retaining both scheduled notification jobs and API routes', () => {
        expect(existsSync(join(root, 'workflows', '09-client-notifications.json'))).toBe(false);
        expect(clientNotificationsOffline24Job.schedule).toEqual({ kind: 'cron', expr: '0 */2 * * *', timezone: 'Europe/Warsaw' });
        expect(clientNotificationsReceivablesJob.schedule).toEqual({ kind: 'cron', expr: '0 8 * * 1', timezone: 'Europe/Warsaw' });
        expect(existsSync(join(root, 'portal', 'src', 'app', 'api', 'notify', 'offline24', 'route.ts'))).toBe(true);
        expect(existsSync(join(root, 'portal', 'src', 'app', 'api', 'notify', 'receivables', 'route.ts'))).toBe(true);
    });
});
