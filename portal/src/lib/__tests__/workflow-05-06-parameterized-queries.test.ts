import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Round 12 fix: workflows/05-offline24-monitor.json and
// workflows/06-jpk-vat-preparation.json built several Postgres queries via raw
// string interpolation of free-text fields (invoice_number, client_nip) rather
// than the node's own parameterized-query mechanism (`$1`/`$2`/... placeholders
// + `options.queryReplacement`) - flagged since round 11 but left unfixed
// pending tooling to verify a restructure didn't break anything. All 10
// affected Postgres nodes across both files were converted; verified live
// against the real running n8n instance with invoice numbers containing a
// literal single quote (`FV/O'Brien/2026/001`), which the old string-built
// queries would have broken or worse.
//
// Live-testing this via n8n's actual REST execution API (not just rewriting
// the query text) surfaced three further, independent, previously-undiscovered
// bugs downstream of the fields being interpolated at all - none introduced by
// the parameterization itself, all real gaps the raw-string version had too
// (it just failed less legibly, e.g. interpolating the literal text
// "undefined" into a query instead of throwing this node's own parameter-count
// error):
//
// 1. "Flag JPK Correction" (05) read `$json.upload_deadline`/`$json.ksef_number`,
//    but its immediate predecessor "Mark Uploaded in DB" is an UPDATE with no
//    RETURNING clause, whose output is just `{success: true}` - those fields
//    were always empty by the time this node ran, and casting `''::timestamptz`
//    throws in real Postgres. Fixed by reading from
//    `$('Merge KSeF Result').item.json` instead of `$json`.
// 2. The same problem, for the same reason, existed on all three
//    "Update Alert Flags - *" nodes (05), whose immediate predecessor is an
//    HTTP Request node posting to the alert webhook - its response body has no
//    `id` field. Fixed the same way.
// 3. Independently, "Check KSeF Match" (05) had no `alwaysOutputData`, so a
//    genuinely unmatched invoice (the common case - most offline invoices
//    haven't been submitted to KSeF yet) produced zero downstream items,
//    which meant "Merge KSeF Result" (mode: runOnceForEachItem) never ran,
//    "Route by Urgency" never ran, and neither did the loop-closing connection
//    back to "Process Each Invoice" - silently halting the entire batch after
//    the first unmatched invoice, every run, forever. This made the
//    Overdue/Urgent 1h/Urgent 4h alert branches - this workflow's entire
//    purpose - structurally unreachable. Fixed via `alwaysOutputData: true`,
//    confirmed live: a synthetic unmatched, overdue invoice's
//    `alert_sent_overdue` flag went from permanently false to true, and a
//    real 60-invoice queue (the stress-test fixture) processed end to end in
//    one execution for the first time instead of stopping after item 1.
// 4. Independently, "Get Client Invoices" (06) never selected `firm_id`, and
//    "Generate CSV Export" (06) rebuilt its output object without carrying
//    `firm_id` through either - both gaps had to be closed together before
//    "UPSERT JPK Preparation" (which needs firm_id) could receive it. Fixed by
//    adding `firm_id` to the SELECT list and to Generate CSV Export's returned
//    object.

const ROOT = join(__dirname, '..', '..', '..', '..');

function loadWorkflow(file: string) {
    return JSON.parse(readFileSync(join(ROOT, 'workflows', file), 'utf8'));
}

function findNode(wf: any, name: string) {
    const node = wf.nodes.find((n: any) => n.name === name);
    expect(node, `node "${name}" should exist`).toBeTruthy();
    return node;
}

// A query is "raw-interpolated" if it embeds a `{{ ... }}` expression directly
// in the SQL text (quoted or not) instead of a `$N` placeholder.
function isRawInterpolated(query: string): boolean {
    return /\{\{.*?\}\}/.test(query);
}

