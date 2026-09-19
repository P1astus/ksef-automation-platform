import { sumLinesByRate, type InvoiceLine, type VatRateCode } from './ksef-invoice-builder';
import { mapVatColumns } from './vat-mapper';
import { normalizeJpkMarkers, normalizeJpkDocType } from './jpk-markers';
import { isValidTaxOfficeCode } from './tax-office-codes';
import { isValidCountryCode } from './country-codes';

// Namespace and structure of JPK_V7M(3), schema v1-0E (mandatory from the
// 2026-02 period). Taken from the official XSD, vendored in
// schemas/jpk-v7m3/ - the generated file is validated against it in
// jpk-generator-xsd.test.ts. Do not edit these from memory.
const JPK_NAMESPACE = 'http://crd.gov.pl/wzor/2025/12/19/14090/';
const ETD_NAMESPACE = 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/';
const FIRST_V7M3_PERIOD = '2026-02';

// TNumerKSeF from the XSD, verbatim.
const KSEF_NUMBER_RE = /^([1-9]((\d[1-9])|([1-9]\d))\d{7}|M\d{9}|[A-Z]{3}\d{7})-(20[2-9][0-9]|2[1-9][0-9]{2}|[3-9][0-9]{3})(0[1-9]|1[0-2])(0[1-9]|[1-2][0-9]|3[0-1])-([0-9A-F]{6})-?([0-9A-F]{6})-([0-9A-F]{2})$/;
const EMAIL_RE = /^.+@.+$/; // TAdresEmail: (.)+@(.)+, 3-255 chars
const NIP_RE = /^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/;

/**
 * Raised when the data can't be turned into a valid JPK_V7M(3) file. The
 * message lists every problem found, so a caller can show them all at once
 * (jpk/generate answers 422 with it) rather than one regeneration at a time.
 */
export class JpkGenerationError extends Error {
    constructor(public readonly problems: string[]) {
        super(problems.join('; '));
        this.name = 'JpkGenerationError';
    }
}

export interface JpkFirmData {
    nip: string;
    name: string;
    fullName?: string;
    // Naglowek/KodUrzedu - the tax office the declaration goes to. Required by
    // the schema; there is no sensible default (clients.tax_office_code).
    taxOfficeCode?: string | null;
    // Podmiot1/Email - the taxpayer's e-mail; required by the schema
    // (clients.contact_email).
    email?: string | null;
    // Podmiot1 is OsobaNiefizyczna (default) or, for a sole trader, OsobaFizyczna,
    // which the schema wants with first name, surname and date of birth.
    taxpayerType?: 'company' | 'individual' | null;
    firstName?: string | null;
    lastName?: string | null;
    birthDate?: string | Date | null;
}

export interface JpkOptions {
    // CelZlozenia: 1 = first filing (default), 2 = correction of a filed period.
    purpose?: 1 | 2;
}

export interface JpkInvoiceRow {
    id: number;
    invoice_number: string;
    // `pg` returns a DATE column as a JS Date, not a string - despite the
    // query results always having come from the live DB in practice, this
    // was typed (and called with .slice()) as if it were always a string,
    // which throws for any row that didn't go through pglite/a mock.
    issue_date: string | Date | null;
    seller_name: string;
    seller_nip?: string;
    buyer_name: string;
    buyer_nip?: string;
    net_amount: number | string;
    vat_amount: number | string;
    gross_amount: number | string;
    direction: 'sales' | 'purchase';
    jpk_marker?: string;
    jpk_period?: string;
    jpk_correction_needed?: boolean;
    ksef_number?: string;
    // Purchase-side only: drives the K_40/K_41 (fixed assets) vs K_42/K_43
    // (everything else) split via mapVatColumns() - see vat-mapper.ts.
    cost_category?: string | null;
    // Sales-side only: per-line VAT rate breakdown, present only for
    // invoices created through this platform (invoices.invoice_lines
    // JSONB - see invoices/create/route.ts). Invoices synced in from KSeF
    // have no line-level data, so their rate is unknown - see
    // salesContribution()'s fallback below.
    invoice_lines?: InvoiceLine[] | null;
    // For a correction, the route supplies the original line set so the
    // register can report corrected minus original values by VAT rate.
    corrected_original_lines?: InvoiceLine[] | null;
    // Sales-side only: row-level GTU_xx / procedure markers (jpk-markers.ts).
    jpk_gtu?: string[] | null;
    jpk_procedures?: string[] | null;
    // TypDokumentu (sales: RO/WEW/FP) or DokumentZakupu (purchase: MK/VAT_RR/WEW).
    jpk_doc_type?: string | null;
    // Purchase-side IMP flag (import of goods).
    jpk_import?: boolean | null;
    // DataSprzedazy (sales): date of supply when it differs from the issue date.
    delivery_date?: string | Date | null;
    // Purchases: when the document was received. For a KSeF invoice that is the
    // moment KSeF assigned its number; DataWplywu is written only if that day
    // differs from the purchase date.
    ksef_acquisition_date?: string | Date | null;
    // KodKrajuNadaniaTIN: country that issued a foreign contractor's tax number.
    jpk_counterparty_country?: string | null;
    // SprzedazVAT_Marza / ZakupVAT_Marza: gross value under the margin scheme.
    jpk_margin_gross?: number | string | null;
    // Internal VAT-inclusive taxable margin. Unlike jpk_margin_gross, this
    // is never buyer-facing; it is split into the K fields only.
    jpk_margin_taxable_gross?: number | string | null;
    jpk_margin_vat_rate?: '5' | '8' | '23' | string | null;
    jpk_margin_method?: 'individual' | 'sum' | string | null;
}

