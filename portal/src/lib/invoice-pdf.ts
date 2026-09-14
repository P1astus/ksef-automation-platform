import PDFDocument from 'pdfkit';

// pdfkit (pure JS, no native deps) rather than rendering HTML via
// Puppeteer/Playwright — a headless-Chromium dependency would meaningfully
// bloat and complicate portal/Dockerfile for what's otherwise a plain
// Next.js image. Layout mirrors what invoices/[id]/preview/page.tsx already
// shows (seller/buyer blocks, a line-item table, net/VAT/gross totals) —
// that page is the spec for what belongs on the document, not a new design.

export interface InvoicePdfLine {
    name: string;
    qty: string | number;
    unit?: string;
    net: string | number;
    vat: string | number;
    gross: string | number;
}

export interface InvoicePdfData {
    invoiceNumber: string;
    ksefNumber: string | null;
    direction: string; // 'sales' | 'purchase'
    issueDate: string;
    sellerName: string;
    sellerNip: string;
    buyerName: string;
    buyerNip: string;
    netAmount: string | number;
    vatAmount: string | number;
    grossAmount: string | number;
    currency: string;
    lines: InvoicePdfLine[];
}

function fmt(v: string | number): string {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? String(v) : n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(18).text('Faktura', { align: 'left' });
        doc.fontSize(11).fillColor('#666')
            .text(`${data.invoiceNumber}${data.ksefNumber ? '  ·  KSeF: ' + data.ksefNumber : ''}`)
            .text(`Data wystawienia: ${data.issueDate}  ·  ${data.direction === 'sales' ? 'Sprzedaż' : 'Zakup'}`);
        doc.moveDown(1);

        const colWidth = 240;
        const partyTop = doc.y;
        doc.fillColor('#000').fontSize(10).font('Helvetica-Bold').text('Sprzedawca', 50, partyTop);
        doc.font('Helvetica').text(data.sellerName, 50, partyTop + 14, { width: colWidth });
        doc.text(`NIP: ${data.sellerNip}`, 50, doc.y);

        doc.font('Helvetica-Bold').text('Nabywca', 50 + colWidth + 20, partyTop);
        doc.font('Helvetica').text(data.buyerName, 50 + colWidth + 20, partyTop + 14, { width: colWidth });
        doc.text(`NIP: ${data.buyerNip}`, 50 + colWidth + 20, doc.y);

        doc.moveDown(2);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
        doc.moveDown(1);

        // Line items table
        const tableTop = doc.y;
        const cols = { name: 50, qty: 300, net: 360, vat: 430, gross: 490 };
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#666');
        doc.text('Nazwa', cols.name, tableTop);
        doc.text('Ilość', cols.qty, tableTop);
        doc.text('Netto', cols.net, tableTop);
        doc.text('VAT', cols.vat, tableTop);
        doc.text('Brutto', cols.gross, tableTop);
        doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).strokeColor('#ddd').stroke();

        let y = tableTop + 20;
        doc.font('Helvetica').fontSize(9).fillColor('#000');
        for (const line of data.lines) {
            doc.text(String(line.name), cols.name, y, { width: 240 });
            doc.text(`${line.qty}${line.unit ? ' ' + line.unit : ''}`, cols.qty, y);
            doc.text(fmt(line.net), cols.net, y);
            doc.text(fmt(line.vat), cols.vat, y);
            doc.text(fmt(line.gross), cols.gross, y);
            y += 18;
        }

        doc.moveTo(50, y + 4).lineTo(545, y + 4).strokeColor('#ddd').stroke();
        y += 16;
        doc.font('Helvetica').fontSize(10);
        doc.text(`Razem netto: ${fmt(data.netAmount)} ${data.currency}`, cols.net, y);
        y += 16;
        doc.text(`VAT: ${fmt(data.vatAmount)} ${data.currency}`, cols.net, y);
        y += 16;
        doc.font('Helvetica-Bold').text(`Do zapłaty: ${fmt(data.grossAmount)} ${data.currency}`, cols.net, y);

        doc.fontSize(8).fillColor('#999').text('Wygenerowano automatycznie przez KSeF Auto', 50, 780, { align: 'center', width: 495 });

        doc.end();
    });
}
