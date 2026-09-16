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
}

function esc(s: string | undefined | null): string {
    if (!s) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function r2(n: number | string): string {
    return parseFloat(String(n) || '0').toFixed(2);
}

function sumField(rows: JpkInvoiceRow[], field: keyof JpkInvoiceRow): string {
    return rows.reduce((s, r) => s + parseFloat(String(r[field] || 0)), 0).toFixed(2);
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

    // Sales rows
    const salesRows = sales.map((inv, idx) => {
        const prefix = inv.jpk_correction_needed ? 'COR' : '';
        const ksefRef = inv.ksef_number || inv.jpk_marker || '';
        return `
        <tns:SprzedazWiersz>
            <tns:LpSprzedazy>${idx + 1}</tns:LpSprzedazy>
            <tns:NrKontrahenta>${esc(inv.buyer_nip)}</tns:NrKontrahenta>
            <tns:NazwaKontrahenta>${esc(inv.buyer_name)}</tns:NazwaKontrahenta>
            <tns:DowodSprzedazy>${esc(prefix + inv.invoice_number)}</tns:DowodSprzedazy>
            <tns:DataWystawienia>${fmtDate(inv.issue_date) || periodStart}</tns:DataWystawienia>
            ${ksefRef ? `<tns:KodKSeF>${esc(ksefRef)}</tns:KodKSeF>` : ''}
            <tns:K_19>${r2(inv.net_amount)}</tns:K_19>
            <tns:K_20>${r2(inv.vat_amount)}</tns:K_20>
        </tns:SprzedazWiersz>`;
    }).join('');

    const salesTotalNet = parseFloat(sumField(sales, 'net_amount'));
    const salesTotalVat = parseFloat(sumField(sales, 'vat_amount'));

    // Purchase rows
    const purchaseRows = purchases.map((inv, idx) => `
        <tns:ZakupWiersz>
            <tns:LpZakupu>${idx + 1}</tns:LpZakupu>
            <tns:NrDostawcy>${esc(inv.seller_nip)}</tns:NrDostawcy>
            <tns:NazwaDostawcy>${esc(inv.seller_name)}</tns:NazwaDostawcy>
            <tns:DowodZakupu>${esc(inv.invoice_number)}</tns:DowodZakupu>
            <tns:DataZakupu>${fmtDate(inv.issue_date) || periodStart}</tns:DataZakupu>
            <tns:DataWplywu>${fmtDate(inv.issue_date) || periodStart}</tns:DataWplywu>
            <tns:K_40>${r2(inv.net_amount)}</tns:K_40>
            <tns:K_41>${r2(inv.vat_amount)}</tns:K_41>
        </tns:ZakupWiersz>`).join('');

    const purchTotalNet = parseFloat(sumField(purchases, 'net_amount'));
    const purchTotalVat = parseFloat(sumField(purchases, 'vat_amount'));

    // VAT declaration summary (P_xx fields)
    const p10 = salesTotalNet.toFixed(2); // net sales (23%)
    const p20 = salesTotalVat.toFixed(2); // VAT on sales
    const p40 = purchTotalNet.toFixed(2); // net purchases
    const p41 = purchTotalVat.toFixed(2); // VAT on purchases
    const vatPayable = Math.max(0, salesTotalVat - purchTotalVat).toFixed(2);
    const vatRefund = Math.max(0, purchTotalVat - salesTotalVat).toFixed(2);

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
            <tns:PodatekNalezny>${salesTotalVat.toFixed(2)}</tns:PodatekNalezny>
        </tns:SprzedazCtrl>
        ${purchaseRows}
        <tns:ZakupCtrl>
            <tns:LiczbaWierszyZakupow>${purchases.length}</tns:LiczbaWierszyZakupow>
            <tns:PodatekNaliczony>${purchTotalVat.toFixed(2)}</tns:PodatekNaliczony>
        </tns:ZakupCtrl>
    </tns:Ewidencja>

    <tns:Deklaracja>
        <tns:Miesiac>${parseInt(month)}</tns:Miesiac>
        <tns:Rok>${year}</tns:Rok>
        <tns:PozycjeSzczegolowe>
            <tns:P_10>${p10}</tns:P_10>
            <tns:P_11>0.00</tns:P_11>
            <tns:P_12>0.00</tns:P_12>
            <tns:P_13>0.00</tns:P_13>
            <tns:P_14>0.00</tns:P_14>
            <tns:P_15>0.00</tns:P_15>
            <tns:P_16>0.00</tns:P_16>
            <tns:P_17>0.00</tns:P_17>
            <tns:P_18>0.00</tns:P_18>
            <tns:P_19>0.00</tns:P_19>
            <tns:P_20>${p20}</tns:P_20>
            <tns:P_21>0.00</tns:P_21>
            <tns:P_22>0.00</tns:P_22>
            <tns:P_23>0.00</tns:P_23>
            <tns:P_24>0.00</tns:P_24>
            <tns:P_25>0.00</tns:P_25>
            <tns:P_26>0.00</tns:P_26>
            <tns:P_27>0.00</tns:P_27>
            <tns:P_28>0.00</tns:P_28>
            <tns:P_29>0.00</tns:P_29>
            <tns:P_30>0.00</tns:P_30>
            <tns:P_31>0.00</tns:P_31>
            <tns:P_32>0.00</tns:P_32>
            <tns:P_33>0.00</tns:P_33>
            <tns:P_34>0.00</tns:P_34>
            <tns:P_35>0.00</tns:P_35>
            <tns:P_36>0.00</tns:P_36>
            <tns:P_37>0.00</tns:P_37>
            <tns:P_38>${salesTotalVat.toFixed(2)}</tns:P_38>
            <tns:P_39>0.00</tns:P_39>
            <tns:P_40>${p40}</tns:P_40>
            <tns:P_41>${p41}</tns:P_41>
            <tns:P_42>0.00</tns:P_42>
            <tns:P_43>0.00</tns:P_43>
            <tns:P_44>0.00</tns:P_44>
            <tns:P_45>0.00</tns:P_45>
            <tns:P_46>0.00</tns:P_46>
            <tns:P_47>${purchTotalVat.toFixed(2)}</tns:P_47>
            <tns:P_48>0.00</tns:P_48>
            <tns:P_49>0.00</tns:P_49>
            <tns:P_50>0.00</tns:P_50>
            <tns:P_51>${vatPayable}</tns:P_51>
            <tns:P_52>0.00</tns:P_52>
            <tns:P_53>0.00</tns:P_53>
            <tns:P_54>0.00</tns:P_54>
            <tns:P_55>0.00</tns:P_55>
            <tns:P_56>0.00</tns:P_56>
            <tns:P_57>0.00</tns:P_57>
            <tns:P_58>${vatPayable}</tns:P_58>
            <tns:P_59>0</tns:P_59>
            <tns:P_60>${vatRefund}</tns:P_60>
            <tns:P_61>0.00</tns:P_61>
            <tns:P_62>0.00</tns:P_62>
            <tns:P_63>0.00</tns:P_63>
            <tns:P_64>0.00</tns:P_64>
            <tns:P_65>0.00</tns:P_65>
            <tns:P_66>0</tns:P_66>
            <tns:P_67>0</tns:P_67>
            <tns:P_68>0</tns:P_68>
        </tns:PozycjeSzczegolowe>
    </tns:Deklaracja>

</tns:JPK>`;
}
