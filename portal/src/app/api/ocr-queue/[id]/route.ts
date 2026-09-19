import { NextResponse } from 'next/server';
import { requireActiveSubscription } from '@/lib/entitlements';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { ClientLimitReachedError, createClientWithinPlan } from '@/lib/client-cap';

// Approve (create the invoice from the reviewer's — possibly corrected —
// fields) or reject (discard without ever touching invoices) a queued OCR/
// email/tokened-upload item. This is the human step that was always
// missing: every ingestion path used to write straight into invoices with
// no review at all.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const planError = await requireActiveSubscription(session.firmId);
    if (planError) return planError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    if (action === 'approve') {
        const { nip, invoiceNumber, netAmount, vatAmount, grossAmount, direction } = body;
        if (!nip || !/^\d{10}$/.test(nip)) {
            return NextResponse.json({ error: 'NIP musi mieć 10 cyfr' }, { status: 400 });
        }
        if (!invoiceNumber?.trim()) {
            return NextResponse.json({ error: 'Podaj numer faktury' }, { status: 400 });
        }
        const dir = direction === 'sales' ? 'sales' : 'purchase';

        // Atomic claim (round 11 fix): the old code SELECTed ocr_status, checked
        // it wasn't already terminal, then only much later — after a client
        // lookup, a firm lookup, and an invoice INSERT — wrote the terminal
        // status back. Two concurrent PATCH approve requests for the same id
        // (double-click, or a client retry after a slow response) both pass
        // the early check before either write lands, so both proceed to
        // INSERT their own invoice — same document booked twice, corrupting
        // revenue/JPK totals. This UPDATE...WHERE...RETURNING claims the row
        // in one round trip; only the request that actually flips the status
        // proceeds to create an invoice.
        const claim = await query(
            `UPDATE ocr_queue SET ocr_status = 'processing'
             WHERE id = $1 AND firm_id = $2 AND ocr_status NOT IN ('completed', 'failed', 'processing')
             RETURNING id`,
            [id, session.firmId]
        );
        if (claim.rows.length === 0) {
            const exists = await query('SELECT id FROM ocr_queue WHERE id = $1 AND firm_id = $2', [id, session.firmId]);
            if (!exists.rows[0]) return NextResponse.json({ error: 'Nie znaleziono' }, { status: 404 });
            return NextResponse.json({ error: 'Ten wpis został już przetworzony' }, { status: 409 });
        }

        const net = Number(netAmount);
        const vat = Number(vatAmount);
        const gross = Number(grossAmount);
        if (![net, vat, gross].every(Number.isFinite) || net < 0 || vat < 0 || gross < 0 || Math.abs(net + vat - gross) > 0.01) {
            await query(`UPDATE ocr_queue SET ocr_status = 'manual_review' WHERE id = $1`, [id]);
            return NextResponse.json({ error: 'Kwoty faktury muszą być nieujemne i spełniać netto + VAT = brutto' }, { status: 400 });
        }

        try {
            await createClientWithinPlan(session.firmId, {
                nip,
                clientName: `Klient z weryfikacji OCR - ${nip}`,
            });

            const firmRes = await query('SELECT firm_nip, firm_name FROM firms WHERE id = $1', [session.firmId]);
            const firm = firmRes.rows[0];
            await query(
                `INSERT INTO invoices (
                    firm_id, invoice_number, client_nip, seller_nip, seller_name, buyer_nip, buyer_name,
                    issue_date, net_amount, vat_amount, gross_amount, currency, direction
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, 'PLN', $11)`,
                [
                    session.firmId, invoiceNumber.trim(), nip, nip, 'Zweryfikowany dokument',
                    firm?.firm_nip || null, firm?.firm_name || 'My Firm',
                    net, vat, gross, dir,
                ]
            );

            await query(`UPDATE ocr_queue SET ocr_status = 'completed', processed_at = NOW() WHERE id = $1`, [id]);
            await logActivity(session.firmId, 'ocr_approved', `Zatwierdzono zeskanowany dokument #${id} jako fakturę ${invoiceNumber}`);

            return NextResponse.json({ ok: true });
        } catch (e) {
            // Release the claim so the item isn't stuck in 'processing'
            // forever if the invoice insert (or anything after the claim)
            // fails — it goes back to needing review, not silently lost.
            await query(`UPDATE ocr_queue SET ocr_status = 'manual_review' WHERE id = $1`, [id]).catch(() => {});
            if (e instanceof ClientLimitReachedError) {
                return NextResponse.json({ error: e.message }, { status: 403 });
            }
            throw e;
        }
    }

    if (action !== 'reject') {
        return NextResponse.json({ error: 'Nieprawidłowa akcja' }, { status: 400 });
    }

    // Same atomic claim as approve, single-step since there's no further
    // work after it.
    const claim = await query(
        `UPDATE ocr_queue SET ocr_status = 'failed', error_message = 'Odrzucone ręcznie', processed_at = NOW()
         WHERE id = $1 AND firm_id = $2 AND ocr_status NOT IN ('completed', 'failed', 'processing')
         RETURNING id`,
        [id, session.firmId]
    );
    if (claim.rows.length > 0) {
        await logActivity(session.firmId, 'ocr_rejected', `Odrzucono zeskanowany dokument #${id}`);
        return NextResponse.json({ ok: true });
    }
    const exists = await query('SELECT id FROM ocr_queue WHERE id = $1 AND firm_id = $2', [id, session.firmId]);
    if (!exists.rows[0]) return NextResponse.json({ error: 'Nie znaleziono' }, { status: 404 });
    return NextResponse.json({ error: 'Ten wpis został już przetworzony' }, { status: 409 });
}
