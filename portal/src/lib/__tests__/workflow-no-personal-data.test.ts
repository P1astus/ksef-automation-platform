import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// The repository is public. Exported workflows must not carry a person's
// e-mail address or name (n8n exports include project/owner metadata and the
// addresses typed into e-mail nodes); operators set their own recipient.
const dir = join(__dirname, '../../../../workflows');

describe.each(readdirSync(dir).filter(f => f.endsWith('.json')))('%s', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');

    it('contains no personal mailbox addresses', () => {
        const addresses = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
        for (const address of addresses) expect(address).toMatch(/@(example\.(invalid|com|test|org)|test\.ksef\.local)$/);
    });

    it('contains no personal names in export metadata', () => {
        expect(text).not.toMatch(/Potrykowski/i);
    });
});
