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

        txt += `Dokument\t${type}\t${inv.invoice_number}\t${date}\t${nip}\t${net}\t${vat}\t${gross}\r\n`;
    });

    return txt;
}
