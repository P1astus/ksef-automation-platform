// Extracts line items from a raw FA(3) invoice XML string (see
// ksef-invoice-builder.ts for what actually gets emitted). The real
// wrapper is <fa:FaWiersz> (P_7 name, P_8A unit, P_8B qty, P_9A unit net
// price, P_11 line net value, P_12 VAT rate code) - not "WierszFaktury",
// a tag the builder has never actually emitted in FA(3) or the FA(2)-era
// code before it. FA(3) doesn't report a per-line VAT amount or gross
// value at all, only the rate code and the invoice-level P_14_x total, so
// there's nothing to extract for those - callers that need a display
// value for them have to compute it themselves (or leave it blank).
//
// Missing tags come back as '' - callers apply their own fallback
// (a display placeholder, a numeric default) since that differs by caller.
export interface Fa3Line {
    name: string;
    qty: string;
    unit: string;
    netPrice: string;
    net: string;
    vatRate: string;
}

export function parseFa3Lines(xml: string): Fa3Line[] {
    const lines: Fa3Line[] = [];
    const lineRegex = /<fa:FaWiersz>([\s\S]*?)<\/fa:FaWiersz>/g;
    let match: RegExpExecArray | null;
    while ((match = lineRegex.exec(xml)) !== null) {
        const block = match[1];
        const get = (tag: string) => {
            const m = block.match(new RegExp(`<fa:${tag}>([^<]*)</fa:${tag}>`));
            return m ? m[1] : '';
        };
        lines.push({
            name: get('P_7'),
            qty: get('P_8B'),
            unit: get('P_8A'),
            netPrice: get('P_9A'),
            net: get('P_11'),
            vatRate: get('P_12'),
        });
    }
    return lines;
}
