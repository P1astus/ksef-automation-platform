/**
 * Utility to map KSeF Invoice Database records into Comarch ERP Optima XML format.
 * Optima uses a specific XML schema for importing VAT registers (Rejestry VAT offline).
 */

export function generateOptimaXml(invoices: any[]) {
    const now = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="utf-8"?>
`;
    xml += `<ROOT xmlns="http://www.comarch.pl/cdn/optima/offline">
`;

    const salesInvoices = invoices.filter(inv => inv.direction === 'sales');
    const purchaseInvoices = invoices.filter(inv => inv.direction === 'purchases');

    // Sales (Rejestry Sprzedaży)
    if (salesInvoices.length > 0) {
        xml += `  <REJESTRY_SPRZEDAZY_VAT>
`;
        salesInvoices.forEach(inv => {
            xml += `    <REJESTR_SPRZEDAZY_VAT>
`;
            xml += `      <MODUL>Księga Handlowa</MODUL>
`;
            xml += `      <TYP>Sprzedaż</TYP>
`;
            xml += `      <KATEGORIA>Przychody</KATEGORIA>
`;
            xml += `      <DATA_WYSTAWIENIA>${inv.issue_date ? new Date(inv.issue_date).toISOString().split('T')[0] : now}</DATA_WYSTAWIENIA>
`;
            xml += `      <DATA_SPRZEDAZY>${inv.issue_date ? new Date(inv.issue_date).toISOString().split('T')[0] : now}</DATA_SPRZEDAZY>
`;
            xml += `      <NUMER>${escapeXml(inv.invoice_number)}</NUMER>
`;
            xml += `      <KONTRAHENT>
`;
            xml += `        <NIP>${inv.buyer_nip}</NIP>
`;
            xml += `      </KONTRAHENT>
`;
            xml += `      <POZYCJE>
`;
            xml += `        <POZYCJA>
`;
            xml += `          <STAWKA_VAT>23.00</STAWKA_VAT>
`; // Defaulting to 23% for MVP mapping
            xml += `          <KWOTA_NETTO>${inv.net_amount || '0.00'}</KWOTA_NETTO>
`;
            xml += `          <KWOTA_VAT>${inv.vat_amount || '0.00'}</KWOTA_VAT>
`;
            xml += `          <KWOTA_BRUTTO>${inv.gross_amount || '0.00'}</KWOTA_BRUTTO>
`;
            xml += `        </POZYCJA>
`;
            xml += `      </POZYCJE>
`;
            xml += `      <OPIS>Faktura KSeF: ${inv.ksef_number}</OPIS>
`;
            xml += `    </REJESTR_SPRZEDAZY_VAT>
`;
        });
        xml += `  </REJESTRY_SPRZEDAZY_VAT>
`;
    }

    // Purchases (Rejestry Zakupów)
    if (purchaseInvoices.length > 0) {
        xml += `  <REJESTRY_ZAKUPOW_VAT>
`;
        purchaseInvoices.forEach(inv => {
            xml += `    <REJESTR_ZAKUPU_VAT>
`;
            xml += `      <MODUL>Księga Handlowa</MODUL>
`;
            xml += `      <TYP>Zakup</TYP>
`;
            xml += `      <KATEGORIA>Koszty</KATEGORIA>
`;
            xml += `      <DATA_WYSTAWIENIA>${inv.issue_date ? new Date(inv.issue_date).toISOString().split('T')[0] : now}</DATA_WYSTAWIENIA>
`;
            xml += `      <DATA_ZAKUPU>${inv.issue_date ? new Date(inv.issue_date).toISOString().split('T')[0] : now}</DATA_ZAKUPU>
`;
            xml += `      <NUMER>${escapeXml(inv.invoice_number)}</NUMER>
`;
            xml += `      <KONTRAHENT>
`;
            xml += `        <NIP>${inv.seller_nip}</NIP>
`;
            xml += `      </KONTRAHENT>
`;
            xml += `      <POZYCJE>
`;
            xml += `        <POZYCJA>
`;
            xml += `          <STAWKA_VAT>23.00</STAWKA_VAT>
`; // Defaulting to 23% for MVP mapping
            xml += `          <KWOTA_NETTO>${inv.net_amount || '0.00'}</KWOTA_NETTO>
`;
            xml += `          <KWOTA_VAT>${inv.vat_amount || '0.00'}</KWOTA_VAT>
`;
            xml += `          <KWOTA_BRUTTO>${inv.gross_amount || '0.00'}</KWOTA_BRUTTO>
`;
            xml += `        </POZYCJA>
`;
            xml += `      </POZYCJE>
`;
            xml += `      <OPIS>Faktura KSeF: ${inv.ksef_number}</OPIS>
`;
            xml += `    </REJESTR_ZAKUPU_VAT>
`;
        });
        xml += `  </REJESTRY_ZAKUPOW_VAT>
`;
    }

    xml += `</ROOT>`;
    return xml;
}

function escapeXml(unsafe: string | null | undefined): string {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/[<>&'"]/g, function (c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case "'": return '&apos;';
                case '"': return '&quot;';
                default: return c;
            }
        });
}
