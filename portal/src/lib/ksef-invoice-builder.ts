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

export interface InvoiceInput {
    invoiceNumber: string;
    issueDate: string;   // YYYY-MM-DD
    dueDate?: string;    // YYYY-MM-DD
    seller: InvoiceParty;
    buyer: InvoiceParty;
    lines: InvoiceLine[];
    currency?: string;
}

interface VatGroup {
    rate: string;
    net: number;
    vat: number;
    gross: number;
}

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
    return Array.from(map.values());
}

function esc(s: string | undefined): string {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Builds a KSeF FA(2) compliant XML invoice string.
 * Reference schema: https://www.gov.pl/web/kas/struktury-ksef
 */
export function buildKSeFInvoiceXml(input: InvoiceInput): string {
    const computed = computeLines(input.lines);
    const vatGroups = groupByVat(computed);
    const totalNet = round2(computed.reduce((s, l) => s + l.net, 0));
    const totalVat = round2(computed.reduce((s, l) => s + l.vatAmt, 0));
    const totalGross = round2(computed.reduce((s, l) => s + l.gross, 0));
    const currency = input.currency || 'PLN';
    const countryCode = input.seller.countryCode || 'PL';

    const linesXml = computed.map((l, i) => `
        <fa:FakturaWiersz>
            <fa:NrWierszaFa>${i + 1}</fa:NrWierszaFa>
            <fa:P_6A>${esc(l.name)}</fa:P_6A>
            <fa:P_7>${esc(l.unit)}</fa:P_7>
            <fa:P_8A>${l.qty}</fa:P_8A>
            <fa:P_9A>${l.netPrice.toFixed(2)}</fa:P_9A>
            <fa:P_11>${l.net.toFixed(2)}</fa:P_11>
            <fa:P_12>${l.vatRate === 'zw' ? 'zw' : l.vatRate}</fa:P_12>
        </fa:FakturaWiersz>`).join('');

    const vatGroupsXml = vatGroups.map(g => `
        <fa:P_13_${g.rate === 'zw' ? 'zw' : g.rate}>${g.net.toFixed(2)}</fa:P_13_${g.rate === 'zw' ? 'zw' : g.rate}>
        <fa:P_14_${g.rate === 'zw' ? 'zw' : g.rate}>${g.vat.toFixed(2)}</fa:P_14_${g.rate === 'zw' ? 'zw' : g.rate}>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<fa:Faktura xmlns:fa="http://crd.gov.pl/wzor/2023/06/29/12648/"
            xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <fa:Naglowek>
        <fa:KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</fa:KodFormularza>
        <fa:WariantFormularza>2</fa:WariantFormularza>
        <fa:DataWytworzeniaFa>${new Date().toISOString()}</fa:DataWytworzeniaFa>
        <fa:SystemInfo>KSeF Auto v1.0</fa:SystemInfo>
    </fa:Naglowek>
    <fa:Podmiot1>
        <fa:DaneIdentyfikacyjne>
            <fa:NIP>${esc(input.seller.nip)}</fa:NIP>
            <fa:PelnaNazwa>${esc(input.seller.name)}</fa:PelnaNazwa>
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
            <fa:PelnaNazwa>${esc(input.buyer.name)}</fa:PelnaNazwa>
        </fa:DaneIdentyfikacyjne>
        <fa:Adres>
            <fa:KodKraju>${input.buyer.countryCode || 'PL'}</fa:KodKraju>
            <fa:AdresL1>${esc(input.buyer.street || '')}</fa:AdresL1>
            <fa:AdresL2>${esc((input.buyer.postCode || '') + ' ' + (input.buyer.city || ''))}</fa:AdresL2>
        </fa:Adres>
    </fa:Podmiot2>
    <fa:Fa>
        <fa:KodWaluty>${currency}</fa:KodWaluty>
        <fa:P_1>${input.issueDate}</fa:P_1>
        <fa:P_2>${esc(input.invoiceNumber)}</fa:P_2>
        ${input.dueDate ? `<fa:P_5>${input.dueDate}</fa:P_5>` : ''}
        <fa:P_6>${input.issueDate}</fa:P_6>
        ${linesXml}
        ${vatGroupsXml}
        <fa:P_15>${totalGross.toFixed(2)}</fa:P_15>
        <fa:Adnotacje>
            <fa:P_16>2</fa:P_16>
            <fa:P_17>2</fa:P_17>
            <fa:P_18>2</fa:P_18>
            <fa:P_18A>2</fa:P_18A>
            <fa:P_19>2</fa:P_19>
            <fa:P_20>2</fa:P_20>
            <fa:P_21>2</fa:P_21>
            <fa:P_22>2</fa:P_22>
            <fa:P_23>2</fa:P_23>
            <fa:P_PrzyczynaKorekty/>
        </fa:Adnotacje>
        <fa:RodzajFaktury>VAT</fa:RodzajFaktury>
        <fa:DodatkowyOpis/>
    </fa:Fa>
    <fa:Stopka>
        <fa:Informacje>
            <fa:StopkaFaktury>Faktura wystawiona za pomocą KSeF Auto</fa:StopkaFaktury>
        </fa:Informacje>
        <fa:Rejestry>
            <fa:NrREjestrowy>${esc(input.invoiceNumber)}</fa:NrREjestrowy>
        </fa:Rejestry>
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
