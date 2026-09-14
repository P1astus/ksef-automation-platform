import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateJpkV7M } from '@/lib/jpk-generator';
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

    const body = await request.json().catch(() => ({}));
    const { clientNip, period } = body; // period: YYYY-MM

    if (!clientNip || !period || !/^\d{4}-\d{2}$/.test(period)) {
        return NextResponse.json({ error: 'Wymagane pola: clientNip, period (YYYY-MM)' }, { status: 400 });
    }

    // Verify client belongs to firm
    const clientRes = await query(
        'SELECT id, nip, client_name FROM clients WHERE nip = $1 AND firm_id = $2',
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
        `SELECT id, invoice_number, issue_date, seller_name, seller_nip, buyer_name, buyer_nip,
                net_amount, vat_amount, gross_amount, direction,
                jpk_marker, jpk_period, jpk_correction_needed, ksef_number
         FROM invoices
         WHERE client_nip = $1 AND firm_id = $2
           AND (jpk_period = $3 OR (jpk_period IS NULL AND issue_date BETWEEN $4 AND $5))
         ORDER BY issue_date ASC, id ASC`,
        [clientNip, session.firmId, period, periodStart, periodEnd]
    );

    const invoices = invRes.rows;

    // Generate XML
    const xml = generateJpkV7M(
        { nip: client.nip, name: client.client_name || firmName },
        period,
        invoices
    );

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
