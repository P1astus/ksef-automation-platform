import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildInvoicePdf, type InvoicePdfLine } from '@/lib/invoice-pdf';
import { isZeroVatRate, type VatRateCode } from '@/lib/ksef-invoice-builder';
import { parseFa3Lines } from '@/lib/parse-fa3-lines';

// Fallback for invoices with no stored invoice_lines (e.g. pulled in from
// KSeF by 04-ksef-invoice-retrieval.json, which receives someone else's
// already-built FA(3) document rather than building one itself). See
// lib/parse-fa3-lines.ts for what it extracts and why there's no per-line
// "vat"/"gross" to recover — FA(3) only reports the rate code (P_12) and
// the invoice-level P_14_x total, never a per-line VAT amount.
function parseLinesFromXml(xml: string): InvoicePdfLine[] {
    return parseFa3Lines(xml).map(l => ({
        name: l.name || '—',
        qty: l.qty || '1',
        unit: l.unit,
        net: l.net || '0',
        vat: '',
        gross: '',
    }));
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const res = await query(
        `SELECT invoice_number, ksef_number, direction, issue_date,
                seller_name, seller_nip, buyer_name, buyer_nip,
                net_amount, vat_amount, gross_amount, currency,
                invoice_lines, raw_xml, jpk_margin_taxable_gross
         FROM invoices WHERE id = $1 AND firm_id = $2`,
        [id, session.firmId]
    );
    const invoice = res.rows[0];
    if (!invoice) return NextResponse.json({ error: 'Faktura nie znaleziona' }, { status: 404 });

    let lines: InvoicePdfLine[];
    if (Array.isArray(invoice.invoice_lines) && invoice.invoice_lines.length > 0) {
        lines = invoice.invoice_lines.map((l: { name: string; qty: number; unit: string; netPrice: number; vatRate: VatRateCode }) => {
            const net = l.qty * l.netPrice;
            const vatRate = isZeroVatRate(l.vatRate) ? 0 : parseFloat(l.vatRate) / 100;
            const vat = isZeroVatRate(l.vatRate) ? 0 : net * vatRate;
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
        // Do not pass the internal taxable margin to the PDF renderer. Its
        // mere presence only selects the buyer-facing VAT-marża layout.
        isMarginScheme: invoice.jpk_margin_taxable_gross !== null && invoice.jpk_margin_taxable_gross !== undefined,
    });

    return new NextResponse(new Uint8Array(pdf), {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${(invoice.invoice_number || `faktura-${id}`).replace(/[^a-zA-Z0-9_.-]/g, '_')}.pdf"`,
        },
    });
}
