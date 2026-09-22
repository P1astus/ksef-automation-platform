import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '../jobs/types';

const sendMail = vi.fn(async () => undefined);
const generateJpkV7M = vi.fn(() => '<JPK/>');
const determineJpkStatus = vi.fn(() => 'correction_needed');

vi.mock('../mail-transport', () => ({ sendMail }));
vi.mock('../jpk-generator', () => ({ generateJpkV7M, determineJpkStatus }));

const client = {
    client_id: 17, firm_id: 4, client_nip: '1234567890', client_name: 'Klient A', tax_office_code: '1471',
    contact_email: 'client@example.com', taxpayer_type: 'company', first_name: null, last_name: null,
    birth_date: null, firm_name: 'Biuro', accountant_email: 'accountant@example.com',
};
const invoice = {
    id: 9, invoice_number: 'FV;"9"', issue_date: '2026-08-15', seller_name: 'S', seller_nip: '1234567890',
    buyer_name: 'B', buyer_nip: '9999999999', net_amount: '100', vat_amount: '23', gross_amount: '123',
    direction: 'sales', jpk_marker: 'BFK', ksef_number: null,
};

function context(shadow = false): JobContext & { query: ReturnType<typeof vi.fn> } {
    const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT DISTINCT')) return { rows: [client] };
        if (sql.includes('FROM invoices i')) return { rows: [invoice] };
        return { rows: [{ id: 1 }] };
    });
    return {
        db: { query }, query,
        now: () => new Date('2026-09-05T06:00:00.000Z'),
        shadow,
        signal: new AbortController().signal,
        alerts: { raise: vi.fn(async () => ({ recorded: true, delivered: true })) },
        log: vi.fn(),
    };
}

describe('jpk-preparation job', () => {
    beforeEach(() => {
        sendMail.mockReset();
        generateJpkV7M.mockReset().mockReturnValue('<JPK/>');
        determineJpkStatus.mockReset().mockReturnValue('correction_needed');
    });

    it('runs at 08:00 Warsaw on the fifth and prepares the previous month', async () => {
        const { jpkPreparationJob } = await import('../jobs/jpk-preparation');
        expect(jpkPreparationJob.schedule).toEqual({ kind: 'cron', expr: '0 8 5 * *', timezone: 'Europe/Warsaw' });
        expect(jpkPreparationJob.lookbackMinutes).toBeLessThanOrEqual(2880);
        const ctx = context();
        await jpkPreparationJob.run(ctx);
        expect(ctx.query.mock.calls[0][1]).toEqual(['2026-08', '2026-08-01', '2026-08-31']);
    });

    it('uses the scheduled period when a fifth-day occurrence catches up on the sixth', async () => {
        const { jpkPreparationJob } = await import('../jobs/jpk-preparation');
        const ctx = context();
        ctx.now = () => new Date('2026-09-06T06:00:00Z');
        Object.assign(ctx, { scheduledFor: new Date('2026-09-05T06:00:00Z') });
        await jpkPreparationJob.run(ctx);
        expect(ctx.query.mock.calls[0][1]).toEqual(['2026-08', '2026-08-01', '2026-08-31']);
    });

    it('upserts the generated JPK and emails the accountant with the CSV actually attached', async () => {
        const { jpkPreparationJob } = await import('../jobs/jpk-preparation');
        const ctx = context();
        const result = await jpkPreparationJob.run(ctx);

        expect(generateJpkV7M).toHaveBeenCalledOnce();
        expect(determineJpkStatus).toHaveBeenCalledWith([invoice]);
        const upsert = ctx.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO jpk_preparations'));
        expect(upsert?.[1]).toEqual([4, '1234567890', '2026-08', '<JPK/>', 'correction_needed', 1, 0, 0, 1, 0]);
        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'accountant@example.com',
            attachments: [expect.objectContaining({ filename: 'JPK_VAT_1234567890_2026-08.csv', contentType: 'text/csv; charset=utf-8' })],
        }));
        const message = (sendMail.mock.calls as any[][])[0][0];
        const csv = message.attachments[0].content.toString();
        expect(csv).toContain('Numer_faktury;Data;');
        expect(csv).toContain('"FV;""9"""');
        const audit = ctx.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_log'));
        expect(audit?.[1]).toEqual([
            4, '1234567890', 'jpk_vat_preparation', 'KSeF - JPK_VAT Preparation',
            { period: '2026-08', client_id: 17, status: 'correction_needed', stats: { total: 1, nrksef: 0, off: 0, bfk: 1, di: 0 }, financials: { totalNet: '100.00', totalVat: '23.00', totalGross: '123.00' } },
            true, null,
        ]);
        expect(result).toMatchObject({ processed: 1, failures: [] });
    });

    it('computes in shadow mode but writes no preparation row and sends no mail', async () => {
        const { jpkPreparationJob } = await import('../jobs/jpk-preparation');
        const ctx = context(true);
        const result = await jpkPreparationJob.run(ctx);
        expect(generateJpkV7M).toHaveBeenCalledOnce();
        expect(ctx.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO jpk_preparations'))).toBe(false);
        expect(ctx.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_log'))).toBe(false);
        expect(sendMail).not.toHaveBeenCalled();
        expect(result).toMatchObject({ processed: 1, skipped: 1, failures: [] });
    });

    it('reports one client failure and continues with the rest of the batch', async () => {
        const ctx = context();
        ctx.query.mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT DISTINCT')) return { rows: [client, { ...client, client_nip: '2222222222', client_name: 'Klient B' }] };
            if (sql.includes('FROM invoices i')) return { rows: [invoice] };
            return { rows: [{ id: 1 }] };
        });
        sendMail.mockRejectedValueOnce(new Error('smtp down'));
        const { jpkPreparationJob } = await import('../jobs/jpk-preparation');
        const result = await jpkPreparationJob.run(ctx);
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(result.processed).toBe(1);
        expect(result.failures).toEqual([{ subject: 'JPK preparation for Klient A (1234567890)', error: 'smtp down', firmId: 4, clientNip: '1234567890' }]);
        const audits = ctx.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO audit_log'));
        expect(audits).toHaveLength(2);
        expect(audits[0][1]).toEqual([4, '1234567890', 'jpk_vat_preparation', 'KSeF - JPK_VAT Preparation', { period: '2026-08', client_id: 17, status: 'failed', error: 'smtp down' }, false, 'smtp down']);
        expect(audits[1][1]?.[4]).toMatchObject({ period: '2026-08', client_id: 17, status: 'correction_needed' });
    });

    it('honours an already-aborted signal before querying', async () => {
        const ctx = context();
        const controller = new AbortController();
        controller.abort(new Error('stopped'));
        ctx.signal = controller.signal;
        const { jpkPreparationJob } = await import('../jobs/jpk-preparation');
        await expect(jpkPreparationJob.run(ctx)).rejects.toThrow('stopped');
        expect(ctx.query).not.toHaveBeenCalled();
    });
});
