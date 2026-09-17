// A tab or newline anywhere in a free-text field (invoice_number is
// unrestricted on the invoice-creation form) shifts every subsequent column
// in this tab-separated format once imported into real Symfonia software.
// Found round 11 alongside the identical gap in insert-mapper.ts —
// CLAUDE.md calls out these mappers' column order/encoding as load-bearing.
function escTsv(s: string): string {
    return String(s ?? '').replace(/[\t\r\n]/g, ' ');
}

export function generateSymfoniaTxt(invoices: any[]) {
    // Basic Symfonia ASCII / AMFK Format 3.0 structure
    let txt = `Format\tFirma\t1.0\r\n`;
    txt += `Zrodlo\tKSeF Auto\r\n`;

    invoices.forEach(inv => {
        const type = inv.direction === 'sales' ? 'SPRZEDAZ' : 'ZAKUP';
        const date = inv.issue_date ? new Date(inv.issue_date).toISOString().split('T')[0] : '';
        const nip = inv.buyer_nip || inv.seller_nip || '';
        const net = inv.net_amount || '0.00';
        const vat = inv.vat_amount || '0.00';
        const gross = inv.gross_amount || '0.00';

        txt += `Dokument\t${type}\t${escTsv(inv.invoice_number)}\t${date}\t${escTsv(nip)}\t${net}\t${vat}\t${gross}\r\n`;
    });

    return txt;
}
