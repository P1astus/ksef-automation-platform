export interface InvoiceLine {
    name: string;
    qty: number;
    unit: string;
    netPrice: number;
    vatRate: '23' | '8' | '5' | '0' | 'zw';
}

export interface InvoiceParty {
    nip: string;
    name: string;
    street?: string;
    city?: string;
    postCode?: string;
    countryCode?: string;
}

// A correction invoice (faktura korygująca, RodzajFaktury=KOR). Per the FA(3)
// schema's own annotation on the <Fa> element: "W przypadku wystawienia
// faktury korygującej wypełnia się wszystkie pola wg stanu po korekcie, a
// pola dotyczące podstaw opodatkowania, podatku oraz należności ogółem
// wypełnia się poprzez różnicę" — line items (FaWiersz) report the full
// POST-correction state, while the VAT-group totals (P_13_x/P_14_x) and the
// total due (P_15) report the DIFFERENCE (corrected − original). originalLines
// is needed to compute that difference, not just to reference the original.
export interface CorrectionInfo {
    reason: string;              // PrzyczynaKorekty
    originalInvoiceNumber: string;
    originalIssueDate: string;   // YYYY-MM-DD
    originalKsefNumber: string;
    originalLines: InvoiceLine[];
}

export interface InvoiceInput {
    invoiceNumber: string;
    issueDate: string;   // YYYY-MM-DD
    dueDate?: string;    // YYYY-MM-DD
    seller: InvoiceParty;
    buyer: InvoiceParty;
    lines: InvoiceLine[];  // the corrected/current lines — see CorrectionInfo.originalLines
    currency?: string;
    correction?: CorrectionInfo;
}

interface VatGroup {
    rate: string;
    net: number;
    vat: number;
    gross: number;
}

// FA(3) (schemas/fa3-13775-schemat.xsd) does not key VAT-rate totals by the
// literal rate string the way the old FA(2)-era code assumed — it uses a
// fixed legal enumeration of field names (TStawkaPodatku for the per-line
// P_12 code; separate P_13_x/P_14_x elements, in this exact schema order,
// for the invoice-level totals). 0% and "zw" (exempt) have no P_14_x
// counterpart at all - there's no VAT amount to report for either.
const VAT_GROUP_FIELD: Record<InvoiceLine['vatRate'], { net: string; vat: string | null; p12: string; order: number }> = {
    '23': { net: 'P_13_1', vat: 'P_14_1', p12: '23', order: 1 },
    '8': { net: 'P_13_2', vat: 'P_14_2', p12: '8', order: 2 },
    '5': { net: 'P_13_3', vat: 'P_14_3', p12: '5', order: 3 },
    '0': { net: 'P_13_6_1', vat: null, p12: '0 KR', order: 4 },
    'zw': { net: 'P_13_7', vat: null, p12: 'zw', order: 5 },
};

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function vatRateValue(rate: InvoiceLine['vatRate']): number {
    if (rate === 'zw') return 0;
    return parseFloat(rate) / 100;
}

function computeLines(lines: InvoiceLine[]) {
    return lines.map(l => {
        const net = round2(l.netPrice * l.qty);
        const vatAmt = l.vatRate === 'zw' ? 0 : round2(net * vatRateValue(l.vatRate));
        const gross = round2(net + vatAmt);
        return { ...l, net, vatAmt, gross };
    });
}

function groupByVat(computed: ReturnType<typeof computeLines>): VatGroup[] {
    const map = new Map<string, VatGroup>();
    for (const l of computed) {
        const key = l.vatRate;
        if (!map.has(key)) map.set(key, { rate: key, net: 0, vat: 0, gross: 0 });
        const g = map.get(key)!;
        g.net = round2(g.net + l.net);
        g.vat = round2(g.vat + l.vatAmt);
        g.gross = round2(g.gross + l.gross);
    }
    // FA(3)'s P_13_x/P_14_x elements are independent optional sequences that
    // must appear in the schema's fixed order (1, 2, 3, 6_1, 7, ...) — not
    // in whatever order lines happened to be entered.
    return Array.from(map.values()).sort((a, b) => VAT_GROUP_FIELD[a.rate as InvoiceLine['vatRate']].order - VAT_GROUP_FIELD[b.rate as InvoiceLine['vatRate']].order);
}

