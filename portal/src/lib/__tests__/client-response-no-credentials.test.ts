import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

// Client responses go to the browser: they must list their columns explicitly,
// so stored KSeF token/certificate material can never ride along in a
// `SELECT *` or `RETURNING *` (round 18).
const ROUTES = ['app/api/clients/route.ts', 'app/api/clients/[id]/route.ts'];

describe('client API responses never carry stored credentials', () => {
    for (const rel of ROUTES) {
        const src = readFileSync(join(__dirname, '..', '..', rel), 'utf8');
        it(`${rel} has no SELECT * / RETURNING * on clients`, () => {
            expect(src).not.toMatch(/SELECT\s+\*\s+FROM\s+clients/i);
            expect(src).not.toMatch(/SELECT\s+c\.\*/i);
            expect(src).not.toMatch(/RETURNING\s+\*/i);
        });
        it(`${rel} does not select the credential columns`, () => {
            expect(src).not.toMatch(/ksef_token_encrypted|certificate_password|certificate_data/);
        });
    }
});
