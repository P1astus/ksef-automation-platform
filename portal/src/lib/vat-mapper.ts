import type { CostCategory } from './classify';

export interface VatMapping {
    kpirColumn: string;     // e.g. "13", "10", "11"
    vatRegisterField: string; // e.g. "K_40", "K_41", "K_42"
    vatRegisterField2?: string;
}

/**
 * Deterministic, rule-based mapping of cost categories to KPiR columns and VAT register fields.
 * No AI needed — rules are defined by Polish accounting standards.
 */
export function mapVatColumns(category: CostCategory | string | null | undefined): VatMapping {
    switch (category) {
        case 'transport':
        case 'paliwo':
            // Column 13: Other costs; VAT K_40/K_41 (goods and services related to taxable activity)
            return { kpirColumn: '13', vatRegisterField: 'K_40', vatRegisterField2: 'K_41' };

        case 'materiały_biurowe':
        case 'sprzęt_IT':
        case 'usługi_IT':
            // Column 13: Other costs
            return { kpirColumn: '13', vatRegisterField: 'K_40', vatRegisterField2: 'K_41' };

        case 'media':
            // Column 13: Utilities / overhead
            return { kpirColumn: '13', vatRegisterField: 'K_40', vatRegisterField2: 'K_41' };

        case 'wynajem':
            // Column 13: Rent
            return { kpirColumn: '13', vatRegisterField: 'K_40', vatRegisterField2: 'K_41' };

        case 'marketing':
            // Column 13: Advertising / marketing
            return { kpirColumn: '13', vatRegisterField: 'K_40', vatRegisterField2: 'K_41' };

        case 'usługi_księgowe':
            // Column 13: Professional services (accounting)
            return { kpirColumn: '13', vatRegisterField: 'K_40', vatRegisterField2: 'K_41' };

        case 'usługi_budowlane':
            // Column 13: Construction services
            return { kpirColumn: '13', vatRegisterField: 'K_40', vatRegisterField2: 'K_41' };

        case 'inne':
        default:
            // Default: column 13, standard input VAT
            return { kpirColumn: '13', vatRegisterField: 'K_40', vatRegisterField2: 'K_41' };
    }
}

/** Map all categories to readable KPiR column names for UI display */
export const KPIR_COLUMN_NAMES: Record<string, string> = {
    '10': 'Zakup towarów i materiałów',
    '11': 'Koszty uboczne zakupu',
    '12': 'Wynagrodzenia',
    '13': 'Pozostałe wydatki',
    '14': 'Odpisy amortyzacyjne',
};
