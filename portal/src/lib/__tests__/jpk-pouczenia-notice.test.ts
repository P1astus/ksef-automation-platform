import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

// Pouczenia=1 is emitted automatically by the generator (explicit decision, round 19).
// The UI must always tell the accountant it is the software's suggestion and needs their confirmation.
const page = readFileSync(join(__dirname, '../../app/dashboard/jpk/page.tsx'), 'utf8');

describe('JPK page Pouczenia notice', () => {
    it('states it is inserted automatically and must be confirmed by the accountant', () => {
        expect(page).toContain('propozycja naszego oprogramowania');
        expect(page).toContain('księgowy musi je przeczytać i potwierdzić');
    });

    it('is shown both before generating and next to the download', () => {
        expect(page.match(/<PouczeniaNotice \/>/g)?.length).toBe(2);
    });
});
