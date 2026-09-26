import { beforeEach, describe, expect, it, vi } from 'vitest';

// Firm names, client names, request messages, invoice numbers and KSeF error
// text are user- or counterparty-controlled. They must reach e-mail HTML as
// text, and spreadsheet cells as data, never as markup or formulas.

const sendMail = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../mail-transport', () => ({ sendMail }));
vi.mock('@/lib/mail-transport', () => ({ sendMail }));

const MARKUP = '<a href="https://attacker.example/">Zaloguj</a><img src=x onerror=alert(1)>';

function lastHtml(): string {
    const calls = sendMail.mock.calls as unknown as Array<[{ html: string }]>;
    return calls[calls.length - 1][0].html;
}

function expectInert(html: string) {
    expect(html).not.toContain('<a href="https://attacker.example/"');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;a href=&quot;https://attacker.example/&quot;&gt;');
}

describe('e-mail templates escape interpolated text', () => {
    beforeEach(() => sendMail.mockClear());

    it('team invite: firm name', async () => {
        const { sendTeamInvite } = await import('../email');
        await sendTeamInvite('m@example.test', MARKUP, 'https://portal.example/invite/accept?token=a&b=1');
        expectInert(lastHtml());
        expect(lastHtml()).toContain('href="https://portal.example/invite/accept?token=a&amp;b=1"');
    });

    it('welcome, trial expiry and daily digest: firm name', async () => {
        const { sendWelcome, sendTrialExpiry, sendDailyDigest } = await import('../email');
        await sendWelcome('o@example.test', MARKUP);
        expectInert(lastHtml());
        await sendTrialExpiry('o@example.test', MARKUP, 3);
        expectInert(lastHtml());
        await sendDailyDigest('o@example.test', MARKUP, { invoicesYesterday: 1, clientsSynced: 1, errors: 0, totalInvoices: 2 });
        expectInert(lastHtml());
    });

    it('sync failure: client name and error text', async () => {
        const { sendSyncFailed } = await import('../email');
        await sendSyncFailed('o@example.test', 'Biuro', MARKUP, MARKUP);
        expectInert(lastHtml());
    });

    it('document request: client name, firm name and free-text message', async () => {
        const { sendDocumentRequest } = await import('../email');
        await sendDocumentRequest('c@example.test', MARKUP, MARKUP, 'https://portal.example/upload/t', MARKUP, '2026-10-01T00:00:00Z');
        expectInert(lastHtml());
    });

    it('client notifications: client name and invoice numbers', async () => {
        const { sendOffline24Warning, sendReceivablesDigest } = await import('../email');
        await sendOffline24Warning('c@example.test', MARKUP, MARKUP, '2026-10-01T10:00:00Z', 'overdue');
        expectInert(lastHtml());
        await sendReceivablesDigest('c@example.test', MARKUP, [{ invoice_number: MARKUP, gross_amount: '10', due_date: '2026-09-01' }]);
        expectInert(lastHtml());
    });
});

describe('spreadsheet formula neutralisation', () => {
    it('prefixes text cells that a spreadsheet would evaluate, and leaves numbers alone', async () => {
        const { neutralizeSpreadsheetFormula } = await import('../text-safety');
        expect(neutralizeSpreadsheetFormula('=HYPERLINK("https://x","y")')).toBe(`'=HYPERLINK("https://x","y")`);
        expect(neutralizeSpreadsheetFormula('+48 cmd')).toBe(`'+48 cmd`);
        expect(neutralizeSpreadsheetFormula('-2+3')).toBe(`'-2+3`);
        expect(neutralizeSpreadsheetFormula('@SUM(A1)')).toBe(`'@SUM(A1)`);
        expect(neutralizeSpreadsheetFormula('\t=1')).toBe(`'\t=1`);
        expect(neutralizeSpreadsheetFormula('-12.50')).toBe('-12.50');
        expect(neutralizeSpreadsheetFormula('123.00')).toBe('123.00');
        expect(neutralizeSpreadsheetFormula('FV/1/2026')).toBe('FV/1/2026');
        expect(neutralizeSpreadsheetFormula('')).toBe('');
    });
});

