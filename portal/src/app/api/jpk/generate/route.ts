import { NextResponse } from 'next/server';
import { requireActiveSubscription } from '@/lib/entitlements';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateJpkV7M, JpkGenerationError } from '@/lib/jpk-generator';
import { InvalidJpkMarkerError } from '@/lib/jpk-markers';
import { logActivity } from '@/lib/activity';

// Mirrors workflows/06-jpk-vat-preparation.json's "UPSERT JPK Preparation" node:
// BFK (offline invoice uploaded late) means a correction will be needed; DI
// (marker undetermined, manual review) means the preparation isn't finished;
// otherwise it's ready. Same three-way rule, same column, same meaning - kept
// in one place so the portal route and the n8n workflow don't drift again.
export function determineJpkStatus(invoices: { jpk_marker?: string | null }[]): 'correction_needed' | 'in_progress' | 'ready' {
    if (invoices.some(i => i.jpk_marker === 'BFK')) return 'correction_needed';
    if (invoices.some(i => i.jpk_marker === 'DI')) return 'in_progress';
    return 'ready';
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const planError = await requireActiveSubscription(session.firmId);
    if (planError) return planError;

    const body = await request.json().catch(() => ({}));
    const { clientNip, period } = body; // period: YYYY-MM
    // correction: true files the period again as a correction (CelZlozenia=2).
    const purpose: 1 | 2 = body.correction === true ? 2 : 1;

    if (!clientNip || !period || !/^\d{4}-\d{2}$/.test(period)) {
        return NextResponse.json({ error: 'Wymagane pola: clientNip, period (YYYY-MM)' }, { status: 400 });
    }

    // Verify client belongs to firm
    const clientRes = await query(
        'SELECT id, nip, client_name, tax_office_code, contact_email, taxpayer_type, first_name, last_name, birth_date FROM clients WHERE nip = $1 AND firm_id = $2',
        [clientNip, session.firmId]
    );
    if (!clientRes.rows[0]) return NextResponse.json({ error: 'Klient nie znaleziony' }, { status: 404 });
    const client = clientRes.rows[0];

    // Fetch firm data
    const firmRes = await query('SELECT firm_name FROM firms WHERE id = $1', [session.firmId]);
    const firmName = firmRes.rows[0]?.firm_name || '';

    // Fetch invoices for period
    const [year, month] = period.split('-');
    const periodStart = `${year}-${month}-01`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const periodEnd = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

    const invRes = await query(
        `SELECT i.id, i.invoice_number, i.issue_date, i.seller_name, i.seller_nip, i.buyer_name, i.buyer_nip,
                i.net_amount, i.vat_amount, i.gross_amount, i.direction,
                i.jpk_marker, i.jpk_period, i.jpk_correction_needed, i.ksef_number,
                i.cost_category, i.invoice_lines, i.jpk_gtu, i.jpk_procedures, i.jpk_doc_type, i.jpk_import,
                i.delivery_date, i.ksef_acquisition_date, i.jpk_counterparty_country, i.jpk_margin_gross,
                i.jpk_margin_taxable_gross, i.jpk_margin_vat_rate, i.jpk_margin_method,
                original.invoice_lines AS corrected_original_lines
         FROM invoices i
         LEFT JOIN invoices original ON original.id = i.corrects_invoice_id AND original.firm_id = i.firm_id
         WHERE i.client_nip = $1 AND i.firm_id = $2
           AND (i.jpk_period = $3 OR (i.jpk_period IS NULL AND i.issue_date BETWEEN $4 AND $5))
         ORDER BY i.issue_date ASC, i.id ASC`,
        [clientNip, session.firmId, period, periodStart, periodEnd]
    );

    const invoices = invRes.rows;

    // Generate XML
    // A file that can't be made valid (no tax office, an invoice with neither a
    // KSeF number nor OFF/BFK/DI, ...) is refused with the full list, before
    // anything is recorded or marked exported - never emitted half-right.
    let xml: string;
    try {
        xml = generateJpkV7M(
            {
                nip: client.nip,
                name: client.client_name || firmName,
                taxOfficeCode: client.tax_office_code,
                email: client.contact_email,
                taxpayerType: client.taxpayer_type,
                firstName: client.first_name,
                lastName: client.last_name,
                birthDate: client.birth_date,
            },
            period,
            invoices,
            { purpose }
        );
    } catch (err) {
        if (err instanceof JpkGenerationError) {
            return NextResponse.json(
                { error: `Nie można wygenerować JPK_V7M: ${err.problems.join('; ')}`, problems: err.problems },
                { status: 422 }
            );
        }
        if (err instanceof InvalidJpkMarkerError) {
            return NextResponse.json({ error: `Nie można wygenerować JPK_V7M: ${err.message}` }, { status: 422 });
        }
        throw err;
    }

    // Save to jpk_preparations history. The XML itself was already generated
    // above and is the primary deliverable - a failure here is a real
    // problem (JPK generation history won't be recorded) but shouldn't block
    // returning the XML the user actually asked for. Surfaced via
    // historySaveError rather than swallowed, per the no-silent-failure rule.
    let historySaveError: string | undefined;
    const status = determineJpkStatus(invoices);
    try {
        await query(
            `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (firm_id, client_nip, period) DO UPDATE
             SET export_data = EXCLUDED.export_data, status = EXCLUDED.status, created_at = NOW()`,
            [session.firmId, clientNip, period, xml, status]
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Failed to save jpk_preparations history:', msg);
        historySaveError = msg;
    }

    // Mark the invoices actually included in this report as exported - the
    // literal meaning of 'exported_jpk', not a stand-in for "sent to KSeF"
    // (that's ksef/send/route.ts's 'sent'). Never overwrite a 'rejected' or
    // 'error' invoice: KSeF genuinely refusing an invoice is a real problem
    // that including it in a filed VAT report shouldn't silently paper over.
    if (invoices.length > 0) {
        await query(
            `UPDATE invoices SET processing_status = 'exported_jpk'
             WHERE id = ANY($1) AND firm_id = $2 AND processing_status NOT IN ('rejected', 'error')`,
            [invoices.map(i => i.id), session.firmId]
        );
    }

    await logActivity(
        session.firmId,
        'jpk_generated',
        `Wygenerowano JPK_V7M za ${period} dla ${client.client_name} (${invoices.length} faktur)`
    );

    // Stats for UI
    const salesCount = invoices.filter(i => i.direction === 'sales').length;
    const purchCount = invoices.filter(i => i.direction === 'purchase').length;
    const totalNet = invoices.reduce((s, i) => s + parseFloat(String(i.net_amount || 0)), 0);
    const totalVat = invoices.reduce((s, i) => s + parseFloat(String(i.vat_amount || 0)), 0);
    const totalGross = invoices.reduce((s, i) => s + parseFloat(String(i.gross_amount || 0)), 0);

    return NextResponse.json({
        ok: true,
        xml,
        ...(historySaveError ? { historySaveError } : {}),
        stats: {
            invoiceCount: invoices.length,
            salesCount,
            purchCount,
            totalNet: totalNet.toFixed(2),
            totalVat: totalVat.toFixed(2),
            totalGross: totalGross.toFixed(2),
        },
    });
}

// GET: list past JPK generations
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const clientNip = searchParams.get('clientNip');

    const q = clientNip
        ? `SELECT firm_id, client_nip, period, status, created_at FROM jpk_preparations WHERE firm_id = $1 AND client_nip = $2 ORDER BY created_at DESC LIMIT 20`
        : `SELECT firm_id, client_nip, period, status, created_at FROM jpk_preparations WHERE firm_id = $1 ORDER BY created_at DESC LIMIT 20`;

    const args = clientNip ? [session.firmId, clientNip] : [session.firmId];
    const res = await query(q, args);
    return NextResponse.json({ history: res.rows });
}
