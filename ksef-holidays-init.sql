-- KSeF Automation Platform - Polish Business Days Calendar 2026-2028
-- Populates business_days table with all dates, marking holidays and weekends

-- Helper function to populate a date range
DO $$
DECLARE
    d DATE;
BEGIN
    -- Generate all dates from 2026-01-01 to 2028-12-31
    FOR d IN SELECT generate_series('2026-01-01'::DATE, '2028-12-31'::DATE, '1 day'::INTERVAL)::DATE
    LOOP
        INSERT INTO business_days (date, is_business_day, holiday_name)
        VALUES (
            d,
            EXTRACT(DOW FROM d) NOT IN (0, 6), -- 0=Sunday, 6=Saturday
            NULL
        );
    END LOOP;
END $$;

-- Polish Fixed Holidays (Ustawowe dni wolne od pracy)
-- Applied for all 3 years

-- Nowy Rok (New Year's Day) - January 1
UPDATE business_days SET is_business_day = false, holiday_name = 'Nowy Rok'
WHERE date IN ('2026-01-01', '2027-01-01', '2028-01-01');

-- Trzech Kroli (Epiphany) - January 6
UPDATE business_days SET is_business_day = false, holiday_name = 'Trzech Kroli'
WHERE date IN ('2026-01-06', '2027-01-06', '2028-01-06');

-- Swieto Pracy (Labour Day) - May 1
UPDATE business_days SET is_business_day = false, holiday_name = 'Swieto Pracy'
WHERE date IN ('2026-05-01', '2027-05-01', '2028-05-01');

-- Swieto Konstytucji 3 Maja (Constitution Day) - May 3
UPDATE business_days SET is_business_day = false, holiday_name = 'Swieto Konstytucji 3 Maja'
WHERE date IN ('2026-05-03', '2027-05-03', '2028-05-03');

-- Wniebowziecie NMP (Assumption of Mary) - August 15
UPDATE business_days SET is_business_day = false, holiday_name = 'Wniebowziecie NMP'
WHERE date IN ('2026-08-15', '2027-08-15', '2028-08-15');

-- Wszystkich Swietych (All Saints' Day) - November 1
UPDATE business_days SET is_business_day = false, holiday_name = 'Wszystkich Swietych'
WHERE date IN ('2026-11-01', '2027-11-01', '2028-11-01');

-- Swieto Niepodleglosci (Independence Day) - November 11
UPDATE business_days SET is_business_day = false, holiday_name = 'Swieto Niepodleglosci'
WHERE date IN ('2026-11-11', '2027-11-11', '2028-11-11');

-- Boze Narodzenie (Christmas Day) - December 25
UPDATE business_days SET is_business_day = false, holiday_name = 'Boze Narodzenie (dzien 1)'
WHERE date IN ('2026-12-25', '2027-12-25', '2028-12-25');

-- Drugi dzien Bozego Narodzenia (St. Stephen's Day) - December 26
UPDATE business_days SET is_business_day = false, holiday_name = 'Boze Narodzenie (dzien 2)'
WHERE date IN ('2026-12-26', '2027-12-26', '2028-12-26');

-- Polish Moveable Holidays (based on Easter)
-- Easter Sunday dates (computed using the Anonymous Gregorian algorithm):
--   2026: April 5
--   2027: March 28
--   2028: April 16

-- Wielkanoc (Easter Sunday)
UPDATE business_days SET is_business_day = false, holiday_name = 'Wielkanoc (Niedziela Wielkanocna)'
WHERE date IN ('2026-04-05', '2027-03-28', '2028-04-16');

-- Poniedzialek Wielkanocny (Easter Monday) = Easter + 1
UPDATE business_days SET is_business_day = false, holiday_name = 'Poniedzialek Wielkanocny'
WHERE date IN ('2026-04-06', '2027-03-29', '2028-04-17');

-- Zeslanie Ducha Swietego (Whit Sunday / Pentecost) = Easter + 49
UPDATE business_days SET is_business_day = false, holiday_name = 'Zeslanie Ducha Swietego'
WHERE date IN ('2026-05-24', '2027-05-16', '2028-06-04');

-- Boze Cialo (Corpus Christi) = Easter + 60
UPDATE business_days SET is_business_day = false, holiday_name = 'Boze Cialo'
WHERE date IN ('2026-06-04', '2027-05-27', '2028-06-15');
