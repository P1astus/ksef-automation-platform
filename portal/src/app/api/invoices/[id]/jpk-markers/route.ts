import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { requireActiveSubscription } from '@/lib/entitlements';
import { isValidCountryCode } from '@/lib/country-codes';
import { normalizeJpkMarkers, normalizeJpkDocType, InvalidJpkMarkerError } from '@/lib/jpk-markers';

// Sets the row-level JPK_V7M(3) markers on an invoice.
//  - sales:    GTU_xx, procedure flags, and TypDokumentu (RO/WEW/FP)
//  - purchase: DokumentZakupu (MK/VAT_RR/WEW) and the IMP flag
// Works on any invoice, including ones synced in from KSeF (those carry no
// marker data), and is deliberately allowed after the invoice was included in
// a generated JPK - the fix is to edit and regenerate.
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const subscriptionError = await requireActiveSubscription(session.firmId);
    if (subscriptionError) return subscriptionError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // Code validation needs no DB, so bad input is refused before any lookup.
    let markers;
    try {
        markers = normalizeJpkMarkers({ gtu: body.gtu, procedures: body.procedures });
    } catch (err) {
        if (err instanceof InvalidJpkMarkerError) return NextResponse.json({ error: err.message }, { status: 400 });
        throw err;
    }

    // Ownership is checked directly against invoices.firm_id (same reason as
    // the payment route: a NIP can belong to more than one firm).
    const check = await query('SELECT direction FROM invoices WHERE id = $1 AND firm_id = $2', [id, session.firmId]);
    if (!check.rows[0]) return NextResponse.json({ error: 'Nie znaleziono faktury' }, { status: 404 });
    const direction: 'sales' | 'purchase' = check.rows[0].direction === 'sales' ? 'sales' : 'purchase';

    // Sales-only and purchase-only markers are refused on the wrong side
    // rather than silently dropped: a marker the user thinks they set but that
    // never reaches the JPK is worse than an error.
    const wrongSide = direction === 'sales'
        ? (body.import === true ? 'IMP dotyczy wyłącznie faktur zakupu' : null)
        : (markers.gtu.length || markers.procedures.length ? 'Oznaczenia GTU i procedur dotyczą wyłącznie faktur sprzedaży' : null);
    if (wrongSide) return NextResponse.json({ error: wrongSide }, { status: 400 });

    let docType: string | null;
    try {
        docType = normalizeJpkDocType(body.docType, direction);
    } catch (err) {
        if (err instanceof InvalidJpkMarkerError) return NextResponse.json({ error: err.message }, { status: 400 });
        throw err;
    }
    // Optional extras - only touched when present in the body, so the checkbox
    // panel and the extras form can save independently.
    const extras: string[] = [];
    const extraArgs: unknown[] = [];
    if ('counterpartyCountry' in body) {
        const c = body.counterpartyCountry === '' ? null : body.counterpartyCountry;
        if (c !== null && !isValidCountryCode(c)) return NextResponse.json({ error: 'Nieprawidłowy kod kraju kontrahenta' }, { status: 400 });
        extraArgs.push(c); extras.push(`jpk_counterparty_country = $${extraArgs.length}`);
    }
    if ('marginGross' in body) {
        const raw = body.marginGross;
        const m = raw === '' || raw === null ? null : Number(raw);
        if (m !== null && (!Number.isFinite(m) || m < 0)) return NextResponse.json({ error: 'Wartość marży musi być liczbą nieujemną' }, { status: 400 });
        extraArgs.push(m); extras.push(`jpk_margin_gross = $${extraArgs.length}`);
    }
    if ('saleDate' in body) {
        if (direction !== 'sales') return NextResponse.json({ error: 'Data sprzedaży dotyczy wyłącznie faktur sprzedaży' }, { status: 400 });
        const d = body.saleDate === '' ? null : body.saleDate;
        if (d !== null && !(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))) {
            return NextResponse.json({ error: 'Data sprzedaży: oczekiwano RRRR-MM-DD' }, { status: 400 });
        }
        extraArgs.push(d); extras.push(`delivery_date = $${extraArgs.length}`);
    }

    const isImport = direction === 'purchase' && body.import === true;

    // The marker set is replaced wholesale when any marker key is sent (the
    // preview panel always sends the full set), but a request carrying ONLY the
    // extras must not wipe GTU/procedures/document type it never mentioned.
    const touchesMarkers = ['gtu', 'procedures', 'docType', 'import'].some(k => k in body) || extras.length === 0;
    if (touchesMarkers) {
        await query(
            'UPDATE invoices SET jpk_gtu = $1, jpk_procedures = $2, jpk_doc_type = $3, jpk_import = $4 WHERE id = $5 AND firm_id = $6',
            [markers.gtu, markers.procedures, docType, isImport, id, session.firmId]
        );
    }
    if (extras.length > 0) {
        await query(
            `UPDATE invoices SET ${extras.join(', ')} WHERE id = $${extraArgs.length + 1} AND firm_id = $${extraArgs.length + 2}`,
            [...extraArgs, id, session.firmId]
        );
    }
    await logActivity(
        session.firmId,
        'jpk_markers_updated',
        `Faktura #${id}: GTU [${markers.gtu.join(', ')}], procedury [${markers.procedures.join(', ')}], typ dokumentu ${docType ?? '-'}${isImport ? ', IMP' : ''}`
    );

    return NextResponse.json({ ok: true, ...markers, docType, import: isImport });
}
