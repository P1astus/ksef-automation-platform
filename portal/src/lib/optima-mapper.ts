/**
 * Utility to map KSeF Invoice Database records into Comarch ERP Optima XML format.
 * Optima uses a specific XML schema for importing VAT registers (Rejestry VAT offline).
 */

const LEGAL_RATES: Record<string, number> = { '23': 0.23, '8': 0.08, '5': 0.05, '0': 0 };
// Absorbs rounding on the stored decimal amounts, not a real tolerance for
// distinguishing between legal rates (23/8/5/0 are far enough apart that
// ±0.5 points never confuses two of them).
const RATIO_TOLERANCE = 0.005;

interface RateLine {
    rate: string; // '23' | '8' | '5' | '0' | 'zw' | 'np'
    net: number;
    vat: number;
    source: 'lines' | 'ratio';
}

export class OptimaExportError extends Error {
    constructor(public failures: { invoiceNumber: string; ksefNumber: string; reason: string }[]) {
        super(
            `Could not determine a VAT rate for ${failures.length} invoice(s): ` +
            failures.map(f => `${f.invoiceNumber || f.ksefNumber || '(no number)'} - ${f.reason}`).join('; ')
        );
        this.name = 'OptimaExportError';
    }
}

export interface OptimaExportResult {
    xml: string;
    // Invoices where at least one line's rate came from the net/vat ratio
    // rather than invoice_lines - a blended (mixed-rate) invoice with no
    // line-level data can coincidentally match a single legal rate by
    // ratio alone, and that can't be detected from the ratio itself. Not a
    // silent failure, but worth a human spot-check - surfaced here rather
    // than hidden.
    ratioDerivedCount: number;
}

/**
 * Derive the VAT rate breakdown for one invoice, in order of preference:
 *  1. Per-line rates from invoice_lines JSONB, grouped by rate (handles
 *     mixed-rate invoices - one <POZYCJA> per distinct rate).
 *  2. If invoice_lines is absent or empty, derive a single rate from
 *     vat_amount / net_amount, matched to the nearest legal rate within
 *     RATIO_TOLERANCE. Never fires if invoice_lines exists but is missing a
 *     rate on some line - that's a sign of a mixed-rate invoice, and
 *     blending it into one ratio would silently misrepresent it.
 *  3. Otherwise, returns an error naming the invoice - never falls back to
 *     a hardcoded rate.
 */
function deriveRateLines(inv: any): RateLine[] | { error: string } {
    if (inv.invoice_lines) {
        let lines: any[];
        try {
            lines = typeof inv.invoice_lines === 'string' ? JSON.parse(inv.invoice_lines) : inv.invoice_lines;
        } catch {
            return { error: 'invoice_lines is not valid JSON' };
        }

        if (Array.isArray(lines) && lines.length > 0) {
            const grouped = new Map<string, { net: number; vat: number }>();
            for (const line of lines) {
                const rate = line.vatRate;
                if (rate === undefined || rate === null || rate === '') {
                    return { error: 'has a line item with no vatRate set' };
                }
                const rateKey = String(rate);
                const net = Number(line.net ?? line.netAmount ?? 0);
                let vat: number;
                if (rateKey === 'zw' || rateKey === 'np') {
                    vat = 0;
                } else if (rateKey in LEGAL_RATES) {
                    vat = Math.round(net * LEGAL_RATES[rateKey] * 100) / 100;
                } else {
                    return { error: `has a line item with an unrecognized vatRate "${rate}"` };
                }
                const g = grouped.get(rateKey) || { net: 0, vat: 0 };
                g.net += net;
                g.vat += vat;
                grouped.set(rateKey, g);
            }
            return [...grouped.entries()].map(([rate, { net, vat }]) => ({ rate, net, vat, source: 'lines' as const }));
        }
    }

    // No invoice_lines (or an empty array) - no signal of a mixed-rate
    // invoice, safe to attempt a single ratio-derived rate.
    const net = Number(inv.net_amount || 0);
    const vat = Number(inv.vat_amount || 0);

    if (net === 0) {
        if (vat === 0) return [{ rate: '0', net: 0, vat: 0, source: 'ratio' }];
        return { error: `has net_amount = 0 but vat_amount = ${vat} - cannot derive a rate` };
    }

    const ratio = vat / net;
    for (const [rate, legalRatio] of Object.entries(LEGAL_RATES)) {
        if (Math.abs(ratio - legalRatio) <= RATIO_TOLERANCE) {
            return [{ rate, net, vat, source: 'ratio' }];
        }
    }
    return {
        error: `has no invoice_lines and its net/vat ratio (${(ratio * 100).toFixed(2)}%) does not match any legal VAT rate (23/8/5/0%) within tolerance`,
    };
}

