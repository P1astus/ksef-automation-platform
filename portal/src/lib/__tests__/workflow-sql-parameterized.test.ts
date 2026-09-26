import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// No Postgres node in any exported workflow may splice an n8n expression into
// its SQL text: values must travel as `$N` parameters via
// options.queryReplacement. Workflow 01's audit-log nodes built their INSERT
// from webhook fields (client_nip, workflow_name, message, details) until this
// guard was added; 05/06 were converted in round 12.
const dir = join(__dirname, '../../../../workflows');
const files = readdirSync(dir).filter(f => f.endsWith('.json'));

type Node = { name: string; type: string; typeVersion?: number; parameters: Record<string, any> };

function postgresNodes(value: unknown): Node[] {
    if (Array.isArray(value)) return value.flatMap(postgresNodes);
    if (value && typeof value === 'object') {
        const node = value as Node;
        const own = node.type === 'n8n-nodes-base.postgres' && typeof node.parameters?.query === 'string' ? [node] : [];
        return [...own, ...Object.values(value).flatMap(postgresNodes)];
    }
    return [];
}

describe.each(files)('%s', (file) => {
    const nodes = postgresNodes(JSON.parse(readFileSync(join(dir, file), 'utf8')));

    it('never interpolates expressions into SQL text', () => {
        for (const node of nodes) {
            expect(node.parameters.query, `${file} / ${node.name}`).not.toMatch(/\{\{/);
        }
    });

    it('passes every $N placeholder through queryReplacement', () => {
        for (const node of nodes) {
            if (/\$\d/.test(node.parameters.query)) {
                expect(node.parameters.options?.queryReplacement, `${file} / ${node.name}`).toBeTruthy();
            }
        }
    });
});

describe('workflow 01 audit-log nodes', () => {
    const nodes = postgresNodes(JSON.parse(readFileSync(join(dir, '01-send-alert.json'), 'utf8')))
        .filter(n => n.parameters.query.includes('audit_log'));

    it('exist in every serialized copy', () => {
        expect(nodes.length).toBe(8);
    });

    it('pass values as one array expression (commas inside values stay intact, missing values become NULL)', () => {
        for (const node of nodes) {
            // n8n >= 2.5 pushes the items of an array-valued expression one by one;
            // a plain comma-separated list would split a JSON value on its commas.
            expect(node.typeVersion).toBeGreaterThanOrEqual(2.5);
            expect(node.parameters.options.queryReplacement).toMatch(/^=\{\{ \[.*\] \}\}$/);
            expect(node.parameters.options.queryReplacement).toContain('?? null');
            expect(node.parameters.query).toContain('$3::jsonb');
        }
    });
});
