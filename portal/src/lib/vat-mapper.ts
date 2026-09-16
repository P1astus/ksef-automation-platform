import type { CostCategory } from './classify';

export interface VatMapping {
    kpirColumn: string;     // e.g. "13", "10", "11"
    vatRegisterField: string; // e.g. "K_40", "K_41", "K_42"
    vatRegisterField2?: string;
}

// K_40/K_41 (JPK_V7 ewidencja zakupu) are reserved for purchases of fixed
// assets (środki trwałe) — confirmed against the official MF broszura
// (Tabela 11: "nabycia towarów i usług zaliczanych u podatnika do środków
// trwałych"). K_42/K_43 cover everything else ("nabycia pozostałych
// towarów i usług"). None of this platform's cost categories are trade
// goods or capitalized fixed assets — they're all ordinary operating
// costs — so every one of them belongs in K_42/K_43. Previously every
// category here returned K_40/K_41, meaning every purchase invoice this
// platform ever classified was reported to the tax office as a
// fixed-asset acquisition — the actual JPK_V7M declaration's P_40/P_41
// vs P_42/P_43 split was 100% wrong. If a real fixed-asset category is
// ever added (e.g. a capitalized equipment purchase above the
// capitalization threshold), it should return K_40/K_41 here — the
// vat_register_field is what jpk-generator.ts reads to decide the split,
// so this is the one place that decision needs to change.
const ORDINARY_PURCHASE: VatMapping = { kpirColumn: '13', vatRegisterField: 'K_42', vatRegisterField2: 'K_43' };

/**
 * Deterministic, rule-based mapping of cost categories to KPiR columns and VAT register fields.
 * No AI needed — rules are defined by Polish accounting standards.
 */
export function mapVatColumns(category: CostCategory | string | null | undefined): VatMapping {
    switch (category) {
        case 'transport':
        case 'paliwo':
        case 'materiały_biurowe':
        case 'sprzęt_IT':
        case 'usługi_IT':
        case 'media':
        case 'wynajem':
        case 'marketing':
        case 'usługi_księgowe':
        case 'usługi_budowlane':
        case 'inne':
        default:
            // Column 13 ("Pozostałe wydatki") is correct for every category
            // above — none of them are trade goods (col. 10/11) or wages
            // (col. 12), the only categories KPiR routes elsewhere.
            return ORDINARY_PURCHASE;
    }
}

/** Map all categories to readable KPiR column names for UI display */
export const KPIR_COLUMN_NAMES: Record<string, string> = {
    '10': 'Zakup towarów i materiałów',
    '11': 'Koszty uboczne zakupu',
    '12': 'Wynagrodzenia',
    '13': 'Pozostałe wydatki',
    // Not a selectable category — column 14 is the "Razem wydatki" sum of
    // columns 12+13, never an individual entry's column. mapVatColumns()
    // never returns '14'; kept here only as a display reference.
    '14': 'Razem wydatki (12+13)',
};
