// Text that crosses into another interpreter: e-mail HTML and spreadsheet
// cells. Firm/client names, request messages, invoice numbers and KSeF error
// text are user- or counterparty-controlled (a supplier chooses the seller name
// and invoice number of every purchase invoice synced from KSeF).

export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const PLAIN_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

// Excel/LibreOffice evaluate a cell beginning with = + - @ (or a tab/CR before
// one) as a formula. A leading apostrophe makes the cell literal text. Plain
// numbers, including negative correction amounts, are left as they are.
export function neutralizeSpreadsheetFormula(value: string): string {
    return /^[=+\-@\t\r]/.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
}
