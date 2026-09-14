import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// next_business_day() (ksef-schema.sql) had no iteration bound: if
// business_days has no matching row ahead of from_date, the WHILE loop
// increments check_date forever. Found the hard way writing
// offline-invoice-linking.test.ts's first draft, which forgot to load
// ksef-holidays-init.sql - pegged the CPU at 100% instead of erroring.
// migrations/2026-09-14-bound-next-business-day.sql caps the search at 60
// days and raises a clear exception instead.
//
// The "fails before" case can't literally be reproduced here (an actual
// infinite loop would hang the test suite) - instead, this proves the fixed
// function returns/rejects well within a short explicit timeout, which is
// exactly the bound the old, unbounded version had no equivalent of.

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('next_business_day() has a bound (was an unbounded loop)', () => {
    let dbWithHolidays: PGlite;
    let dbWithoutHolidays: PGlite;

    beforeAll(async () => {
        dbWithHolidays = new PGlite();
        for (const file of ['ksef-schema.sql', join('migrations', '2026-09-14-bound-next-business-day.sql'), 'ksef-holidays-init.sql']) {
            await dbWithHolidays.exec(readFileSync(join(ROOT, file), 'utf8'));
        }

        // Deliberately no ksef-holidays-init.sql - business_days stays empty,
        // reproducing exactly the condition that used to hang forever.
        dbWithoutHolidays = new PGlite();
        for (const file of ['ksef-schema.sql', join('migrations', '2026-09-14-bound-next-business-day.sql')]) {
            await dbWithoutHolidays.exec(readFileSync(join(ROOT, file), 'utf8'));
        }
    });

    afterAll(async () => {
        await dbWithHolidays.close();
        await dbWithoutHolidays.close();
    });

    it('still correctly rolls a Friday to the following Monday when business_days is populated', async () => {
        const res = await dbWithHolidays.query<{ d: string | Date }>(`SELECT next_business_day('2026-09-11'::date) AS d`);
        expect(new Date(res.rows[0].d).toISOString().startsWith('2026-09-14')).toBe(true);
    }, 3000);

    it('raises a clear exception within the bound instead of hanging when business_days is empty', async () => {
        await expect(
            dbWithoutHolidays.query(`SELECT next_business_day('2026-01-01'::date) AS d`)
        ).rejects.toThrow(/no business day found within 60 days/);
    }, 3000);
});
