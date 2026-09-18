-- Round 16: row-level JPK_V7M(3) sales-register markers (GTU_01..13 and the
-- procedure markers WSTO_EE/IED/TP/TT_WNT/TT_D/MR_T/MR_UZ/I_42/I_63/B_SPV/
-- B_SPV_DOSTAWA/B_MPV_PROWIZJA). Stored per invoice because JPK reports them
-- per whole document ("1" or omitted), never per line. Only meaningful for
-- direction = 'sales'; jpk/generate ignores them on purchases.
-- The allowed values mirror portal/src/lib/jpk-markers.ts - keep in sync.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_gtu TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_procedures TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_jpk_gtu_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_jpk_gtu_check
    CHECK (jpk_gtu <@ ARRAY['GTU_01','GTU_02','GTU_03','GTU_04','GTU_05','GTU_06','GTU_07',
                            'GTU_08','GTU_09','GTU_10','GTU_11','GTU_12','GTU_13']::TEXT[]);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_jpk_procedures_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_jpk_procedures_check
    CHECK (jpk_procedures <@ ARRAY['WSTO_EE','IED','TP','TT_WNT','TT_D','MR_T','MR_UZ',
                                   'I_42','I_63','B_SPV','B_SPV_DOSTAWA','B_MPV_PROWIZJA']::TEXT[]);