describe('workflow 05 (offline24-monitor): Postgres nodes use parameterized queries', () => {
    const wf = loadWorkflow('05-offline24-monitor.json');
    const targets = [
        'Check KSeF Match',
        'Mark Uploaded in DB',
        'Flag JPK Correction',
        'Update Alert Flags - Overdue',
        'Update Alert Flags - 1h',
        'Update Alert Flags - 4h',
    ];

    it.each(targets)('%s: query text has no raw {{ }} interpolation', (name) => {
        const node = findNode(wf, name);
        expect(isRawInterpolated(node.parameters.query)).toBe(false);
    });

    it.each(targets)('%s: declares a queryReplacement matching its $N placeholders', (name) => {
        const node = findNode(wf, name);
        const query: string = node.parameters.query;
        const replacement: string = node.parameters.options?.queryReplacement ?? '';
        const placeholderCount = new Set(query.match(/\$(\d+)/g)).size;
        const resolvableCount = (replacement.match(/\{\{[\s\S]*?\}\}/g) ?? []).length;
        expect(resolvableCount).toBeGreaterThanOrEqual(placeholderCount);
    });

    it('Check KSeF Match always outputs data (so an unmatched invoice does not silently kill the batch loop)', () => {
        expect(findNode(wf, 'Check KSeF Match').alwaysOutputData).toBe(true);
    });

    it('Flag JPK Correction reads from Merge KSeF Result, not $json (Mark Uploaded in DB has no RETURNING)', () => {
        const replacement = findNode(wf, 'Flag JPK Correction').parameters.options.queryReplacement;
        expect(replacement).toContain("$('Merge KSeF Result').item.json");
        expect(replacement).not.toMatch(/\{\{\s*\$json\./);
    });

    it.each(['Update Alert Flags - Overdue', 'Update Alert Flags - 1h', 'Update Alert Flags - 4h'])(
        '%s reads from Merge KSeF Result, not $json (its predecessor is an HTTP alert node)',
        (name) => {
            const replacement = findNode(wf, name).parameters.options.queryReplacement;
            expect(replacement).toContain("$('Merge KSeF Result').item.json.id");
            expect(replacement).not.toMatch(/\{\{\s*\$json\./);
        },
    );
});

describe('workflow 06 (jpk-vat-preparation): Postgres nodes use parameterized queries', () => {
    const wf = loadWorkflow('06-jpk-vat-preparation.json');
    const targets = ['Get Clients for Period', 'Get Client Invoices', 'UPSERT JPK Preparation', 'Log to Audit'];

    it.each(targets)('%s: query text has no raw {{ }} interpolation', (name) => {
        const node = findNode(wf, name);
        expect(isRawInterpolated(node.parameters.query)).toBe(false);
    });

    it.each(targets)('%s: declares a queryReplacement matching its $N placeholders', (name) => {
        const node = findNode(wf, name);
        const query: string = node.parameters.query;
        const replacement: string = node.parameters.options?.queryReplacement ?? '';
        const placeholderCount = new Set(query.match(/\$(\d+)/g)).size;
        const resolvableCount = (replacement.match(/\{\{[\s\S]*?\}\}/g) ?? []).length;
        expect(resolvableCount).toBeGreaterThanOrEqual(placeholderCount);
    });

    it('Get Client Invoices selects firm_id (UPSERT JPK Preparation needs it downstream)', () => {
        expect(findNode(wf, 'Get Client Invoices').parameters.query).toMatch(/SELECT id, firm_id,/);
    });

    it('Generate CSV Export carries firm_id through in its returned object', () => {
        const wfLocal = loadWorkflow('06-jpk-vat-preparation.json');
        const code = findNode(wfLocal, 'Generate CSV Export').parameters.jsCode as string;
        const fn = new Function('$input', code);
        const out = fn({
            all: () => [
                {
                    json: {
                        firm_id: 42,
                        client_nip: '1112223344',
                        client_name: 'Test Client',
                        period: '2026-09',
                        invoice_number: 'FV/1',
                        issue_date: '2026-09-01',
                        direction: 'sales',
                        buyer_nip: '9998887766',
                        net_amount: 100,
                        vat_amount: 23,
                        gross_amount: 123,
                        is_NrKSeF: 'TAK',
                        is_OFF: '',
                        is_BFK: '',
                        is_DI: '',
                        ksef_number: 'K1',
                        marker_reason: 'ok',
                    },
                },
            ],
        });
        expect(out[0].json.firm_id).toBe(42);
    });
});
