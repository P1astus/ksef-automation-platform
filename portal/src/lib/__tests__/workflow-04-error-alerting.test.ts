import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Round 4 fix: three silent-failure paths in 04-ksef-invoice-retrieval.json.
//
// 1. "Combine Invoice Results" wrapped $('Query Sales/Purchase Invoices').first()
//    in try/catch to handle a query failure - but neither query node had
//    continueOnFail, so a real failure hard-aborted the whole execution before
//    this node (or anything after it) ever ran. Confirmed dead in round 3 via a
//    synthetic workflow reproducing the exact pattern (see CLAUDE.md). Fixed by
//    adding continueOnFail to both query nodes and replacing the try/catch with
//    an explicit $json.error check (the actual shape continueOnFail produces -
//    same convention the pre-existing "Session Opened?" check already used),
//    routed to a real audit_log entry + an alert to 01-send-alert instead of
//    silently reporting "no invoices found".
// 2. The per-client "Auth Success?" and "Session Opened?" false-branches
//    (Log Auth Failure / Log Session Failure) produced an in-memory item and
//    looped back to the next client with no audit_log row and no alert -
//    a real auth or session failure during the 30-minute sync was completely
//    invisible. Fixed by inserting an audit_log insert + an alert call before
//    each rejoins "Process Each Client".
// 3. The workflow-level "On Error" catch-all ("Handle Retrieval Error" ->
//    "Log Error") only wrote to audit_log, never alerted anyone. Fixed by
//    adding a critical-severity alert after "Log Error".
//
// Note: n8n's separate Error Trigger/errorWorkflow mechanism (which would let
// "On Error" fire as its own execution) needs settings.errorWorkflow set to
// this workflow's *live* instance id - confirmed empirically this round via a
// disposable synthetic workflow that a fresh id is assigned on every import,
// so hardcoding one in this tracked JSON would silently go stale on the next
// re-import (same fragility class as the credential-id remapping problem
// HANDOVER.md already documents). Left as a documented one-time per-environment
// step, not baked into the JSON - see INSTALL.md's workflow-import section.

const ROOT = join(__dirname, '..', '..', '..', '..');
const FILE = '04-ksef-invoice-retrieval.json';

function loadWorkflow() {
    return JSON.parse(readFileSync(join(ROOT, 'workflows', FILE), 'utf8'));
}

function findNode(wf: any, name: string) {
    const node = wf.nodes.find((n: any) => n.name === name);
    expect(node, `node "${name}" should exist`).toBeTruthy();
    return node;
}

function connectionTargets(wf: any, sourceName: string, branchIndex = 0): string[] {
    const branch = wf.connections[sourceName]?.main?.[branchIndex] || [];
    return branch.map((c: any) => c.node);
}

// Executes the "Combine Invoice Results" Code node's jsCode against a mocked
// $() resolver, the same way n8n would call it - proves the branching logic
// itself, not just that certain strings appear in the source.
function runCombineNode(mocks: Record<string, any>) {
    const wf = loadWorkflow();
    const code = findNode(wf, 'Combine Invoice Results').parameters.jsCode as string;
    const $ = (name: string) => ({ first: () => ({ json: mocks[name] }) });
    const fn = new Function('$', code);
    return fn($);
}

