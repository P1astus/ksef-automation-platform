import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..', '..');

describe('health and notification workflow failure handling', () => {
    it('routes an unhealthy health-check result to the alert branch in both serialized copies', () => {
        const workflow = JSON.parse(readFileSync(join(root, 'workflows', '03-health-check.json'), 'utf8'));
        for (const graph of [workflow.connections, workflow.activeVersion.connections]) {
            const branches = graph['All Healthy?'].main;
            expect(branches[0][0].node).toBe('Send Health Alert'); // notEquals healthy = true branch
            expect(branches[1][0].node).toBe('Log Health Status');
        }
    });

    it('does not convert notification delivery failures into successful workflow output', () => {
        const workflow = JSON.parse(readFileSync(join(root, 'workflows', '09-client-notifications.json'), 'utf8'));
        const calls = workflow.nodes.filter((node: { name: string }) => node.name.startsWith('Call Notify'));
        expect(calls).toHaveLength(2);
        expect(calls.every((node: { onError: string }) => node.onError === 'stopWorkflow')).toBe(true);
    });
});
