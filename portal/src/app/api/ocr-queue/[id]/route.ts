import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';

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

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    const check = await query('SELECT id, ocr_status FROM ocr_queue WHERE id = $1 AND firm_id = $2', [id, session.firmId]);
    const item = check.rows[0];
    if (!item) return NextResponse.json({ error: 'Nie znaleziono' }, { status: 404 });
    if (item.ocr_status === 'completed' || item.ocr_status === 'failed') {
        return NextResponse.json({ error: 'Ten wpis został już przetworzony' }, { status: 409 });
    }

    if (action === 'reject') {
        await query(`UPDATE ocr_queue SET ocr_status = 'failed', error_message = 'Odrzucone ręcznie', processed_at = NOW() WHERE id = $1`, [id]);
        await logActivity(session.firmId, 'ocr_rejected', `Odrzucono zeskanowany dokument #${id}`);
        return NextResponse.json({ ok: true });
    }

    if (action === 'approve') {
        const { nip, invoiceNumber, netAmount, vatAmount, grossAmount, direction } = body;
        if (!nip || !/^\d{10}$/.test(nip)) {
            return NextResponse.json({ error: 'NIP musi mieć 10 cyfr' }, { status: 400 });
        }
        if (!invoiceNumber?.trim()) {
            return NextResponse.json({ error: 'Podaj numer faktury' }, { status: 400 });
        }
        const dir = direction === 'sales' ? 'sales' : 'purchase';

        const clientRes = await query('SELECT nip FROM clients WHERE firm_id = $1 AND nip = $2', [session.firmId, nip]);
        if (clientRes.rows.length === 0) {
            // auth_method is NOT NULL with no default — see ocr/route.ts's
            // identical comment on this same pattern.
            await query('INSERT INTO clients (firm_id, nip, client_name, auth_method) VALUES ($1, $2, $3, $4)', [session.firmId, nip, `Klient z weryfikacji OCR - ${nip}`, 'token']);
        }

        const firmRes = await query('SELECT firm_nip, firm_name FROM firms WHERE id = $1', [session.firmId]);
        const firm = firmRes.rows[0];
        const ksefNumber = `REVIEWED-${Math.random().toString(36).substr(2, 10).toUpperCase()}`;

        await query(
            `INSERT INTO invoices (
                firm_id, invoice_number, ksef_number, client_nip, seller_nip, seller_name, buyer_nip, buyer_name,
                issue_date, net_amount, vat_amount, gross_amount, currency, direction
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, 'PLN', $12)`,
            [
                session.firmId, invoiceNumber.trim(), ksefNumber, nip, nip, 'Zweryfikowany dokument',
                firm?.firm_nip || null, firm?.firm_name || 'My Firm',
                Number(netAmount) || 0, Number(vatAmount) || 0, Number(grossAmount) || 0, dir,
            ]
        );

        await query(`UPDATE ocr_queue SET ocr_status = 'completed', matched_ksef_number = $1, processed_at = NOW() WHERE id = $2`, [ksefNumber, id]);
        await logActivity(session.firmId, 'ocr_approved', `Zatwierdzono zeskanowany dokument #${id} jako fakturę ${invoiceNumber}`);

        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Nieprawidłowa akcja' }, { status: 400 });
}
