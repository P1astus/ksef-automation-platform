-- next_business_day() had no iteration bound. If business_days is ever
-- empty or exhausted (ksef-holidays-init.sql only seeds 2026-01-01 through
-- 2028-12-31), the WHILE loop increments check_date forever looking for a
-- row that will never exist - found the hard way writing a pglite test that
-- forgot to load the holidays file: pegged the CPU at 100% instead of
-- erroring. Real deployment risk is the same shape: nobody extends
-- business_days past 2028, and every deadline computation after that starts
-- spinning instead of failing loudly.
--
-- Fix: cap the search at 60 calendar days (generously covers any realistic
-- run of consecutive holidays/weekends - the longest gap in
-- ksef-holidays-init.sql's actual calendar is a handful of days) and raise a
-- clear exception instead of looping past it. A real business day always
-- exists within a couple of weeks in practice; hitting the cap means
-- business_days itself needs attention, not that the caller should wait
-- longer.

CREATE OR REPLACE FUNCTION next_business_day(from_date DATE) RETURNS DATE AS $$
DECLARE
    check_date DATE := from_date + 1;
    max_date DATE := from_date + 60;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM business_days WHERE date = check_date AND is_business_day = true
    ) LOOP
        check_date := check_date + 1;
        IF check_date > max_date THEN
            RAISE EXCEPTION 'next_business_day(%): no business day found within 60 days - business_days is likely empty or its seeded range has been exhausted (see ksef-holidays-init.sql)', from_date;
        END IF;
    END LOOP;
    RETURN check_date;
END;
$$ LANGUAGE plpgsql;
