// Row-level markers on a JPK_V7M(3) sales-register row (SprzedazWiersz),
// per the MF broszura "JPK_VAT z deklaracją [JPK_V7M(3), JPK_V7K(3)]"
// (styczeń 2026, tables 6 and 7) - fetched and read directly, not recalled.
//
//  - GTU_01..GTU_13 and the procedure markers below exist ONLY on the sales
//    side; a purchase row's only comparable marker is IMP, not modelled here.
//  - Each is filled per whole document with "1" and simply omitted otherwise.
//  - The procedure list is WSTO_EE/IED/TP/TT_WNT/TT_D/MR_T/MR_UZ/I_42/I_63/
//    B_SPV/B_SPV_DOSTAWA/B_MPV_PROWIZJA. The older SW and EE markers no longer
//    exist (WSTO_EE replaced both), and there is no MPP row field in the
//    current structure - do not add either back without a current source.

export const GTU_CODES = [
    'GTU_01', 'GTU_02', 'GTU_03', 'GTU_04', 'GTU_05', 'GTU_06', 'GTU_07',
    'GTU_08', 'GTU_09', 'GTU_10', 'GTU_11', 'GTU_12', 'GTU_13',
] as const;

export const PROCEDURE_CODES = [
    'WSTO_EE', 'IED', 'TP', 'TT_WNT', 'TT_D', 'MR_T', 'MR_UZ',
    'I_42', 'I_63', 'B_SPV', 'B_SPV_DOSTAWA', 'B_MPV_PROWIZJA',
] as const;

export type GtuCode = (typeof GTU_CODES)[number];
export type ProcedureCode = (typeof PROCEDURE_CODES)[number];

// Short Polish descriptions for the UI (condensed from tables 6/7).
export const GTU_LABELS: Record<GtuCode, string> = {
    GTU_01: 'Napoje alkoholowe, piwo (CN 2203-2208)',
    GTU_02: 'Towary z art. 103 ust. 5aa (paliwa)',
    GTU_03: 'Oleje opałowe, smarowe i pozostałe oleje',
    GTU_04: 'Wyroby tytoniowe, susz, płyn do e-papierosów',
    GTU_05: 'Odpady (poz. 79-91 zał. 15)',
    GTU_06: 'Urządzenia elektroniczne i części (zał. 15)',
    GTU_07: 'Pojazdy i części (CN 8701-8708)',
    GTU_08: 'Metale szlachetne i nieszlachetne',
    GTU_09: 'Leki, żywność specjalna, wyroby medyczne',
    GTU_10: 'Budynki, budowle, grunty',
    GTU_11: 'Uprawnienia do emisji gazów cieplarnianych',
    GTU_12: 'Usługi niematerialne (doradcze, marketing, IT...)',
    GTU_13: 'Usługi transportowe i gospodarka magazynowa',
};

export const PROCEDURE_LABELS: Record<ProcedureCode, string> = {
    WSTO_EE: 'Sprzedaż na odległość / usługi z art. 28k (OSS)',
    IED: 'Dostawa ułatwiana przez podatnika (art. 7a)',
    TP: 'Powiązania między nabywcą a dostawcą (art. 32 ust. 2 pkt 1)',
    TT_WNT: 'Transakcja trójstronna - WNT (drugi w kolejności)',
    TT_D: 'Transakcja trójstronna - dostawa (drugi w kolejności)',
    MR_T: 'Usługi turystyki - marża (art. 119)',
    MR_UZ: 'Towary używane, dzieła sztuki - marża (art. 120)',
    I_42: 'WDT po imporcie w procedurze celnej 42',
    I_63: 'WDT po imporcie w procedurze celnej 63',
    B_SPV: 'Transfer bonu jednego przeznaczenia (art. 8a ust. 1)',
    B_SPV_DOSTAWA: 'Dostawa/usługa dotycząca bonu jednego przeznaczenia',
    B_MPV_PROWIZJA: 'Pośrednictwo w transferze bonu różnego przeznaczenia',
};

export interface JpkMarkers {
    gtu: GtuCode[];
    procedures: ProcedureCode[];
}

export class InvalidJpkMarkerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidJpkMarkerError';
    }
}

function normalizeList<T extends string>(input: unknown, allowed: readonly T[], what: string): T[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) throw new InvalidJpkMarkerError(`${what}: oczekiwano listy`);
    const seen = new Set<string>();
    for (const v of input) {
        if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
            throw new InvalidJpkMarkerError(`${what}: nieprawidłowy kod ${JSON.stringify(v)}`);
        }
        seen.add(v);
    }
    // Canonical (schema) order, deduplicated.
    return allowed.filter(c => seen.has(c));
}

/** Validates client input; throws InvalidJpkMarkerError on any unknown code. */
export function normalizeJpkMarkers(input: { gtu?: unknown; procedures?: unknown }): JpkMarkers {
    return {
        gtu: normalizeList(input.gtu, GTU_CODES, 'GTU'),
        procedures: normalizeList(input.procedures, PROCEDURE_CODES, 'Oznaczenie procedury'),
    };
}

// Document-type marker: TypDokumentu on a sales row (RO/WEW/FP), DokumentZakupu
// on a purchase row (MK/VAT_RR/WEW) - broszura JPK_V7M(3), both optional. WEW
// is valid on both sides but means different things, so the set is chosen by
// direction. The migration's CHECK holds the union; this is the real rule.
export const SALES_DOC_TYPES = ['RO', 'WEW', 'FP'] as const;
export const PURCHASE_DOC_TYPES = ['MK', 'VAT_RR', 'WEW'] as const;

export const SALES_DOC_TYPE_LABELS: Record<(typeof SALES_DOC_TYPES)[number], string> = {
    RO: 'Zbiorczy dowód sprzedaży z kas rejestrujących',
    WEW: 'Dowód wewnętrzny',
    FP: 'Faktura do paragonu (art. 106h ust. 1)',
};

export const PURCHASE_DOC_TYPE_LABELS: Record<(typeof PURCHASE_DOC_TYPES)[number], string> = {
    MK: 'Faktura dostawcy rozliczającego metodą kasową',
    VAT_RR: 'Faktura VAT RR (także korekta)',
    WEW: 'Dowód wewnętrzny',
};

/** null/undefined/'' -> null (no marker); an unknown code for the direction throws. */
export function normalizeJpkDocType(input: unknown, direction: 'sales' | 'purchase'): string | null {
    if (input === undefined || input === null || input === '') return null;
    const allowed: readonly string[] = direction === 'sales' ? SALES_DOC_TYPES : PURCHASE_DOC_TYPES;
    if (typeof input !== 'string' || !allowed.includes(input)) {
        throw new InvalidJpkMarkerError(
            `Typ dokumentu: nieprawidłowy kod ${JSON.stringify(input)} dla faktury ${direction === 'sales' ? 'sprzedaży' : 'zakupu'}`
        );
    }
    return input;
}