function esc(s: string | undefined | null): string {
    if (!s) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function num(n: number | string | undefined | null): number {
    return parseFloat(String(n ?? 0)) || 0;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function fmt2(n: number): string {
    return n.toFixed(2);
}

// pg's DATE parser builds a local-time Date (new Date(y, m-1, d), no
// timezone) - using .toISOString() here would convert to UTC and could
// shift the calendar day, so this reads the local getters back instead.
function fmtDate(v: string | Date | null | undefined): string {
    if (!v) return '';
    if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    return String(v).slice(0, 10);
}

// A timestamptz as the Polish calendar day it fell on. Not the server's local
// day (the portal container runs in UTC): a KSeF number assigned at 23:30 on
// the 31st must not become the 1st of the next month in the register.
function warsawDate(v: string | Date | null | undefined): string {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// KodKrajuNadaniaTIN + NrKontrahenta. The number is written WITHOUT the
// country prefix (broszura); a Polish contractor gets no country element.
function contractorTin(nip: string | undefined | null, country: string | null | undefined): { country: string; number: string } {
    const cleaned = String(nip ?? '').replace(/[\s-]/g, '');
    const code = country && country !== 'PL' ? country : '';
    const number = code && cleaned.toUpperCase().startsWith(code) ? cleaned.slice(code.length) : cleaned;
    return { country: code, number: number || 'BRAK' };
}

// Ewidencja sprzedaży (K_10-K_36) field pair per VAT rate, confirmed
// against the official MF broszura ("Opis struktury ewidencji w zakresie
// podatku należnego"). Rates with no VAT amount (zw/0%/WDT/export) only
// ever populate the net field.
//
// Round 10 dropped the 'oo' (domestic reverse charge) rate this used to
// route to K_31 - confirmed against the current text of the VAT act that
// art. 17 ust. 1 pkt 7/8 (what 'oo' modeled) were repealed 2019-11-01,
// replaced by mandatory split payment. See ksef-invoice-builder.ts's
// VatRateCode doc comment for the full finding.
const SALES_RATE_FIELD: Record<VatRateCode, { net: string; vat: string | null }> = {
    'zw': { net: 'K_10', vat: null },
    '0': { net: 'K_13', vat: null },
    '0-wdt': { net: 'K_21', vat: null },
    '0-export': { net: 'K_22', vat: null },
    '5': { net: 'K_15', vat: 'K_16' },
    '8': { net: 'K_17', vat: 'K_18' },
    '23': { net: 'K_19', vat: 'K_20' },
};

// Fixed schema order for the K fields this platform ever emits, so a
// multi-rate invoice's SprzedazWiersz lists them consistently.
const SALES_FIELD_ORDER = ['K_10', 'K_13', 'K_15', 'K_16', 'K_17', 'K_18', 'K_19', 'K_20', 'K_21', 'K_22'];

// Per-invoice K-field contributions for the sales register. When line-level
// rate data exists (invoices created through this platform), splits by the
// real rate of each line. Otherwise (invoices synced in from KSeF, which
// carry only an aggregate net/vat total) falls back to the historical
// single-bucket assumption: standard-rate (23%) domestic sale - the only
// assumption available without per-line data.
function salesContribution(inv: JpkInvoiceRow): Partial<Record<string, number>> {
    const contrib: Partial<Record<string, number>> = {};
    const lines = Array.isArray(inv.invoice_lines) ? inv.invoice_lines : null;
    if (lines && lines.length > 0) {
        const byRate = sumLinesByRate(lines);
        const originalByRate = Array.isArray(inv.corrected_original_lines)
            ? sumLinesByRate(inv.corrected_original_lines)
            : {};
        const rates = new Set<VatRateCode>([
            ...(Object.keys(byRate) as VatRateCode[]),
            ...(Object.keys(originalByRate) as VatRateCode[]),
        ]);
        for (const rate of rates) {
            const corrected = byRate[rate] || { net: 0, vat: 0 };
            const original = originalByRate[rate] || { net: 0, vat: 0 };
            const field = SALES_RATE_FIELD[rate];
            contrib[field.net] = round2((contrib[field.net] || 0) + corrected.net - original.net);
            if (field.vat) contrib[field.vat] = round2((contrib[field.vat] || 0) + corrected.vat - original.vat);
        }
    } else {
        contrib['K_19'] = num(inv.net_amount);
        contrib['K_20'] = num(inv.vat_amount);
    }
    return contrib;
}

// Every register row must carry exactly one of NrKSeF / OFF / BFK / DI.
// A KSeF number the invoice already has wins (NrKSeF is "filled when on the
// filing date the invoice has a number"); otherwise the stored marker. An
// invoice with neither is a problem the operator has to resolve - guessing a
// marker would be a wrong VAT marker in a filed report.
function ksefReference(inv: JpkInvoiceRow, problems: string[]): string {
    const number = (inv.ksef_number || '').trim();
    if (number) {
        if (KSEF_NUMBER_RE.test(number)) return `<tns:NrKSeF>${number}</tns:NrKSeF>`;
        problems.push(`faktura ${inv.invoice_number}: numer KSeF "${number}" nie ma prawidłowego formatu`);
        return '';
    }
    if (inv.jpk_marker === 'OFF' || inv.jpk_marker === 'BFK' || inv.jpk_marker === 'DI') {
        return `<tns:${inv.jpk_marker}>1</tns:${inv.jpk_marker}>`;
    }
    problems.push(`faktura ${inv.invoice_number}: brak numeru KSeF i oznaczenia OFF/BFK/DI`);
    return '';
}

/**
 * Generates JPK_V7M(3) XML (monthly VAT report with declaration), schema
 * v1-0E, valid from the 2026-02 period. Structure and namespace come from the
 * official XSD in schemas/jpk-v7m3/. Throws JpkGenerationError when the input
 * can't produce a valid file (unknown tax office, malformed NIP, a row with no
 * KSeF number or OFF/BFK/DI marker, ...).
 */
export function generateJpkV7M(
    firm: JpkFirmData,
    period: string, // YYYY-MM
    invoices: JpkInvoiceRow[],
    options: JpkOptions = {}
): string {
    const [year, month] = period.split('-');
    const periodStart = `${year}-${month}-01`;
    const now = new Date().toISOString();
    const problems: string[] = [];

    if (period < FIRST_V7M3_PERIOD) {
        throw new JpkGenerationError([`JPK_V7M(3) obowiązuje od okresu ${FIRST_V7M3_PERIOD}; za ${period} obowiązuje wcześniejsza struktura`]);
    }
    if (!isValidTaxOfficeCode(firm.taxOfficeCode)) {
        problems.push('brak prawidłowego kodu urzędu skarbowego klienta (4 cyfry z listy MF)');
    }
    if (firm.taxpayerType === 'individual') {
        if (!firm.firstName?.trim() || !firm.lastName?.trim() || !fmtDate(firm.birthDate)) {
            problems.push('podatnik będący osobą fizyczną wymaga imienia, nazwiska i daty urodzenia');
        }
    }
    if (!EMAIL_RE.test(firm.email ?? '')) {
        problems.push('brak adresu e-mail podatnika (wymagany w Podmiot1) - uzupełnij e-mail kontaktowy klienta');
    }
    if (!NIP_RE.test(firm.nip)) problems.push(`nieprawidłowy NIP podatnika: ${firm.nip}`);

    const sales = invoices.filter(i => i.direction === 'sales');
    const purchases = invoices.filter(i => i.direction === 'purchase');

    // Sales rows + running per-field totals
    const salesTotals: Record<string, number> = {};
    // Negative VAT-marża bases remain in the register but must not lower the
    // declaration (MF brochure, VAT-marża section).
    const declarationSalesTotals: Record<string, number> = {};
    const sumMarginRows: { procedure: 'MR_T' | 'MR_UZ'; rate: '5' | '8' | '23'; gross: number }[] = [];
    const salesRows = sales.map((inv, idx) => {
        const prefix = inv.jpk_correction_needed ? 'COR' : '';
        // Throws on an unknown code rather than emitting a marker the schema
        // doesn't define - a filed JPK with a bogus element is worse than a
        // failed generation.
        const markers = normalizeJpkMarkers({ gtu: inv.jpk_gtu, procedures: inv.jpk_procedures });
        const markersXml = [...markers.gtu, ...markers.procedures]
            .map(code => `            <tns:${code}>1</tns:${code}>`)
            .join('\n');
        const docType = normalizeJpkDocType(inv.jpk_doc_type, 'sales');
        // FP rows are listed at full value but must not increase sales or VAT
        // totals; the fiscal receipt already accounts for that transaction.
        const contrib = salesContribution(inv);
        const addContribution = (target: Record<string, number>, values: Partial<Record<string, number>>) => {
            for (const [field, amount] of Object.entries(values)) target[field] = round2((target[field] || 0) + (amount || 0));
        };
        if (docType !== 'FP') {
            addContribution(salesTotals, contrib);
            addContribution(declarationSalesTotals, contrib);
        }
        const tin = contractorTin(inv.buyer_nip, inv.jpk_counterparty_country);
        if (inv.jpk_counterparty_country && !isValidCountryCode(inv.jpk_counterparty_country)) {
            problems.push(`faktura ${inv.invoice_number}: nieznany kod kraju ${inv.jpk_counterparty_country}`);
        }
        const saleDate = fmtDate(inv.delivery_date);
        const isMargin = markers.procedures.includes('MR_T') || markers.procedures.includes('MR_UZ');
        const margin = inv.jpk_margin_gross === null || inv.jpk_margin_gross === undefined || inv.jpk_margin_gross === '' ? null : num(inv.jpk_margin_gross);
        if (isMargin && margin === null) {
            problems.push(`faktura ${inv.invoice_number}: oznaczenie MR_T/MR_UZ wymaga wartości brutto sprzedaży na zasadach marży (SprzedazVAT_Marza)`);
        }
        if (!isMargin && margin !== null) {
            problems.push(`faktura ${inv.invoice_number}: wartość marży bez oznaczenia MR_T/MR_UZ`);
        }
        const taxable = inv.jpk_margin_taxable_gross === null || inv.jpk_margin_taxable_gross === undefined || inv.jpk_margin_taxable_gross === '' ? null : num(inv.jpk_margin_taxable_gross);
        const rate = inv.jpk_margin_vat_rate;
        const method = inv.jpk_margin_method;
        let marginContrib: Partial<Record<string, number>> = {};
        if (isMargin) {
            if (taxable === null || !['5', '8', '23'].includes(String(rate)) || !['individual', 'sum'].includes(String(method))) {
                problems.push(`faktura ${inv.invoice_number}: MR_T/MR_UZ wymaga wewnętrznej marży opodatkowanej brutto, stawki 5/8/23% i metody indywidualnej albo sumy marż`);
            } else if (margin === null || taxable > margin) {
                problems.push(`faktura ${inv.invoice_number}: marża opodatkowana brutto nie może przekraczać kwoty brutto należnej od nabywcy`);
            } else {
                const fields = SALES_RATE_FIELD[rate as VatRateCode];
                // A negative margin has no VAT; its negative base stays in
                // the register only, never in declaration P fields.
                const base = taxable < 0 ? round2(taxable) : round2(taxable / (1 + Number(rate) / 100));
                const tax = taxable < 0 ? 0 : round2(taxable - base);
                marginContrib = { [fields.net]: base, [fields.vat!]: tax };
                if (method === 'sum') sumMarginRows.push({ procedure: markers.procedures.includes('MR_T') ? 'MR_T' : 'MR_UZ', rate: rate as '5' | '8' | '23', gross: taxable });
                if (method === 'individual' && docType !== 'FP') {
                    // Replace normal invoice-line K values: a margin invoice's
                    // taxable base is the margin, not its customer price.
                    addContribution(salesTotals, Object.fromEntries(Object.entries(contrib).map(([k, v]) => [k, -(v || 0)])));
                    addContribution(declarationSalesTotals, Object.fromEntries(Object.entries(contrib).map(([k, v]) => [k, -(v || 0)])));
                    addContribution(salesTotals, marginContrib);
                    if (taxable >= 0) addContribution(declarationSalesTotals, marginContrib);
                } else if (method === 'sum' && docType !== 'FP') {
                    // The customer invoice carries only SprzedazVAT_Marza;
                    // the WEW row below carries every K amount.
                    addContribution(salesTotals, Object.fromEntries(Object.entries(contrib).map(([k, v]) => [k, -(v || 0)])));
                    addContribution(declarationSalesTotals, Object.fromEntries(Object.entries(contrib).map(([k, v]) => [k, -(v || 0)])));
                }
            }
        }
        const marginXml = margin !== null ? `\n            <tns:SprzedazVAT_Marza>${fmt2(margin)}</tns:SprzedazVAT_Marza>` : '';
        const rowContrib = isMargin ? (method === 'individual' ? marginContrib : {}) : contrib;
        const kFieldsXml = SALES_FIELD_ORDER
            .filter(field => rowContrib[field] !== undefined)
            .map(field => `            <tns:${field}>${fmt2(rowContrib[field]!)}</tns:${field}>`)
            .join('\n');
        return `
        <tns:SprzedazWiersz>
            <tns:LpSprzedazy>${idx + 1}</tns:LpSprzedazy>
${tin.country ? `            <tns:KodKrajuNadaniaTIN>${tin.country}</tns:KodKrajuNadaniaTIN>\n` : ''}            <tns:NrKontrahenta>${esc(tin.number)}</tns:NrKontrahenta>
            <tns:NazwaKontrahenta>${esc(inv.buyer_name) || 'BRAK'}</tns:NazwaKontrahenta>
            <tns:DowodSprzedazy>${esc(prefix + inv.invoice_number)}</tns:DowodSprzedazy>
            <tns:DataWystawienia>${fmtDate(inv.issue_date) || periodStart}</tns:DataWystawienia>
${saleDate && saleDate !== fmtDate(inv.issue_date) ? `            <tns:DataSprzedazy>${saleDate}</tns:DataSprzedazy>\n` : ''}            ${ksefReference(inv, problems)}
${docType ? `            <tns:TypDokumentu>${docType}</tns:TypDokumentu>\n` : ''}${markersXml ? markersXml + '\n' : ''}${kFieldsXml}${marginXml}
        </tns:SprzedazWiersz>`;
    }).join('');

    // Sum-of-margins is represented by an internal document, not by K fields
    // on the buyer invoices. DI is the brochure's marker for a non-invoice
    // document; TypDokumentu=WEW identifies the internal document.
    const sumRows = new Map<string, number>();
    for (const row of sumMarginRows) sumRows.set(`${row.procedure}:${row.rate}`, round2((sumRows.get(`${row.procedure}:${row.rate}`) || 0) + row.gross));
    const wewRows = Array.from(sumRows.entries()).map(([key, gross], index) => {
        const [procedure, rate] = key.split(':') as ['MR_T' | 'MR_UZ', '5' | '8' | '23'];
        const fields = SALES_RATE_FIELD[rate];
        const base = gross < 0 ? round2(gross) : round2(gross / (1 + Number(rate) / 100));
        const tax = gross < 0 ? 0 : round2(gross - base);
        const values = { [fields.net]: base, [fields.vat!]: tax };
        for (const [field, amount] of Object.entries(values)) salesTotals[field] = round2((salesTotals[field] || 0) + amount);
        if (gross >= 0) for (const [field, amount] of Object.entries(values)) declarationSalesTotals[field] = round2((declarationSalesTotals[field] || 0) + amount);
        return `
        <tns:SprzedazWiersz>
            <tns:LpSprzedazy>${sales.length + index + 1}</tns:LpSprzedazy>
            <tns:NrKontrahenta>BRAK</tns:NrKontrahenta>
            <tns:NazwaKontrahenta>BRAK</tns:NazwaKontrahenta>
            <tns:DowodSprzedazy>WEW-MARZA-${period}-${index + 1}</tns:DowodSprzedazy>
            <tns:DataWystawienia>${periodStart}</tns:DataWystawienia>
            <tns:DI>1</tns:DI>
            <tns:TypDokumentu>WEW</tns:TypDokumentu>
            <tns:${procedure}>1</tns:${procedure}>
${SALES_FIELD_ORDER.filter(field => values[field] !== undefined).map(field => `            <tns:${field}>${fmt2(values[field]!)}</tns:${field}>`).join('\n')}
        </tns:SprzedazWiersz>`;
    }).join('');

    // Purchase rows + running per-field totals. K_40/K_41 (fixed assets)
    // vs K_42/K_43 (everything else) is decided by mapVatColumns() -
    // currently that's always K_42/K_43, since none of this platform's
    // cost categories are fixed-asset purchases (see vat-mapper.ts).
    const purchaseTotals: Record<string, number> = { K_40: 0, K_41: 0, K_42: 0, K_43: 0 };
    const purchaseRows = purchases.map((inv, idx) => {
        const isFixedAsset = mapVatColumns(inv.cost_category).vatRegisterField === 'K_40';
        const netField = isFixedAsset ? 'K_40' : 'K_42';
        const vatField = isFixedAsset ? 'K_41' : 'K_43';
        const net = num(inv.net_amount);
        const vat = num(inv.vat_amount);
        purchaseTotals[netField] = round2(purchaseTotals[netField] + net);
        purchaseTotals[vatField] = round2(purchaseTotals[vatField] + vat);
        const docType = normalizeJpkDocType(inv.jpk_doc_type, 'purchase');
        const tin = contractorTin(inv.seller_nip, inv.jpk_counterparty_country);
        if (inv.jpk_counterparty_country && !isValidCountryCode(inv.jpk_counterparty_country)) {
            problems.push(`faktura ${inv.invoice_number}: nieznany kod kraju ${inv.jpk_counterparty_country}`);
        }
        const purchaseDate = fmtDate(inv.issue_date) || periodStart;
        const receivedDate = warsawDate(inv.ksef_acquisition_date);
        const purchaseMargin = inv.jpk_margin_gross === null || inv.jpk_margin_gross === undefined || inv.jpk_margin_gross === '' ? null : num(inv.jpk_margin_gross);
        return `
        <tns:ZakupWiersz>
            <tns:LpZakupu>${idx + 1}</tns:LpZakupu>
${tin.country ? `            <tns:KodKrajuNadaniaTIN>${tin.country}</tns:KodKrajuNadaniaTIN>\n` : ''}            <tns:NrDostawcy>${esc(tin.number)}</tns:NrDostawcy>
            <tns:NazwaDostawcy>${esc(inv.seller_name) || 'BRAK'}</tns:NazwaDostawcy>
            <tns:DowodZakupu>${esc(inv.invoice_number)}</tns:DowodZakupu>
            <tns:DataZakupu>${purchaseDate}</tns:DataZakupu>
${receivedDate && receivedDate !== purchaseDate ? `            <tns:DataWplywu>${receivedDate}</tns:DataWplywu>\n` : ''}            ${ksefReference(inv, problems)}
${docType ? `            <tns:DokumentZakupu>${docType}</tns:DokumentZakupu>\n` : ''}${inv.jpk_import ? '            <tns:IMP>1</tns:IMP>\n' : ''}            <tns:${netField}>${fmt2(net)}</tns:${netField}>
            <tns:${vatField}>${fmt2(vat)}</tns:${vatField}>${purchaseMargin !== null ? `\n            <tns:ZakupVAT_Marza>${fmt2(purchaseMargin)}</tns:ZakupVAT_Marza>` : ''}
        </tns:ZakupWiersz>`;
    }).join('');

    if (problems.length > 0) throw new JpkGenerationError(problems);

    // SprzedazCtrl.PodatekNalezny = sum of K_16/K_18/K_20/K_24/K_26/K_28/
    // K_30/K_32/K_33/K_34 minus K_35/K_36 (broszura Tabela 9). This
    // platform only ever populates K_16/K_18/K_20 - the rest are always 0.
    const sprzedazPodatekNalezny = round2((salesTotals['K_16'] || 0) + (salesTotals['K_18'] || 0) + (salesTotals['K_20'] || 0));
    // ZakupCtrl.PodatekNaliczony = sum of K_41/K_43/K_44/K_45/K_46/K_47
    // (Tabela 12) - K_44-K_47 are correction fields this platform doesn't
    // populate.
    const zakupPodatekNaliczony = round2((purchaseTotals['K_41'] || 0) + (purchaseTotals['K_43'] || 0));

    // Declaration (P_xx) fields mirror the K_xx totals 1:1 (broszura
    // Tabela 16/17: "wykazana w K_xx"), but in WHOLE złoty: the schema types
    // them etd:TKwotaC (xsd:integer), so "123.45" is invalid. Each field is
    // rounded on its own and the sums (P_37/P_38/P_48/P_51/P_53) are built from
    // the rounded components, so the declaration adds up exactly as filed.
    // P_38 and P_51 are the only two fields the spec marks obowiązkowe
    // (mandatory) - always "0" when there's nothing to report, never omitted.
    // Every other field is opcjonalne ("pole pozostaje puste" when not
    // applicable) and is omitted from the XML entirely rather than written as
    // a misleading "0" - see declarationFields() below.
    const zl = (n: number | undefined): number => Math.round(n || 0);
    const p10 = zl(declarationSalesTotals['K_10']);
    const p13 = zl(declarationSalesTotals['K_13']);
    const p15 = zl(declarationSalesTotals['K_15']);
    const p16 = zl(declarationSalesTotals['K_16']);
    const p17 = zl(declarationSalesTotals['K_17']);
    const p18 = zl(declarationSalesTotals['K_18']);
    const p19 = zl(declarationSalesTotals['K_19']);
    const p20 = zl(declarationSalesTotals['K_20']);
    const p21 = zl(declarationSalesTotals['K_21']);
    const p22 = zl(declarationSalesTotals['K_22']);

    // P_37 = sum(P_10,P_11,P_13,P_15,P_17,P_19,P_21,P_22,P_23,P_25,P_27,P_29,P_31)
    // - P_31 is always 0 here since no VatRateCode routes to K_31 anymore.
    const p37 = p10 + p13 + p15 + p17 + p19 + p21 + p22;
    // P_38 = sum(P_16,P_18,P_20,P_24,P_26,P_28,P_30,P_32,P_33,P_34) - P_35 - P_36 (mandatory)
    const p38 = p16 + p18 + p20;

    const p40 = zl(purchaseTotals['K_40']);
    const p41 = zl(purchaseTotals['K_41']);
    const p42 = zl(purchaseTotals['K_42']);
    const p43 = zl(purchaseTotals['K_43']);
    // P_48 = sum(P_39,P_41,P_43,P_44,P_45,P_46,P_47) - only P_41/P_43 are ever nonzero here
    const p48 = p41 + p43;

    // P_51 = wysokość podatku podlegająca wpłacie (mandatory); P_53 =
    // nadwyżka podatku naliczonego nad należnym. No refund-election
    // workflow exists (P_54-P_61), so a surplus defaults to P_62 (carried
    // forward to the next period) rather than a bank refund - the
    // standard behaviour when a taxpayer doesn't explicitly request one.
    const p51 = Math.max(0, p38 - p48);
    const p53 = Math.max(0, p48 - p38);

    const declarationFields: Array<[string, number | null]> = [
        ['P_10', p10 || null],
        ['P_11', null],
        ['P_12', null],
        ['P_13', p13 || null],
        ['P_14', null],
        ['P_15', p15 || null],
        ['P_16', p16 || null],
        ['P_17', p17 || null],
        ['P_18', p18 || null],
        ['P_19', p19 || null],
        ['P_20', p20 || null],
        ['P_21', p21 || null],
        ['P_22', p22 || null],
        ['P_23', null],
        ['P_24', null],
        ['P_25', null],
        ['P_26', null],
        ['P_27', null],
        ['P_28', null],
        ['P_29', null],
        ['P_30', null],
        ['P_31', null], // no VatRateCode models art. 17 ust. 1 pkt 5 - see the round 10 finding above
        ['P_32', null],
        ['P_33', null],
        ['P_34', null],
        ['P_35', null],
        ['P_36', null],
        ['P_37', p37 || null],
        ['P_38', p38], // mandatory
        ['P_39', null],
        ['P_40', p40 || null],
        ['P_41', p41 || null],
        ['P_42', p42 || null],
        ['P_43', p43 || null],
        ['P_44', null],
        ['P_45', null],
        ['P_46', null],
        ['P_47', null],
        ['P_48', p48 || null],
        ['P_49', null],
        ['P_50', null],
        ['P_51', p51], // mandatory
        ['P_52', null],
        ['P_53', p53 || null],
        ['P_54', null],
        // P_55-P_59, P_61, P_63-P_67 are boolean/text election flags
        // (refund timing, marża/turystyka procedures, etc.) this platform
        // never sets - omitted rather than guessed at.
        ['P_60', null],
        ['P_62', p53 || null],
        ['P_68', null],
    ];

    const declarationXml = declarationFields
        .filter((entry): entry is [string, number] => entry[1] !== null)
        .map(([name, value]) => `            <tns:${name}>${value}</tns:${name}>`)
        .join('\n');

    // Company: tns-namespaced identity elements. Sole trader: the shared etd
    // identity type (NIP, first name, surname, date of birth) followed by the
    // tns:Email - both orders are dictated by the XSD.
    const podmiotXml = firm.taxpayerType === 'individual'
        ? `        <tns:OsobaFizyczna>
            <etd:NIP>${firm.nip}</etd:NIP>
            <etd:ImiePierwsze>${esc(firm.firstName?.trim())}</etd:ImiePierwsze>
            <etd:Nazwisko>${esc(firm.lastName?.trim())}</etd:Nazwisko>
            <etd:DataUrodzenia>${fmtDate(firm.birthDate)}</etd:DataUrodzenia>
            <tns:Email>${esc(firm.email)}</tns:Email>
        </tns:OsobaFizyczna>`
        : `        <tns:OsobaNiefizyczna>
            <tns:NIP>${firm.nip}</tns:NIP>
            <tns:PelnaNazwa>${esc(firm.fullName || firm.name)}</tns:PelnaNazwa>
            <tns:Email>${esc(firm.email)}</tns:Email>
        </tns:OsobaNiefizyczna>`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<tns:JPK xmlns:tns="${JPK_NAMESPACE}"
         xmlns:etd="${ETD_NAMESPACE}"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

    <tns:Naglowek>
        <tns:KodFormularza kodSystemowy="JPK_V7M (3)" wersjaSchemy="1-0E">JPK_VAT</tns:KodFormularza>
        <tns:WariantFormularza>3</tns:WariantFormularza>
        <tns:DataWytworzeniaJPK>${now}</tns:DataWytworzeniaJPK>
        <tns:NazwaSystemu>KSeF Auto v1.0</tns:NazwaSystemu>
        <tns:CelZlozenia poz="P_7">${options.purpose === 2 ? 2 : 1}</tns:CelZlozenia>
        <tns:KodUrzedu>${firm.taxOfficeCode}</tns:KodUrzedu>
        <tns:Rok>${year}</tns:Rok>
        <tns:Miesiac>${parseInt(month)}</tns:Miesiac>
    </tns:Naglowek>

    <tns:Podmiot1 rola="Podatnik">
${podmiotXml}
    </tns:Podmiot1>

    <tns:Deklaracja>
        <tns:Naglowek>
            <tns:KodFormularzaDekl kodSystemowy="VAT-7 (23)" kodPodatku="VAT" rodzajZobowiazania="Z" wersjaSchemy="1-0E">VAT-7</tns:KodFormularzaDekl>
            <tns:WariantFormularzaDekl>23</tns:WariantFormularzaDekl>
        </tns:Naglowek>
        <tns:PozycjeSzczegolowe>
${declarationXml}
        </tns:PozycjeSzczegolowe>
        <tns:Pouczenia>1</tns:Pouczenia>
    </tns:Deklaracja>

    <tns:Ewidencja>
        ${salesRows}${wewRows}
        <tns:SprzedazCtrl>
            <tns:LiczbaWierszySprzedazy>${sales.length + sumRows.size}</tns:LiczbaWierszySprzedazy>
            <tns:PodatekNalezny>${fmt2(sprzedazPodatekNalezny)}</tns:PodatekNalezny>
        </tns:SprzedazCtrl>
        ${purchaseRows}
        <tns:ZakupCtrl>
            <tns:LiczbaWierszyZakupow>${purchases.length}</tns:LiczbaWierszyZakupow>
            <tns:PodatekNaliczony>${fmt2(zakupPodatekNaliczony)}</tns:PodatekNaliczony>
        </tns:ZakupCtrl>
    </tns:Ewidencja>

</tns:JPK>`;
}
