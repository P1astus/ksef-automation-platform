import { sumLinesByRate, type InvoiceLine, type VatRateCode } from './ksef-invoice-builder';
import { mapVatColumns } from './vat-mapper';

export interface JpkFirmData {
    nip: string;
    name: string;
    fullName?: string;
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
        for (const rate of Object.keys(byRate) as VatRateCode[]) {
            const bucket = byRate[rate]!;
            const field = SALES_RATE_FIELD[rate];
            contrib[field.net] = round2((contrib[field.net] || 0) + bucket.net);
            if (field.vat) contrib[field.vat] = round2((contrib[field.vat] || 0) + bucket.vat);
        }
    } else {
        contrib['K_19'] = num(inv.net_amount);
        contrib['K_20'] = num(inv.vat_amount);
    }
    return contrib;
}

/**
 * Generates JPK_V7M XML (Polish SAF-T for monthly VAT reporting).
 * Spec: https://www.gov.pl/web/kas/struktury-jpk
 */
export function generateJpkV7M(
    firm: JpkFirmData,
    period: string, // YYYY-MM
    invoices: JpkInvoiceRow[]
): string {
    const [year, month] = period.split('-');
    const periodStart = `${year}-${month}-01`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const periodEnd = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    const now = new Date().toISOString();

    const sales = invoices.filter(i => i.direction === 'sales');
    const purchases = invoices.filter(i => i.direction === 'purchase');

    // Sales rows + running per-field totals
    const salesTotals: Record<string, number> = {};
    const salesRows = sales.map((inv, idx) => {
        const prefix = inv.jpk_correction_needed ? 'COR' : '';
        const ksefRef = inv.ksef_number || inv.jpk_marker || '';
        const contrib = salesContribution(inv);
        for (const [field, amount] of Object.entries(contrib)) {
            salesTotals[field] = round2((salesTotals[field] || 0) + (amount || 0));
        }
        const kFieldsXml = SALES_FIELD_ORDER
            .filter(field => contrib[field] !== undefined)
            .map(field => `            <tns:${field}>${fmt2(contrib[field]!)}</tns:${field}>`)
            .join('\n');
        return `
        <tns:SprzedazWiersz>
            <tns:LpSprzedazy>${idx + 1}</tns:LpSprzedazy>
            <tns:NrKontrahenta>${esc(inv.buyer_nip)}</tns:NrKontrahenta>
            <tns:NazwaKontrahenta>${esc(inv.buyer_name)}</tns:NazwaKontrahenta>
            <tns:DowodSprzedazy>${esc(prefix + inv.invoice_number)}</tns:DowodSprzedazy>
            <tns:DataWystawienia>${fmtDate(inv.issue_date) || periodStart}</tns:DataWystawienia>
            ${ksefRef ? `<tns:KodKSeF>${esc(ksefRef)}</tns:KodKSeF>` : ''}
${kFieldsXml}
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
        return `
        <tns:ZakupWiersz>
            <tns:LpZakupu>${idx + 1}</tns:LpZakupu>
            <tns:NrDostawcy>${esc(inv.seller_nip)}</tns:NrDostawcy>
            <tns:NazwaDostawcy>${esc(inv.seller_name)}</tns:NazwaDostawcy>
            <tns:DowodZakupu>${esc(inv.invoice_number)}</tns:DowodZakupu>
            <tns:DataZakupu>${fmtDate(inv.issue_date) || periodStart}</tns:DataZakupu>
            <tns:DataWplywu>${fmtDate(inv.issue_date) || periodStart}</tns:DataWplywu>
            <tns:${netField}>${fmt2(net)}</tns:${netField}>
            <tns:${vatField}>${fmt2(vat)}</tns:${vatField}>
        </tns:ZakupWiersz>`;
    }).join('');

    // SprzedazCtrl.PodatekNalezny = sum of K_16/K_18/K_20/K_24/K_26/K_28/
    // K_30/K_32/K_33/K_34 minus K_35/K_36 (broszura Tabela 9). This
    // platform only ever populates K_16/K_18/K_20 - the rest are always 0.
    const sprzedazPodatekNalezny = round2((salesTotals['K_16'] || 0) + (salesTotals['K_18'] || 0) + (salesTotals['K_20'] || 0));
    // ZakupCtrl.PodatekNaliczony = sum of K_41/K_43/K_44/K_45/K_46/K_47
    // (Tabela 12) - K_44-K_47 are correction fields this platform doesn't
    // populate.
    const zakupPodatekNaliczony = round2((purchaseTotals['K_41'] || 0) + (purchaseTotals['K_43'] || 0));

    // Declaration (P_xx) fields mirror the K_xx totals 1:1 (broszura
    // Tabela 16/17: "wykazana w K_xx"). P_38 and P_51 are the only two
    // fields the spec marks obowiązkowe (mandatory) - always "0.00" when
    // there's nothing to report, never omitted. Every other field is
    // opcjonalne ("pole pozostaje puste" when not applicable) and is
    // omitted from the XML entirely rather than written as a misleading
    // "0.00" - see declarationFields() below.
    const p10 = salesTotals['K_10'] || 0;
    const p13 = salesTotals['K_13'] || 0;
    const p15 = salesTotals['K_15'] || 0;
    const p16 = salesTotals['K_16'] || 0;
    const p17 = salesTotals['K_17'] || 0;
    const p18 = salesTotals['K_18'] || 0;
    const p19 = salesTotals['K_19'] || 0;
    const p20 = salesTotals['K_20'] || 0;
    const p21 = salesTotals['K_21'] || 0;
    const p22 = salesTotals['K_22'] || 0;

    // P_37 = sum(P_10,P_11,P_13,P_15,P_17,P_19,P_21,P_22,P_23,P_25,P_27,P_29,P_31)
    // - P_31 is always 0 here since no VatRateCode routes to K_31 anymore.
    const p37 = round2(p10 + p13 + p15 + p17 + p19 + p21 + p22);
    // P_38 = sum(P_16,P_18,P_20,P_24,P_26,P_28,P_30,P_32,P_33,P_34) - P_35 - P_36 (mandatory)
    const p38 = round2(p16 + p18 + p20);

    const p40 = purchaseTotals['K_40'] || 0;
    const p41 = purchaseTotals['K_41'] || 0;
    const p42 = purchaseTotals['K_42'] || 0;
    const p43 = purchaseTotals['K_43'] || 0;
    // P_48 = sum(P_39,P_41,P_43,P_44,P_45,P_46,P_47) - only P_41/P_43 are ever nonzero here
    const p48 = round2(p41 + p43);

    // P_51 = wysokość podatku podlegająca wpłacie (mandatory); P_53 =
    // nadwyżka podatku naliczonego nad należnym. No refund-election
    // workflow exists (P_54-P_61), so a surplus defaults to P_62 (carried
    // forward to the next period) rather than a bank refund - the
    // standard behaviour when a taxpayer doesn't explicitly request one.
    const p51 = round2(Math.max(0, p38 - p48));
    const p53 = round2(Math.max(0, p48 - p38));

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
        .map(([name, value]) => `            <tns:${name}>${fmt2(value)}</tns:${name}>`)
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<tns:JPK xmlns:tns="http://jpk.mf.gov.pl/wzor/2022/02/17/02171/"
         xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

    <tns:Naglowek>
        <tns:KodFormularza kodSystemowy="JPK_VAT (3)" wersjaSchemy="1-2">JPK_VAT</tns:KodFormularza>
        <tns:WariantFormularza>3</tns:WariantFormularza>
        <tns:DataWytworzeniaJPK>${now}</tns:DataWytworzeniaJPK>
        <tns:NazwaSystemu>KSeF Auto v1.0</tns:NazwaSystemu>
        <tns:CelZlozenia poz="P_7">1</tns:CelZlozenia>
        <tns:DataOd>${periodStart}</tns:DataOd>
        <tns:DataDo>${periodEnd}</tns:DataDo>
        <tns:DomyslnyKodWaluty>PLN</tns:DomyslnyKodWaluty>
        <tns:KodUrzedu>0000</tns:KodUrzedu>
    </tns:Naglowek>

    <tns:Podmiot1>
        <tns:NIP>${esc(firm.nip)}</tns:NIP>
        <tns:PelnaNazwa>${esc(firm.fullName || firm.name)}</tns:PelnaNazwa>
    </tns:Podmiot1>

    <tns:Ewidencja>
        ${salesRows}
        <tns:SprzedazCtrl>
            <tns:LiczbaWierszySprzedazy>${sales.length}</tns:LiczbaWierszySprzedazy>
            <tns:PodatekNalezny>${fmt2(sprzedazPodatekNalezny)}</tns:PodatekNalezny>
        </tns:SprzedazCtrl>
        ${purchaseRows}
        <tns:ZakupCtrl>
            <tns:LiczbaWierszyZakupow>${purchases.length}</tns:LiczbaWierszyZakupow>
            <tns:PodatekNaliczony>${fmt2(zakupPodatekNaliczony)}</tns:PodatekNaliczony>
        </tns:ZakupCtrl>
    </tns:Ewidencja>

    <tns:Deklaracja>
        <tns:Miesiac>${parseInt(month)}</tns:Miesiac>
        <tns:Rok>${year}</tns:Rok>
        <tns:PozycjeSzczegolowe>
${declarationXml}
        </tns:PozycjeSzczegolowe>
    </tns:Deklaracja>

</tns:JPK>`;
}