describe('jpk-preparation e-mail', () => {
    it('escapes the client name in the HTML body and neutralises formula cells in the CSV attachment', async () => {
        vi.resetModules();
        vi.doMock('../jpk-generator', () => ({ generateJpkV7M: () => '<JPK/>', determineJpkStatus: () => 'ready' }));
        sendMail.mockClear();
        const client = {
            client_id: 1, firm_id: 2, client_nip: '1234567890', client_name: MARKUP, tax_office_code: '1471',
            contact_email: 'client@example.com', taxpayer_type: 'company', first_name: null, last_name: null,
            birth_date: null, firm_name: 'Biuro', accountant_email: 'accountant@example.com',
        };
        const invoice = {
            id: 9, invoice_number: '=HYPERLINK("https://attacker.example","FV")', issue_date: '2026-08-15', seller_name: 'S',
            seller_nip: '1234567890', buyer_name: 'B', buyer_nip: '9999999999', net_amount: '-100', vat_amount: '-23',
            gross_amount: '-123', direction: 'sales', jpk_marker: null, ksef_number: '1234567890-20260815-0123456789AB-CD',
        };
        const query = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT DISTINCT')) return { rows: [client] };
            if (sql.includes('FROM invoices i')) return { rows: [invoice] };
            return { rows: [{ id: 1 }] };
        });
        const { jpkPreparationJob } = await import('../jobs/jpk-preparation');
        await jpkPreparationJob.run({
            db: { query }, now: () => new Date('2026-09-05T06:00:00Z'), shadow: false,
            signal: new AbortController().signal,
            alerts: { raise: vi.fn(async () => ({ recorded: true, delivered: true })) }, log: vi.fn(),
        } as any);
        const message = (sendMail.mock.calls as any[][])[0][0];
        expectInert(message.html);
        const csv: string = message.attachments[0].content.toString();
        expect(csv).toContain(`"'=HYPERLINK(""https://attacker.example"",""FV"")"`);
        expect(csv).toContain(';-100.00;-23.00;-123.00;');
    });
});

describe('POST /api/export (csv)', () => {
    it('neutralises formula cells from counterparty-controlled fields but keeps negative amounts numeric', async () => {
        vi.resetModules();
        const rows = [{
            id: 1, issue_date: '2026-08-15', invoice_number: '@SUM(1+1)*cmd', ksef_number: null, client_nip: '1234567890',
            seller_name: '=HYPERLINK("https://attacker.example","Dostawca")', seller_nip: '1234567890',
            buyer_name: 'Biuro', buyer_nip: '9999999999', direction: 'purchase',
            net_amount: '-100', vat_amount: '-23', gross_amount: '-123', currency: 'PLN',
        }];
        vi.doMock('@/lib/auth', () => ({ getSession: async () => ({ firmId: 5, role: 'owner' }) }));
        vi.doMock('@/lib/entitlements', () => ({ requireReadFeature: async () => null }));
        vi.doMock('@/lib/activity', () => ({ logActivity: async () => undefined }));
        vi.doMock('@/lib/db', () => ({
            default: { connect: async () => ({ query: async () => ({ rows }), release: () => undefined }) },
        }));
        const { POST } = await import('@/app/api/export/route');
        const res = await POST(new Request('http://localhost/api/export', {
            method: 'POST', body: JSON.stringify({ invoiceIds: [1], system: 'csv' }),
        }));
        const csv = await res.text();
        expect(res.status).toBe(200);
        expect(csv).toContain(`"'=HYPERLINK(""https://attacker.example"",""Dostawca"")"`);
        expect(csv).toContain(`'@SUM(1+1)*cmd`);
        expect(csv).toContain(',-100.00,-23.00,-123.00,');
    });
});
