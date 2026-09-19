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
            exemptionBasis: { type: 'ustawa', text: 'art. 43 ust. 1 pkt 1 ustawy o VAT' },
        });
        const result = validateAgainstFa3Schema(xml);
        expect(result.output).toBe('');
        expect(result.valid).toBe(true);
        expect(xml).toContain('<fa:P_19>1</fa:P_19>');
        expect(xml).toContain('<fa:P_19A>art. 43 ust. 1 pkt 1 ustawy o VAT</fa:P_19A>');
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

    it.skipIf(!xmllintAvailable)('a correction invoice (mixed-rate original corrected to a different mix) validates and reports deltas, not absolutes', () => {
        const originalLines = [
            { name: 'Towar A', qty: 2, unit: 'szt', netPrice: 50, vatRate: '23' as const },
            { name: 'Usluga B', qty: 1, unit: 'godz', netPrice: 200, vatRate: '8' as const },
        ];
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            invoiceNumber: 'FV/2/2026',
            lines: [
                { name: 'Towar A', qty: 1, unit: 'szt', netPrice: 50, vatRate: '23' }, // quantity reduced 2 -> 1
                { name: 'Usluga B', qty: 1, unit: 'godz', netPrice: 200, vatRate: '8' }, // unchanged
                { name: 'Uslugi zwolnione', qty: 1, unit: 'szt', netPrice: 30, vatRate: 'zw' }, // new line
            ],
            correction: {
                reason: 'Korekta ilości towaru A oraz dodanie pozycji zwolnionej',
                originalInvoiceNumber: 'FV/1/2026',
                originalIssueDate: '2026-09-14',
                originalKsefNumber: '1111111111-20260914-010080DD2B5E-26',
                originalLines,
            },
            exemptionBasis: { type: 'ustawa', text: 'art. 43 ust. 1 pkt 1 ustawy o VAT' },
        });

        const result = validateAgainstFa3Schema(xml);
        expect(result.output).toBe('');
        expect(result.valid).toBe(true);

        expect(xml).toContain('<fa:RodzajFaktury>KOR</fa:RodzajFaktury>');
        expect(xml).toContain('<fa:NrFaKorygowanej>FV/1/2026</fa:NrFaKorygowanej>');
        expect(xml).toContain('<fa:NrKSeFFaKorygowanej>1111111111-20260914-010080DD2B5E-26</fa:NrKSeFFaKorygowanej>');
        // 23% line dropped from 100.00 net to 50.00 net -> delta -50.00 / -11.50 VAT
        expect(xml).toContain('<fa:P_13_1>-50.00</fa:P_13_1>');
        expect(xml).toContain('<fa:P_14_1>-11.50</fa:P_14_1>');
        // 8% line unchanged -> zero delta, still reported
        expect(xml).toContain('<fa:P_13_2>0.00</fa:P_13_2>');
        expect(xml).toContain('<fa:P_14_2>0.00</fa:P_14_2>');
        // new zw line, wasn't on the original at all -> full amount as the delta
        expect(xml).toContain('<fa:P_13_7>30.00</fa:P_13_7>');
        // total delta: -61.50 (23% line) + 0 (8% line) + 30.00 (new zw line) = -31.50
        expect(xml).toContain('<fa:P_15>-31.50</fa:P_15>');
        // line items report the FULL post-correction state, not a delta
        expect(xml).toContain('<fa:P_9A>50.00</fa:P_9A>');
        expect(xml).toContain('<fa:P_8B>1</fa:P_8B>');
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

    it.skipIf(!xmllintAvailable)('a VAT-marża invoice has the required annotation and never exposes its internal taxable margin', () => {
        const internalTaxableMargin = 321.98;
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'Samochód używany', qty: 1, unit: 'szt', netPrice: 999999, vatRate: '23' }],
            marginScheme: 'used_goods', marginGrossAmount: 1230,
        });
        expect(validateAgainstFa3Schema(xml).valid).toBe(true);
        expect(xml).toContain('<fa:P_13_11>1230.00</fa:P_13_11>');
        expect(xml).toContain('<fa:P_15>1230.00</fa:P_15>');
        expect(xml).toContain('<fa:P_PMarzy>1</fa:P_PMarzy>');
        expect(xml).toContain('<fa:P_PMarzy_3_1>1</fa:P_PMarzy_3_1>');
        expect(xml).not.toMatch(/<fa:P_1[34]_1>/);
        expect(xml).not.toContain('<fa:P_9A>');
        expect(xml).not.toContain('<fa:P_11>');
        expect(xml).not.toContain('<fa:P_12>');
        // The builder receives only buyer gross; the operator-only taxable
        // margin cannot be serialized by this public invoice builder.
        expect(xml).not.toContain(String(internalTaxableMargin));
    });

    it.skipIf(!xmllintAvailable)('a WDT invoice (0% intra-EU supply) validates and rolls up into P_13_6_2, not P_13_6_1', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            buyer: { ...baseInput.buyer, countryCode: 'DE' },
            lines: [{ name: 'Towar na eksport wewnatrzunijny', qty: 1, unit: 'szt', netPrice: 1000, vatRate: '0-wdt' }],
        });
        const result = validateAgainstFa3Schema(xml);
        expect(result.output).toBe('');
        expect(result.valid).toBe(true);
        expect(xml).toContain('<fa:P_12>0 WDT</fa:P_12>');
        expect(xml).toContain('<fa:P_13_6_2>1000.00</fa:P_13_6_2>');
        expect(xml).not.toContain('<fa:P_13_6_1>');
    });

    it.skipIf(!xmllintAvailable)('an export invoice (0% export) validates and rolls up into P_13_6_3', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            buyer: { ...baseInput.buyer, countryCode: 'US' },
            lines: [{ name: 'Towar eksportowany', qty: 1, unit: 'szt', netPrice: 500, vatRate: '0-export' }],
        });
        const result = validateAgainstFa3Schema(xml);
        expect(result.output).toBe('');
        expect(result.valid).toBe(true);
        expect(xml).toContain('<fa:P_12>0 EX</fa:P_12>');
        expect(xml).toContain('<fa:P_13_6_3>500.00</fa:P_13_6_3>');
    });

    // Round 10 removed the 'oo' (domestic reverse charge) rate entirely -
    // art. 17 ust. 1 pkt 7/8, the legal basis it modeled, was repealed
    // 2019-11-01 and replaced by mandatory split payment (full VAT, not a
    // zero-VAT line). See VatRateCode's doc comment in ksef-invoice-builder.ts.
    it('always sets P_18 to "2" (nie) - no VatRateCode models domestic reverse charge', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'X', qty: 1, unit: 'szt', netPrice: 10, vatRate: '23' }],
        });
        expect(xml).toContain('<fa:P_18>2</fa:P_18>');
    });

    it('throws when a zw line has no exemption legal basis', () => {
        expect(() => buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'Uslugi zwolnione', qty: 1, unit: 'szt', netPrice: 10, vatRate: 'zw' }],
        })).toThrow(/podstawa prawna zwolnienia/i);
    });

    it('throws when the exemption basis text is blank whitespace', () => {
        expect(() => buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'Uslugi zwolnione', qty: 1, unit: 'szt', netPrice: 10, vatRate: 'zw' }],
            exemptionBasis: { type: 'ustawa', text: '   ' },
        })).toThrow(/podstawa prawna zwolnienia/i);
    });

    it.skipIf(!xmllintAvailable)('an EU-directive exemption basis (P_19B) validates', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'Uslugi zwolnione', qty: 1, unit: 'szt', netPrice: 10, vatRate: 'zw' }],
            exemptionBasis: { type: 'dyrektywa', text: 'art. 132 dyrektywy 2006/112/WE' },
        });
        const result = validateAgainstFa3Schema(xml);
        expect(result.output).toBe('');
        expect(result.valid).toBe(true);
        expect(xml).toContain('<fa:P_19B>art. 132 dyrektywy 2006/112/WE</fa:P_19B>');
    });
});
