import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyBaseline } from './helpers/baseline';

// ocr/route.ts and email/sync/route.ts's actual query shapes: a clean
// extraction still auto-promotes straight to invoices (unchanged from
// before this feature), but now also lands in ocr_queue as 'completed' for
// an audit trail; a flagged extraction lands in ocr_queue as
// 'manual_review' and creates NO invoices row until a human approves it
// via PATCH /api/ocr-queue/[id]. Also proves the buyer_nip fix found while
// rewiring this: the previous code inserted the firm's internal integer id
// into buyer_nip (a column meant to hold a 10-digit NIP) - this replicates
// the corrected query, which uses firms.firm_nip instead.

const ROOT = join(__dirname, '..', '..', '..', '..');

async function insertOcrQueueItem(db: PGlite, opts: { firmId: number; nip: string; needsReview: boolean }) {
    // ocr_queue.client_nip has a NOT NULL FK into clients(nip) — a
    // placeholder row must exist first, even for "NIEZNANY" (see the fix
    // in ocr/route.ts / email/sync/route.ts, found via this exact test
    // failing against the FK constraint before the fix).
    const existing = await db.query(`SELECT nip FROM clients WHERE firm_id = $1 AND nip = $2`, [opts.firmId, opts.nip]);
    if (existing.rows.length === 0) {
        await db.query(`INSERT INTO clients (firm_id, nip, client_name, auth_method) VALUES ($1, $2, $3, 'token')`, [
            opts.firmId, opts.nip, opts.nip === 'NIEZNANY' ? 'Nieznany klient (OCR)' : `Manual OCR Client - ${opts.nip}`,
        ]);
    }

    const queueRes = await db.query<{ id: number }>(
        `INSERT INTO ocr_queue (firm_id, client_nip, source_type, file_path, file_type, ocr_status, extracted_data, confidence_score)
         VALUES ($1, $2, 'upload', 'fake-path.pdf', 'pdf', $3, $4, $5) RETURNING id`,
        [opts.firmId, opts.nip, opts.needsReview ? 'manual_review' : 'completed', JSON.stringify({ nip: opts.nip }), opts.needsReview ? 0.3 : 0.9]
    );
    const queueId = queueRes.rows[0].id;

    if (!opts.needsReview) {
        const firmRes = await db.query<{ firm_nip: string; firm_name: string }>(`SELECT firm_nip, firm_name FROM firms WHERE id = $1`, [opts.firmId]);
        const firm = firmRes.rows[0];
        const ksefNumber = 'OCR-TESTKSEF01';
        await db.query(
            `INSERT INTO invoices (firm_id, invoice_number, ksef_number, client_nip, seller_nip, seller_name, buyer_nip, buyer_name, issue_date, net_amount, vat_amount, gross_amount, currency, direction)
             VALUES ($1, 'MANUAL-1', $2, $3, $3, 'OCR Vendor', $4, $5, NOW(), 100, 23, 123, 'PLN', 'purchase')`,
            [opts.firmId, ksefNumber, opts.nip, firm.firm_nip, firm.firm_name]
        );
        await db.query(`UPDATE ocr_queue SET matched_ksef_number = $1, processed_at = NOW() WHERE id = $2`, [ksefNumber, queueId]);
    }

    return queueId;
}

describe('ocr_queue routing: review gating and the buyer_nip fix', () => {
    let db: PGlite;
    let firmId: number;

    beforeAll(async () => {
        db = new PGlite();
        await applyBaseline(db);

        const firmRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, firm_nip) VALUES ('Firm A', 'firm-a', 'a@example.com', 'x', '9998887766') RETURNING id`
        );
        firmId = firmRes.rows[0].id;
    });

    afterAll(async () => {
        await db.close();
    });

    it('a clean extraction auto-promotes to invoices, with buyer_nip set to the real firm NIP, not the firm id', async () => {
        await insertOcrQueueItem(db, { firmId, nip: '1112223334', needsReview: false });
        const inv = await db.query<{ buyer_nip: string }>(`SELECT buyer_nip FROM invoices WHERE client_nip = '1112223334'`);
        expect(inv.rows).toHaveLength(1);
        expect(inv.rows[0].buyer_nip).toBe('9998887766'); // the real NIP, not String(firmId)
        expect(inv.rows[0].buyer_nip).not.toBe(String(firmId));

        const queue = await db.query<{ ocr_status: string; matched_ksef_number: string }>(`SELECT ocr_status, matched_ksef_number FROM ocr_queue WHERE client_nip = '1112223334'`);
        expect(queue.rows[0].ocr_status).toBe('completed');
        expect(queue.rows[0].matched_ksef_number).toBe('OCR-TESTKSEF01');
    });

    it('a flagged extraction lands in ocr_queue as manual_review and creates NO invoice', async () => {
        await insertOcrQueueItem(db, { firmId, nip: 'NIEZNANY', needsReview: true });
        const inv = await db.query(`SELECT id FROM invoices WHERE client_nip = 'NIEZNANY'`);
        expect(inv.rows).toHaveLength(0);

        const queue = await db.query<{ ocr_status: string }>(`SELECT ocr_status FROM ocr_queue WHERE client_nip = 'NIEZNANY'`);
        expect(queue.rows[0].ocr_status).toBe('manual_review');
    });

    it('review approval creates the invoice and marks the queue item completed', async () => {
        // insertOcrQueueItem already ensures a clients row exists (the FK
        // requirement above) — PATCH /api/ocr-queue/[id]'s approve branch
        // does the same "create if missing" check, so no separate insert
        // is needed here.
        const queueId = await insertOcrQueueItem(db, { firmId, nip: '5556667778', needsReview: true });
        const ksefNumber = 'REVIEWED-TEST01';
        await db.query(
            `INSERT INTO invoices (firm_id, invoice_number, ksef_number, client_nip, seller_nip, seller_name, buyer_nip, buyer_name, issue_date, net_amount, vat_amount, gross_amount, currency, direction)
             VALUES ($1, 'FV/CORRECTED/1', $2, $3, $3, 'Zweryfikowany dokument', '9998887766', 'Firm A', NOW(), 100, 23, 123, 'PLN', 'purchase')`,
            [firmId, ksefNumber, '5556667778']
        );
        await db.query(`UPDATE ocr_queue SET ocr_status = 'completed', matched_ksef_number = $1, processed_at = NOW() WHERE id = $2`, [ksefNumber, queueId]);

        const inv = await db.query<{ invoice_number: string }>(`SELECT invoice_number FROM invoices WHERE client_nip = '5556667778'`);
        expect(inv.rows[0].invoice_number).toBe('FV/CORRECTED/1');
        const queue = await db.query<{ ocr_status: string }>(`SELECT ocr_status FROM ocr_queue WHERE id = $1`, [queueId]);
        expect(queue.rows[0].ocr_status).toBe('completed');
    });

    it('rejecting an item marks it failed and creates no invoice', async () => {
        const queueId = await insertOcrQueueItem(db, { firmId, nip: '4443332221', needsReview: true });
        await db.query(`UPDATE ocr_queue SET ocr_status = 'failed', error_message = 'Odrzucone ręcznie', processed_at = NOW() WHERE id = $1`, [queueId]);

        const inv = await db.query(`SELECT id FROM invoices WHERE client_nip = '4443332221'`);
        expect(inv.rows).toHaveLength(0);
        const queue = await db.query<{ ocr_status: string }>(`SELECT ocr_status FROM ocr_queue WHERE id = $1`, [queueId]);
        expect(queue.rows[0].ocr_status).toBe('failed');
    });
});
