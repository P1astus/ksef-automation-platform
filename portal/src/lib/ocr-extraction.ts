import { recognize } from 'tesseract.js';

// Shared by ocr/route.ts, email/sync/route.ts and upload/[token]/route.ts's
// eventual processing step — previously duplicated near-identically between
// the first two, which is exactly how a confidence rule ends up drifting
// between call sites if it's ever added in only one place.

export async function extractTextFromFile(buffer: Buffer, mimeType: string): Promise<string> {
    if (mimeType === 'application/pdf') {
        // pdf-parse 2.x's real API is nothing like the pre-existing code
        // here assumed: no callable default export, no `{text}` return
        // shape. It's a PDFParse class - new PDFParse({data}).getText()
        // returns a TextResult whose .text is the concatenated document
        // string. Confirmed live: the old `require('pdf-parse')(buffer)`
        // call threw "TypeError: r is not a function" immediately once the
        // unrelated Turbopack/canvas bundling issue (see Dockerfile) was
        // itself fixed enough to reach this code at all - PDF-based OCR
        // had never actually worked, for two independent reasons stacked
        // on top of each other.
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        try {
            const result = await parser.getText();
            return result.text;
        } finally {
            await parser.destroy();
        }
    }
    if (mimeType.startsWith('image/')) {
        const { data } = await recognize(buffer, 'pol');
        return data.text;
    }
    throw new Error('Unsupported format');
}

export interface ExtractedInvoiceFields {
    nip: string;
    nipMatched: boolean;
    invoiceNumber: string | null; // null when nothing was found in the text - the caller decides the fallback label
    grossAmount: number;
    netAmount: number;
    vatAmount: number;
}

export function extractInvoiceFields(text: string): ExtractedInvoiceFields {
    const cleanText = text.replace(/\s+/g, ' ');

    const nipMatch = cleanText.match(/(?:NIP|NIP:|NIP\s*:)?\s*([0-9]{3}[\s-]?[0-9]{3}[\s-]?[0-9]{2}[\s-]?[0-9]{2})/i);
    const nip = nipMatch ? nipMatch[1].replace(/[\s-]/g, '') : 'NIEZNANY';

    const invMatch = cleanText.match(/(?:Faktura\sVAT\snr|Faktura\snr|FV|Faktura\s+Nr)\s*:?\s*([A-Za-z0-9/\-]+)/i);
    const invoiceNumber = invMatch ? invMatch[1] : null;

    let grossAmount = 0;
    let netAmount = 0;
    let vatAmount = 0;
    const moneyMatches = cleanText.match(/\d+[.,]\d{2}/g);
    if (moneyMatches && moneyMatches.length > 0) {
        const numbers = moneyMatches.map(m => parseFloat(m.replace(',', '.')));
        numbers.sort((a, b) => b - a);
        // The largest number on an invoice is usually the gross total.
        grossAmount = numbers[0];
        // No independent net/VAT extraction yet - derived assuming 23% VAT,
        // which is why the reconciliation check in needsManualReview() below
        // can never itself catch a bad extraction today (net is defined as
        // gross/1.23, so it always "reconciles" by construction) - it's kept
        // anyway so it starts working the moment net/VAT are ever extracted
        // independently instead of derived.
        netAmount = Number((grossAmount / 1.23).toFixed(2));
        vatAmount = Number((grossAmount - netAmount).toFixed(2));
    }

    return { nip, nipMatched: !!nipMatch, invoiceNumber, grossAmount, netAmount, vatAmount };
}

export function needsManualReview(fields: ExtractedInvoiceFields): boolean {
    // Amounts are currently inferred from the largest figure and a guessed
    // 23% rate. They are useful review hints, never reliable booking data:
    // auto-promoting an 8% invoice silently changed its VAT and issue date.
    void fields;
    return true;
}
