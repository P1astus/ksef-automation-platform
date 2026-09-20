import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// The exported workflow JSON must never declare itself active. Importing an export with `"active": true` re-arms it
// immediately, and workflows 04 and 05 still carry known correctness defects (04 advances its high-water mark with
// the wall clock; 05 writes a VAT marker without a firm filter) until they are ported off n8n. Activation is a
// per-environment decision the user makes, never something an import does on its own.
const DIR = join(__dirname, '..', '..', '..', '..', 'workflows');
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

describe('workflow exports are inactive', () => {
    it('finds the workflow files', () => {
        expect(files.length).toBeGreaterThanOrEqual(7);
    });

    it.each(files)('%s does not declare active: true', (file) => {
        const wf = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
        expect(wf.active).not.toBe(true);
    });
});
