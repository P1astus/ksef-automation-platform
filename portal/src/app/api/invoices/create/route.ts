import { NextResponse } from 'next/server';
import { requireFeature } from '@/lib/entitlements';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { buildKSeFInvoiceXml, computeReportedTotals, isFa3Nip } from '@/lib/ksef-invoice-builder';
import type { InvoiceLine, ExemptionBasis } from '@/lib/ksef-invoice-builder';
import { normalizeJpkMarkers, InvalidJpkMarkerError, type JpkMarkers } from '@/lib/jpk-markers';

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const planError = await requireFeature(session.firmId, 'invoice_issuance');
    if (planError) return planError;

    const body = await request.json().catch(() => ({}));
    const {
        clientId, invoiceNumber, issueDate, deliveryDate, dueDate, buyerNip, buyerName,
        buyerStreet, buyerCity, buyerPostalCode, buyerCountryCode,
        lines, offlineMode, correctingInvoiceId, correctionReason, exemptionBasis,
        jpkGtu, jpkProcedures,
    } = body;

    if (!clientId || !invoiceNumber || !issueDate || !buyerNip || !buyerName || !lines?.length) {
        return NextResponse.json({ error: 'Brakujące dane faktury' }, { status: 400 });
    }
    if (!buyerStreet?.trim() || !buyerCity?.trim() || !buyerPostalCode?.trim()) {
        return NextResponse.json({ error: 'Adres nabywcy (ulica, kod pocztowy, miasto) jest wymagany przez schemat FA(3)' }, { status: 400 });
    }
    // The UI removes separators while typing, but this endpoint is also an
    // API boundary. FA(3)'s Podmiot2/NIP is not a free-text field: persisting
    // an arbitrary string here produced raw_xml that KSeF rejected later.
    const normalizedBuyerNip = typeof buyerNip === 'string' ? buyerNip.replace(/[-\s]/g, '') : '';
    if (!isFa3Nip(normalizedBuyerNip)) {
        return NextResponse.json({ error: 'NIP nabywcy musi mieć 10 cyfr zgodnych ze schematem FA(3)' }, { status: 400 });
    }
    // Checked here, not just left to buildKSeFInvoiceXml's VAT_GROUP_FIELD
    // lookup, so an unrecognized rate (e.g. a stale client sending the
    // removed 'oo' domestic-reverse-charge rate - see VatRateCode's doc
    // comment) returns a clean 400 instead of an uncaught TypeError/500.
    const VALID_VAT_RATES = ['23', '8', '5', '0', '0-wdt', '0-export', 'zw'];
    const invalidRate = (lines as InvoiceLine[]).find(l => !VALID_VAT_RATES.includes(l.vatRate));
    if (invalidRate) {
        return NextResponse.json({ error: `Nieprawidłowa stawka VAT: ${invalidRate.vatRate}` }, { status: 400 });
    }
    if (correctingInvoiceId && !correctionReason?.trim()) {
        return NextResponse.json({ error: 'Podaj powód korekty' }, { status: 400 });
    }
    // FA(3)'s Zwolnienie annotation requires a cited legal basis whenever any
    // line is 'zw' - checked here (not just left to buildKSeFInvoiceXml's own
    // guard) so the error names what to fix instead of surfacing as a
    // generic 500 further down.
    const hasExemptLine = (lines as InvoiceLine[]).some(l => l.vatRate === 'zw');
    if (hasExemptLine && !exemptionBasis?.text?.trim()) {
        return NextResponse.json({ error: 'Faktura zawiera pozycję zwolnioną z VAT (zw.) - podaj podstawę prawną zwolnienia' }, { status: 400 });
    }

    let jpkMarkers: JpkMarkers;
    try {
        jpkMarkers = normalizeJpkMarkers({ gtu: jpkGtu, procedures: jpkProcedures });
    } catch (err) {
        if (err instanceof InvalidJpkMarkerError) return NextResponse.json({ error: err.message }, { status: 400 });
        throw err;
    }

    const OFFLINE_MODES = ['offline24', 'unavailability', 'emergency', 'total_outage'];
    if (offlineMode !== undefined && offlineMode !== null && !OFFLINE_MODES.includes(offlineMode)) {
        return NextResponse.json({ error: `Nieprawidłowy tryb offline: ${offlineMode}` }, { status: 400 });
    }

    // Verify client belongs to firm + get seller NIP + address
    const clientRes = await query(
        'SELECT id, nip, client_name, street, city, postal_code FROM clients WHERE id = $1 AND firm_id = $2',
        [clientId, session.firmId]
    );
    if (!clientRes.rows[0]) return NextResponse.json({ error: 'Klient nie znaleziony' }, { status: 404 });
    const client = clientRes.rows[0];
    // Seller is this client (the taxpayer whose invoices get issued through
    // this platform) - FA(3) rejects an empty AdresL1/AdresL2 just as much
    // for the seller as for the buyer, so this has to be checked here rather
    // than left to buildKSeFInvoiceXml's own guard to surface as a generic 500.
    if (!client.street?.trim() || !client.city?.trim() || !client.postal_code?.trim()) {
        return NextResponse.json({
            error: `Brak adresu klienta "${client.client_name}" - uzupełnij go w karcie klienta przed wystawieniem faktury`,
        }, { status: 400 });
    }

    // Validate the calendar lookup before creating the invoice. If the
    // business-day calendar has not been extended, an offline invoice must
    // fail as a whole rather than leave an unmonitored invoice behind.
    if (offlineMode) {
        try {
            await query('SELECT next_business_day($1::date)', [issueDate]);
        } catch {
            return NextResponse.json({ error: 'Nie można wyznaczyć terminu offline — kalendarz dni roboczych wymaga aktualizacji' }, { status: 503 });
        }
    }

    // Also get firm data for seller info
    const firmRes = await query('SELECT firm_name FROM firms WHERE id = $1', [session.firmId]);
    const firmName = firmRes.rows[0]?.firm_name || '';

    // Correction invoice (faktura korygująca): fetch the original, ownership-
    // checked the same way as every other route (i.firm_id = session.firmId,
    // not a client_nip join). A correction can only reference an invoice
    // that was actually sent - both because "correcting" something never
    // filed makes no sense, and because the XML needs the original's real
    // ksef_number for DaneFaKorygowanej.
    let correction: { reason: string; originalInvoiceNumber: string; originalIssueDate: string; originalKsefNumber: string; originalLines: InvoiceLine[] } | undefined;
    if (correctingInvoiceId) {
        const origRes = await query(
            `SELECT invoice_number, issue_date, ksef_number, invoice_lines
             FROM invoices WHERE id = $1 AND firm_id = $2`,
            [correctingInvoiceId, session.firmId]
        );
        const original = origRes.rows[0];
        if (!original) return NextResponse.json({ error: 'Nie znaleziono korygowanej faktury' }, { status: 404 });
        if (!original.ksef_number) {
            return NextResponse.json({ error: 'Nie można korygować faktury, która nie została wysłana do KSeF' }, { status: 400 });
        }
        if (!original.invoice_lines) {
            return NextResponse.json({ error: 'Brak zapisanych pozycji oryginalnej faktury — nie można obliczyć korekty' }, { status: 400 });
        }
        correction = {
            reason: correctionReason.trim(),
            originalInvoiceNumber: original.invoice_number,
            // pg returns a DATE column as a JS Date object, not a string —
            // String(dateObject) gives Date.prototype.toString()'s locale
            // format ("Mon Sep 14 2026 ..."), not an ISO date. new Date(...)
            // normalizes both a Date object and an ISO string to the same
            // thing before formatting.
            originalIssueDate: new Date(original.issue_date).toISOString().slice(0, 10),
            originalKsefNumber: original.ksef_number,
            originalLines: original.invoice_lines as InvoiceLine[],
        };
    }

    // Build XML
    const xml = buildKSeFInvoiceXml({
        invoiceNumber,
        issueDate,
        dueDate: dueDate || undefined,
        seller: { nip: client.nip, name: client.client_name || firmName, street: client.street, city: client.city, postCode: client.postal_code },
        buyer: { nip: normalizedBuyerNip, name: buyerName, street: buyerStreet, city: buyerCity, postCode: buyerPostalCode, countryCode: buyerCountryCode || 'PL' },
        lines: lines as InvoiceLine[],
        correction,
        exemptionBasis: exemptionBasis as ExemptionBasis | undefined,
    });

    // Recomputed from `lines` server-side (round 11 fix) — never trust a
    // client-supplied totals object, since raw_xml below is built
    // independently from `lines` and the two must never disagree. Uses the
    // same delta math as the XML itself for a correction invoice.
    const totals = computeReportedTotals(
        lines as InvoiceLine[],
        correction ? { originalLines: correction.originalLines } : undefined
    );

    // Insert invoice record
    const insertRes = await query(
        `INSERT INTO invoices
         (firm_id, client_nip, invoice_number, seller_name, seller_nip, buyer_name, buyer_nip,
          buyer_street, buyer_city, buyer_postal_code,
          net_amount, vat_amount, gross_amount, issue_date, delivery_date, due_date,
          direction, processing_status, invoice_lines, raw_xml,
          corrects_invoice_id, correction_reason, jpk_gtu, jpk_procedures)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'sales','new',$17,$18,$19,$20,$21,$22)
         RETURNING id`,
        [
            session.firmId,
            client.nip,
            invoiceNumber,
            client.client_name || firmName,
            client.nip,
            buyerName,
            normalizedBuyerNip,
            buyerStreet.trim(),
            buyerCity.trim(),
            buyerPostalCode.trim(),
            totals.totalNet,
            totals.totalVat,
            totals.totalGross,
            issueDate,
            deliveryDate || issueDate,
            dueDate || null,
            JSON.stringify(lines),
            xml,
            correctingInvoiceId || null,
            correction?.reason || null,
            jpkMarkers.gtu,
            jpkMarkers.procedures,
        ]
    );

    const invoiceId = insertRes.rows[0]?.id;
    await logActivity(session.firmId, 'invoice_created', `Wystawiono fakturę: ${invoiceNumber} dla ${buyerName}`);

    // Offline24: the invoice is issued now but KSeF wasn't reachable, so the
    // compliance clock (upload_deadline, escalating alerts) starts here. The
    // deadline is the end of the next business day after issueDate - per
    // CLAUDE.md's rule, computed via next_business_day(), never ad-hoc JS
    // date math, since it has to account for weekends and Polish holidays
    // (business_days table). offline_invoices is what
    // 05-offline24-monitor.json exclusively queries; invoice_id links back
    // here so the offline queue can display real invoice data without
    // duplicating it onto offline_invoices itself.
    if (offlineMode) {
        await query(
            `INSERT INTO offline_invoices
             (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline, invoice_id)
             VALUES ($1, $2, $3, $4, NOW(), (next_business_day($5::date) + INTERVAL '1 day' - INTERVAL '1 second'), $6)`,
            [session.firmId, client.nip, invoiceNumber, offlineMode, issueDate, invoiceId]
        );
    }

    return NextResponse.json({ id: invoiceId, ok: true });
}
