import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildKSeFInvoiceXml, type InvoiceInput } from './ksef-invoice-builder';

// FA(3) structural correctness is verified against the real, vendored XSD
// (schemas/fa3-13775-schemat.xsd) with xmllint, not by re-asserting our own
// assumptions about the schema in JS. The XSD's <xsd:import>/<xsd:include>
// schemaLocation values are the government's real http://crd.gov.pl/... URLs;
// xmllint would otherwise try to fetch those over the network on every run,
// so a throwaway copy with the locations rewritten to local relative paths
// is made per test run instead (the vendored schema files themselves are
// left untouched).
const SCHEMAS_DIR = join(__dirname, '../../../schemas');
const XSD_FILES = [
    'ElementarneTypyDanych_v10-0E.xsd',
    'KodyKrajow_v10-0E.xsd',
    'StrukturyDanych_v10-0E.xsd',
    'fa3-13775-schemat.xsd',
];

let xmllintAvailable = true;
let schemaDir: string;

beforeAll(() => {
    try {
        execFileSync('xmllint', ['--version']);
    } catch {
        xmllintAvailable = false;
        return;
    }
    schemaDir = mkdtempSync(join(tmpdir(), 'fa3-schema-'));
    for (const file of XSD_FILES) {
        const src = readFileSync(join(SCHEMAS_DIR, file), 'utf8');
        const rewritten = src.replace(
            /schemaLocation="http:\/\/crd\.gov\.pl\/[^"]*\/(StrukturyDanych_v10-0E\.xsd|KodyKrajow_v10-0E\.xsd|ElementarneTypyDanych_v10-0E\.xsd)"/g,
            'schemaLocation="$1"'
        );
        writeFileSync(join(schemaDir, file), rewritten);
    }
});

function validateAgainstFa3Schema(xml: string): { valid: boolean; output: string } {
    const xmlPath = join(schemaDir, `sample-${Math.random().toString(36).slice(2)}.xml`);
    writeFileSync(xmlPath, xml);
    try {
        execFileSync('xmllint', [
            '--noout', '--nonet', '--schema',
            join(schemaDir, 'fa3-13775-schemat.xsd'),
            xmlPath,
        ], { stdio: 'pipe' });
        return { valid: true, output: '' };
    } catch (err: any) {
        return { valid: false, output: (err.stderr || err.stdout || String(err)).toString() };
    }
}

const baseInput: Omit<InvoiceInput, 'lines' | 'dueDate'> = {
    invoiceNumber: 'FV/1/2026',
    issueDate: '2026-09-14',
    seller: { nip: '1111111111', name: 'Sprzedawca Sp. z o.o.', street: 'ul. Testowa 1', city: 'Warszawa', postCode: '00-001' },
    buyer: { nip: '2222222222', name: 'Nabywca Sp. z o.o.', street: 'ul. Inna 2', city: 'Krakow', postCode: '00-002' },
};

describe('buildKSeFInvoiceXml — validates against the real vendored FA(3) XSD', () => {
    it.skipIf(!xmllintAvailable)('a single-rate (23%) invoice validates', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'Usluga testowa', qty: 1, unit: 'szt', netPrice: 100, vatRate: '23' }],
        });
        const result = validateAgainstFa3Schema(xml);
        expect(result.output).toBe('');
        expect(result.valid).toBe(true);
    });

    it.skipIf(!xmllintAvailable)('a mixed-rate invoice (23% + 8% + zw) with a due date validates', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            dueDate: '2026-10-14',
            lines: [
                { name: 'Towar A', qty: 2, unit: 'szt', netPrice: 50, vatRate: '23' },
                { name: 'Usluga B', qty: 1, unit: 'godz', netPrice: 200, vatRate: '8' },
                { name: 'Uslugi zwolnione', qty: 1, unit: 'szt', netPrice: 30, vatRate: 'zw' },
            ],
        });
        const result = validateAgainstFa3Schema(xml);
        expect(result.output).toBe('');
        expect(result.valid).toBe(true);
    });

    it.skipIf(!xmllintAvailable)('a 0%-rate invoice validates', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'Towar 0%', qty: 3, unit: 'szt', netPrice: 40, vatRate: '0' }],
        });
        const result = validateAgainstFa3Schema(xml);
        expect(result.output).toBe('');
        expect(result.valid).toBe(true);
    });

    it('declares the FA (3) form code, not FA (2)', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'X', qty: 1, unit: 'szt', netPrice: 10, vatRate: '23' }],
        });
        expect(xml).toContain('kodSystemowy="FA (3)"');
        expect(xml).toContain('<fa:WariantFormularza>3</fa:WariantFormularza>');
        expect(xml).toContain('http://crd.gov.pl/wzor/2025/06/25/13775/');
        expect(xml).not.toContain('FA (2)');
    });
});