function formatRate(rate: string): string {
    return rate === 'zw' || rate === 'np' ? rate : Number(rate).toFixed(2);
}

export function generateOptimaXml(invoices: any[]): OptimaExportResult {
    const now = new Date().toISOString().split('T')[0];

    const salesInvoices = invoices.filter(inv => inv.direction === 'sales');
    const purchaseInvoices = invoices.filter(inv => inv.direction === 'purchase');

    // Resolve every invoice's rate breakdown up front, collecting failures
    // across ALL invoices rather than throwing on the first one - a bad
    // invoice shouldn't take down the register for every other invoice in
    // the period, but nothing gets silently skipped either.
    const failures: { invoiceNumber: string; ksefNumber: string; reason: string }[] = [];
    let ratioDerivedCount = 0;

    const resolve = (inv: any): RateLine[] | null => {
        const result = deriveRateLines(inv);
        if ('error' in result) {
            failures.push({ invoiceNumber: inv.invoice_number, ksefNumber: inv.ksef_number, reason: result.error });
            return null;
        }
        if (result.some(l => l.source === 'ratio')) ratioDerivedCount++;
        return result;
    };

    const salesResolved = salesInvoices.map(inv => ({ inv, lines: resolve(inv) }));
    const purchaseResolved = purchaseInvoices.map(inv => ({ inv, lines: resolve(inv) }));

    if (failures.length > 0) {
        throw new OptimaExportError(failures);
    }

    let xml = `<?xml version="1.0" encoding="utf-8"?>
`;
    xml += `<ROOT xmlns="http://www.comarch.pl/cdn/optima/offline">
`;

    // Sales (Rejestry Sprzedaży)
    if (salesResolved.length > 0) {
        xml += `  <REJESTRY_SPRZEDAZY_VAT>
`;
        salesResolved.forEach(({ inv, lines }) => {
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
            lines!.forEach(line => {
                xml += `        <POZYCJA>
`;
                xml += `          <STAWKA_VAT>${formatRate(line.rate)}</STAWKA_VAT>
`;
                xml += `          <KWOTA_NETTO>${line.net.toFixed(2)}</KWOTA_NETTO>
`;
                xml += `          <KWOTA_VAT>${line.vat.toFixed(2)}</KWOTA_VAT>
`;
                xml += `          <KWOTA_BRUTTO>${(line.net + line.vat).toFixed(2)}</KWOTA_BRUTTO>
`;
                xml += `        </POZYCJA>
`;
            });
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
    if (purchaseResolved.length > 0) {
        xml += `  <REJESTRY_ZAKUPOW_VAT>
`;
        purchaseResolved.forEach(({ inv, lines }) => {
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
            lines!.forEach(line => {
                xml += `        <POZYCJA>
`;
                xml += `          <STAWKA_VAT>${formatRate(line.rate)}</STAWKA_VAT>
`;
                xml += `          <KWOTA_NETTO>${line.net.toFixed(2)}</KWOTA_NETTO>
`;
                xml += `          <KWOTA_VAT>${line.vat.toFixed(2)}</KWOTA_VAT>
`;
                xml += `          <KWOTA_BRUTTO>${(line.net + line.vat).toFixed(2)}</KWOTA_BRUTTO>
`;
                xml += `        </POZYCJA>
`;
            });
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
    return { xml, ratioDerivedCount };
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
