export function generateInsertEpp(invoices: any[]) {
    // Basic Insert EDI++ (EPP) Format
    let epp = `[INFO]\r\n"1.05",3,1250,"KSeF Auto","","","","",""\r\n\r\n`;
    epp += `[NAGLOWEK]\r\n"FS",1,0,20000,"","","","",0,0,1\r\n\r\n`;
    epp += `[ZAWARTOSC]\r\n`;
    
    invoices.forEach(inv => {
        const type = inv.direction === 'sales' ? 'FS' : 'FZ';
        const nip = inv.direction === 'sales' ? inv.buyer_nip : inv.seller_nip;
        const net = inv.net_amount || '0.00';
        const vat = inv.vat_amount || '0.00';
        const gross = inv.gross_amount || '0.00';

        epp += `${type},"${inv.invoice_number}","${nip || ''}",${net},${vat},${gross}\r\n`;
    });

    return epp;
}
