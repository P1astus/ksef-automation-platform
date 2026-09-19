import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(__dirname, '../../app/dashboard/invoices/new/page.tsx'), 'utf8');

describe('VAT-marża invoice form', () => {
    it('warns that the accountant must confirm the scheme and internal inputs', () => {
        expect(page).toContain('Księgowy odpowiada za potwierdzenie');
        expect(page).toContain('procedura VAT-marża ma zastosowanie');
        expect(page).toContain('marży, stawki i metody rozliczenia');
    });
});