describe('workflow 04: invoice-query failure is surfaced, not swallowed', () => {
    it('Query Sales/Purchase Invoices run with continueOnFail (so a failure reaches Combine Invoice Results at all)', () => {
        const wf = loadWorkflow();
        expect(findNode(wf, 'Query Sales Invoices').continueOnFail).toBe(true);
        expect(findNode(wf, 'Query Purchase Invoices').continueOnFail).toBe(true);
    });

    it('Combine Invoice Results no longer has a dead try/catch around the query lookups', () => {
        const wf = loadWorkflow();
        const code = findNode(wf, 'Combine Invoice Results').parameters.jsCode as string;
        expect(code).not.toMatch(/try\s*{\s*const salesResp/);
        expect(code).toContain('salesResult.error !== undefined');
    });

    it('a sales-query failure produces retrievalError:true with the error message, not an empty result', () => {
        const out = runCombineNode({
            'Prepare Invoice Query': { client_nip: '1111111111', firm_id: 1, sessionRef: 'ref1', accessToken: 'tok1' },
            'Query Sales Invoices': { error: { message: 'boom' } },
            'Query Purchase Invoices': { invoices: [] },
        });
        expect(out).toEqual([{
            json: {
                retrievalError: true,
                errorMessage: 'boom',
                client_nip: '1111111111',
                firm_id: 1,
                sessionRef: 'ref1',
                accessToken: 'tok1',
            },
        }]);
    });

    it('a purchase-query failure is also surfaced (both queries checked independently)', () => {
        const out = runCombineNode({
            'Prepare Invoice Query': { client_nip: '2222222222', firm_id: 2, sessionRef: 'ref2', accessToken: 'tok2' },
            'Query Sales Invoices': { invoices: [] },
            'Query Purchase Invoices': { error: { message: 'purchase api down' } },
        });
        expect(out[0].json.retrievalError).toBe(true);
        expect(out[0].json.errorMessage).toBe('purchase api down');
    });

    it('no invoices and no error still reports hasInvoices:false, retrievalError:false (the legitimate empty case)', () => {
        const out = runCombineNode({
            'Prepare Invoice Query': { client_nip: '3333333333', firm_id: 3, sessionRef: 'ref3', accessToken: 'tok3' },
            'Query Sales Invoices': { invoices: [] },
            'Query Purchase Invoices': { invoices: [] },
        });
        expect(out).toEqual([{
            json: {
                hasInvoices: false, retrievalError: false, count: 0,
                sessionRef: 'ref3', accessToken: 'tok3', client_nip: '3333333333', firm_id: 3,
            },
        }]);
    });

    it('real invoices still map through correctly with retrievalError:false', () => {
        const out = runCombineNode({
            'Prepare Invoice Query': { client_nip: '4444444444', firm_id: 4, sessionRef: 'ref4', accessToken: 'tok4' },
            'Query Sales Invoices': { invoices: [{ ksefNumber: 'K1', invoiceNumber: 'FV/1', invoiceType: 'VAT', seller: { nip: '111' }, buyer: { nip: '222' }, netAmount: 100, vatAmount: 23, grossAmount: 123, issueDate: '2026-01-01' }] },
            'Query Purchase Invoices': { invoices: [] },
        });
        expect(out).toHaveLength(1);
        expect(out[0].json).toMatchObject({ ksefNumber: 'K1', direction: 'sales', hasInvoices: true, retrievalError: false });
    });

    it('Retrieval Failed? branches to an audit log + alert instead of straight to Has Invoices?', () => {
        const wf = loadWorkflow();
        expect(connectionTargets(wf, 'Combine Invoice Results')).toEqual(['Retrieval Failed?']);
        expect(connectionTargets(wf, 'Retrieval Failed?', 0)).toEqual(['Log Retrieval Failure']);
        expect(connectionTargets(wf, 'Retrieval Failed?', 1)).toEqual(['Has Invoices?']);
        expect(connectionTargets(wf, 'Log Retrieval Failure')).toEqual(['Alert - Retrieval Failure']);
        expect(connectionTargets(wf, 'Alert - Retrieval Failure')).toEqual(['Process Each Client']);
    });
});

describe('workflow 04: per-client auth/session failures are no longer silent', () => {
    it('Log Auth Failure now routes through an audit log + alert before rejoining the client loop', () => {
        const wf = loadWorkflow();
        expect(connectionTargets(wf, 'Log Auth Failure')).toEqual(['Log Auth Failure to Audit']);
        expect(connectionTargets(wf, 'Log Auth Failure to Audit')).toEqual(['Alert - Auth Failure']);
        expect(connectionTargets(wf, 'Alert - Auth Failure')).toEqual(['Process Each Client']);
    });

    it('Log Session Failure now routes through an audit log + alert before rejoining the client loop', () => {
        const wf = loadWorkflow();
        expect(connectionTargets(wf, 'Log Session Failure')).toEqual(['Log Session Failure to Audit']);
        expect(connectionTargets(wf, 'Log Session Failure to Audit')).toEqual(['Alert - Session Failure']);
        expect(connectionTargets(wf, 'Alert - Session Failure')).toEqual(['Process Each Client']);
    });

    it('the top-level On Error catch-all now alerts after logging, instead of ending at the DB row', () => {
        const wf = loadWorkflow();
        expect(connectionTargets(wf, 'Log Error')).toEqual(['Alert - Retrieval Error']);
        const node = findNode(wf, 'Alert - Retrieval Error');
        expect(node.parameters.jsonBody).toContain("severity: 'critical'");
    });

    it('all new alert nodes call the real 01-send-alert webhook contract', () => {
        const wf = loadWorkflow();
        for (const name of ['Alert - Retrieval Failure', 'Alert - Auth Failure', 'Alert - Session Failure', 'Alert - Retrieval Error']) {
            const node = findNode(wf, name);
            expect(node.type).toBe('n8n-nodes-base.httpRequest');
            expect(node.parameters.url).toBe('http://localhost:5678/webhook/ksef-alert');
            expect(node.parameters.jsonBody).toContain('workflow_name');
        }
    });
});

describe('workflow 04: still valid JSON, still fully connected', () => {
    it('parses as valid JSON', () => {
        expect(() => loadWorkflow()).not.toThrow();
    });

    it('every connection points at a node that actually exists', () => {
        const wf = loadWorkflow();
        const names = new Set(wf.nodes.map((n: any) => n.name));
        for (const [src, outs] of Object.entries(wf.connections) as any) {
            expect(names.has(src)).toBe(true);
            for (const branch of outs.main || []) {
                for (const c of branch) {
                    expect(names.has(c.node)).toBe(true);
                }
            }
        }
    });

    it('has no duplicate node ids or names', () => {
        const wf = loadWorkflow();
        const ids = wf.nodes.map((n: any) => n.id);
        const names = wf.nodes.map((n: any) => n.name);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(names).size).toBe(names.length);
    });
});
