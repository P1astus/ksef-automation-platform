import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Audit finding (round 3): n8n Code nodes reimplemented the sidecar's RSA-OAEP-SHA256 encryption locally. Those were
// consolidated onto the sidecar, and the nodes that did it (workflows 02 and 04) have since been replaced by the
// invoice-retrieval job, which reaches the sidecar only through lib/ksef-client.ts (guarded by sidecar-api-key.test.ts and
// d7-env-plumbing.test.ts). What remains worth pinning here: every retained workflow export is valid JSON and none of
// them does RSA-OAEP locally again.

const WORKFLOWS = join(__dirname, '..', '..', '..', '..', 'workflows');

describe('retained n8n workflows', () => {
    const files = readdirSync(WORKFLOWS).filter(f => f.endsWith('.json'));

    it('are all valid JSON', () => {
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) expect(() => JSON.parse(readFileSync(join(WORKFLOWS, file), 'utf8'))).not.toThrow();
    });

    it.each(files)('%s does no RSA-OAEP locally (crypto.publicEncrypt) - that belongs to the sidecar', (file) => {
        expect(readFileSync(join(WORKFLOWS, file), 'utf8')).not.toContain('crypto.publicEncrypt(');
    });
});
