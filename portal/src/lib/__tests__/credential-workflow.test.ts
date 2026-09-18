import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('encrypted credentials stay usable by n8n', () => {
    it('passes the key to both services and decrypts both workflow-02 node copies', () => {
        const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
        expect(compose.match(/KSEF_CREDENTIALS_KEY=/g)).toHaveLength(2);

        const workflow = JSON.parse(readFileSync(join(ROOT, 'workflows/02-ksef-authenticate.json'), 'utf8'));
        const top = workflow.nodes.find((node: any) => node.name === 'Prepare Auth Data');
        const embedded = workflow.activeVersion.nodes.find((node: any) => node.name === 'Prepare Auth Data');
        for (const node of [top, embedded]) {
            expect(node.parameters.jsCode).toContain("startsWith('enc:v1:')");
            expect(node.parameters.jsCode).toContain("decipher.setAAD(Buffer.from('ksef-client:' + clientData.id))");
            expect(node.parameters.jsCode).toContain('$env.KSEF_CREDENTIALS_KEY');
        }
    });
});