// Delta between two sets of VAT groups (corrected - original), for a
// correction invoice's P_13_x/P_14_x totals. Every rate present on either
// side gets an entry, even a net-zero one (e.g. a rate untouched by the
// correction) — simpler and still schema-valid (TKwotowy allows 0, and
// negative deltas: it has no minInclusive restriction, confirmed against
// the vendored XSD, unlike the non-negative TKwotowy2/TKwotaNieujemna
// variants used elsewhere).
function deltaVatGroups(correctedLines: InvoiceLine[], originalLines: InvoiceLine[]): VatGroup[] {
    const correctedGroups = new Map(groupByVat(computeLines(correctedLines)).map(g => [g.rate, g]));
    const originalGroups = new Map(groupByVat(computeLines(originalLines)).map(g => [g.rate, g]));
    const rates = new Set([...correctedGroups.keys(), ...originalGroups.keys()]);
    const zero: VatGroup = { rate: '', net: 0, vat: 0, gross: 0 };

    return Array.from(rates).map(rate => {
        const c = correctedGroups.get(rate) ?? zero;
        const o = originalGroups.get(rate) ?? zero;
        return { rate, net: round2(c.net - o.net), vat: round2(c.vat - o.vat), gross: round2(c.gross - o.gross) };
    }).sort((a, b) => VAT_GROUP_FIELD[a.rate as InvoiceLine['vatRate']].order - VAT_GROUP_FIELD[b.rate as InvoiceLine['vatRate']].order);
}

