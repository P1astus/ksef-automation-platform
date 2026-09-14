import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildInvoicePdf, type InvoicePdfLine } from '@/lib/invoice-pdf';

// Fallback for invoices with no stored invoice_lines (e.g. pulled in from
// KSeF by 04-ksef-invoice-retrieval.json, which receives someone else's
// already-built FA(3) document rather than building one itself). Uses the
// real FA(3) element/field names (FaWiersz/P_7/P_8A/P_8B/P_9A/P_11/P_12) -
// see ksef-invoice-builder.ts. NOT the same regex as
// invoices/[id]/preview/page.tsx's parseXmlLines(), which looks for
// "WierszFaktury" — a tag name the builder has never actually emitted, in
// FA(3) or the FA(2)-era code before it (real tag names: FaWiersz now,
// FakturaWiersz before) — flagged as a separate, pre-existing bug, not
// fixed here since this route doesn't depend on that function.
function parseLinesFromXml(xml: string): InvoicePdfLine[] {
    const lines: InvoicePdfLine[] = [];
    const blockRegex = /<fa:FaWiersz>([\s\S]*?)<\/fa:FaWiersz>/g;
    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(xml)) !== null) {
        const block = match[1];
        const get = (tag: string) => {
            const m = block.match(new RegExp(`<fa:${tag}>([^<]*)</fa:${tag}>`));
            return m ? m[1] : '';
        };
        lines.push({
            name: get('P_7') || '—',
            qty: get('P_8B') || '1',
            unit: get('P_8A'),
            net: get('P_11') || '0',
            vat: '', // per-line VAT amount isn't separately reported in FA(3) - only the rate (P_12) and the invoice-level P_14_x total
            gross: '',
        });
    }
    return lines;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const res = await query(
        `SELECT invoice_number, ksef_number, direction, issue_date,
                seller_name, seller_nip, buyer_name, buyer_nip,
                net_amount, vat_amount, gross_amount, currency,
                invoice_lines, raw_xml
         FROM invoices WHERE id = $1 AND firm_id = $2`,
        [id, session.firmId]
    );
    const invoice = res.rows[0];
    if (!invoice) return NextResponse.json({ error: 'Faktura nie znaleziona' }, { status: 404 });

    let lines: InvoicePdfLine[];
    if (Array.isArray(invoice.invoice_lines) && invoice.invoice_lines.length > 0) {
        lines = invoice.invoice_lines.map((l: { name: string; qty: number; unit: string; netPrice: number; vatRate: string }) => {
            const net = l.qty * l.netPrice;
            const vatRate = l.vatRate === 'zw' ? 0 : parseFloat(l.vatRate) / 100;
            const vat = l.vatRate === 'zw' ? 0 : net * vatRate;
            return { name: l.name, qty: l.qty, unit: l.unit, net, vat, gross: net + vat };
        });
    } else if (invoice.raw_xml) {
        lines = parseLinesFromXml(invoice.raw_xml);
    } else {
        lines = [];
    }

    const pdf = await buildInvoicePdf({
        invoiceNumber: invoice.invoice_number || '',
        ksefNumber: invoice.ksef_number,
        direction: invoice.direction,
        issueDate: invoice.issue_date ? new Date(invoice.issue_date).toISOString().slice(0, 10) : '',
        sellerName: invoice.seller_name || '',
        sellerNip: invoice.seller_nip || '',
        buyerName: invoice.buyer_name || '',
        buyerNip: invoice.buyer_nip || '',
        netAmount: invoice.net_amount || 0,
        vatAmount: invoice.vat_amount || 0,
        grossAmount: invoice.gross_amount || 0,
        currency: invoice.currency || 'PLN',
        lines,
    });

    return new NextResponse(new Uint8Array(pdf), {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${(invoice.invoice_number || `faktura-${id}`).replace(/[^a-zA-Z0-9_.-]/g, '_')}.pdf"`,
        },
    });
}