function esc(s: string | undefined): string {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Builds a KSeF FA(3) compliant XML invoice string.
 * Reference schema: schemas/fa3-13775-schemat.xsd (vendored in this repo).
 *
 * Element order, field names and the P_13_x/P_14_x VAT-group enumeration
 * below are taken directly from that XSD — verified by validating sample
 * output against it with `xmllint --schema`, not guessed from the older
 * FA(2) shape this function used to emit. Notable differences from FA(2)
 * that aren't obvious from the field names alone: `Nazwa` (not `PelnaNazwa`),
 * a mandatory `JST` marker on Podmiot2, and the per-line fields shifted
 * meaning — P_7 is now the item name (it was the unit of measure in FA(2)),
 * P_8A is now the unit of measure, P_8B is the quantity.
 */
export function buildKSeFInvoiceXml(input: InvoiceInput): string {
    const computed = computeLines(input.lines);
    const currency = input.currency || 'PLN';
    const countryCode = input.seller.countryCode || 'PL';

    // For a correction, the VAT-group totals and P_15 are the DIFFERENCE
    // (corrected − original) — see CorrectionInfo's doc comment. For a
    // normal invoice they're just this invoice's own totals.
    const vatGroups = input.correction
        ? deltaVatGroups(input.lines, input.correction.originalLines)
        : groupByVat(computed);
    const totalGross = input.correction
        ? round2(computed.reduce((s, l) => s + l.gross, 0) - computeLines(input.correction.originalLines).reduce((s, l) => s + l.gross, 0))
        : round2(computed.reduce((s, l) => s + l.gross, 0));

    const linesXml = computed.map((l, i) => `
        <fa:FaWiersz>
            <fa:NrWierszaFa>${i + 1}</fa:NrWierszaFa>
            <fa:P_7>${esc(l.name)}</fa:P_7>
            <fa:P_8A>${esc(l.unit)}</fa:P_8A>
            <fa:P_8B>${l.qty}</fa:P_8B>
            <fa:P_9A>${l.netPrice.toFixed(2)}</fa:P_9A>
            <fa:P_11>${l.net.toFixed(2)}</fa:P_11>
            <fa:P_12>${VAT_GROUP_FIELD[l.vatRate].p12}</fa:P_12>
        </fa:FaWiersz>`).join('');

    const vatGroupsXml = vatGroups.map(g => {
        const field = VAT_GROUP_FIELD[g.rate as InvoiceLine['vatRate']];
        const netXml = `<fa:${field.net}>${g.net.toFixed(2)}</fa:${field.net}>`;
        const vatXml = field.vat ? `\n        <fa:${field.vat}>${g.vat.toFixed(2)}</fa:${field.vat}>` : '';
        return `\n        ${netXml}${vatXml}`;
    }).join('');

    const platnoscXml = input.dueDate ? `
        <fa:Platnosc>
            <fa:TerminPlatnosci>
                <fa:Termin>${input.dueDate}</fa:Termin>
            </fa:TerminPlatnosci>
        </fa:Platnosc>` : '';

    // Schema element order: RodzajFaktury, then (for KOR/KOR_ZAL/KOR_ROZ)
    // PrzyczynaKorekty, [TypKorekty — omitted, optional], DaneFaKorygowanej.
    // Every invoice this platform issues goes through KSeF, so the
    // DaneFaKorygowanej choice always takes the NrKSeF branch (marker "1" +
    // the original's real KSeF number), never NrKSeFN ("issued outside KSeF").
    const correctionXml = input.correction ? `
        <fa:PrzyczynaKorekty>${esc(input.correction.reason)}</fa:PrzyczynaKorekty>
        <fa:DaneFaKorygowanej>
            <fa:DataWystFaKorygowanej>${input.correction.originalIssueDate}</fa:DataWystFaKorygowanej>
            <fa:NrFaKorygowanej>${esc(input.correction.originalInvoiceNumber)}</fa:NrFaKorygowanej>
            <fa:NrKSeF>1</fa:NrKSeF>
            <fa:NrKSeFFaKorygowanej>${esc(input.correction.originalKsefNumber)}</fa:NrKSeFFaKorygowanej>
        </fa:DaneFaKorygowanej>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<fa:Faktura xmlns:fa="http://crd.gov.pl/wzor/2025/06/25/13775/"
            xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <fa:Naglowek>
        <fa:KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</fa:KodFormularza>
        <fa:WariantFormularza>3</fa:WariantFormularza>
        <fa:DataWytworzeniaFa>${new Date().toISOString()}</fa:DataWytworzeniaFa>
        <fa:SystemInfo>KSeF Auto v1.0</fa:SystemInfo>
    </fa:Naglowek>
    <fa:Podmiot1>
        <fa:DaneIdentyfikacyjne>
            <fa:NIP>${esc(input.seller.nip)}</fa:NIP>
            <fa:Nazwa>${esc(input.seller.name)}</fa:Nazwa>
        </fa:DaneIdentyfikacyjne>
        <fa:Adres>
            <fa:KodKraju>${countryCode}</fa:KodKraju>
            <fa:AdresL1>${esc(input.seller.street || '')}</fa:AdresL1>
            <fa:AdresL2>${esc((input.seller.postCode || '') + ' ' + (input.seller.city || ''))}</fa:AdresL2>
        </fa:Adres>
    </fa:Podmiot1>
    <fa:Podmiot2>
        <fa:DaneIdentyfikacyjne>
            <fa:NIP>${esc(input.buyer.nip)}</fa:NIP>
            <fa:Nazwa>${esc(input.buyer.name)}</fa:Nazwa>
        </fa:DaneIdentyfikacyjne>
        <fa:Adres>
            <fa:KodKraju>${input.buyer.countryCode || 'PL'}</fa:KodKraju>
            <fa:AdresL1>${esc(input.buyer.street || '')}</fa:AdresL1>
            <fa:AdresL2>${esc((input.buyer.postCode || '') + ' ' + (input.buyer.city || ''))}</fa:AdresL2>
        </fa:Adres>
        <fa:JST>2</fa:JST>
        <fa:GV>2</fa:GV>
    </fa:Podmiot2>
    <fa:Fa>
        <fa:KodWaluty>${currency}</fa:KodWaluty>
        <fa:P_1>${input.issueDate}</fa:P_1>
        <fa:P_2>${esc(input.invoiceNumber)}</fa:P_2>
        ${vatGroupsXml}
        <fa:P_15>${totalGross.toFixed(2)}</fa:P_15>
        <fa:Adnotacje>
            <fa:P_16>2</fa:P_16>
            <fa:P_17>2</fa:P_17>
            <fa:P_18>2</fa:P_18>
            <fa:P_18A>2</fa:P_18A>
            <fa:Zwolnienie>
                <fa:P_19N>1</fa:P_19N>
            </fa:Zwolnienie>
            <fa:NoweSrodkiTransportu>
                <fa:P_22N>1</fa:P_22N>
            </fa:NoweSrodkiTransportu>
            <fa:P_23>2</fa:P_23>
            <fa:PMarzy>
                <fa:P_PMarzyN>1</fa:P_PMarzyN>
            </fa:PMarzy>
        </fa:Adnotacje>
        <fa:RodzajFaktury>${input.correction ? 'KOR' : 'VAT'}</fa:RodzajFaktury>
        ${correctionXml}
        ${linesXml}${platnoscXml}
    </fa:Fa>
    <fa:Stopka>
        <fa:Informacje>
            <fa:StopkaFaktury>Faktura wystawiona za pomocą KSeF Auto</fa:StopkaFaktury>
        </fa:Informacje>
    </fa:Stopka>
</fa:Faktura>`;
}

export function computeInvoiceTotals(lines: InvoiceLine[]) {
    const computed = computeLines(lines);
    return {
        totalNet: round2(computed.reduce((s, l) => s + l.net, 0)),
        totalVat: round2(computed.reduce((s, l) => s + l.vatAmt, 0)),
        totalGross: round2(computed.reduce((s, l) => s + l.gross, 0)),
        lines: computed,
    };
}
