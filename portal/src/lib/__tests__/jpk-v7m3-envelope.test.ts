import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateJpkV7M, JpkGenerationError, type JpkInvoiceRow } from '../jpk-generator';
import { normalizeJpkDocType, InvalidJpkMarkerError } from '../jpk-markers';
import type { InvoiceLine } from '../ksef-invoice-builder';
import { isValidTaxOfficeCode } from '../tax-office-codes';

// Round 17: the generated file must be JPK_V7M(3) v1-0E - validated against
// the official XSD vendored in schemas/jpk-v7m3/, not against our own idea of
// the structure. (Rounds 9-16 could only check arithmetic: no V7 XSD existed
// in the repo, and the envelope was in fact still the old JPK_VAT (3) format.)

const SCHEMA_DIR = join(__dirname, '..', '..', '..', '..', 'schemas', 'jpk-v7m3');
const hasXmllint = spawnSync('xmllint', ['--version']).status !== null;

const firm = { nip: '1234567890', name: 'Klient Sp. z o.o.', taxOfficeCode: '1471', email: 'klient@example.com' };
const KSEF = '1234567890-20260205-ABCDEF-123456-7A';

const sale = (over: Partial<JpkInvoiceRow> = {}): JpkInvoiceRow => ({
    id: 1, invoice_number: 'FV/1/2026', issue_date: '2026-02-05', seller_name: 'Klient', buyer_name: 'Nabywca',
    buyer_nip: '111-111-11-11', net_amount: 100, vat_amount: 23, gross_amount: 123, direction: 'sales',
    ksef_number: KSEF, ...over,
});
const purchase = (over: Partial<JpkInvoiceRow> = {}): JpkInvoiceRow => ({
    id: 2, invoice_number: 'ZK/9', issue_date: '2026-02-10', seller_name: 'Dostawca', seller_nip: '3333333333',
    buyer_name: 'Klient', net_amount: 50.4, vat_amount: 11.6, gross_amount: 62, direction: 'purchase',
    jpk_marker: 'OFF', ...over,
});

let localXsd = '';
beforeAll(() => {
    // The XSD imports its type schemas by absolute http URL; point them at the
    // vendored copies so the test never touches the network.
    const dir = mkdtempSync(join(tmpdir(), 'jpk-xsd-'));
    for (const f of ['KodyKrajow_v13-0E.xsd', 'KodyUrzedowSkarbowych_v8-0E.xsd', 'StrukturyDanych_v12-0E.xsd']) {
        copyFileSync(join(SCHEMA_DIR, f), join(dir, f));
    }
    const main = readFileSync(join(SCHEMA_DIR, 'JPK_V7M3_v1-0E.xsd'), 'utf8')
        .replace(/schemaLocation="http[^"]*\/([^/"]+\.xsd)"/g, 'schemaLocation="$1"');
    localXsd = join(dir, 'JPK_V7M3_v1-0E.xsd');
    writeFileSync(localXsd, main);
});

function validate(xml: string): { ok: boolean; output: string } {
    const f = join(mkdtempSync(join(tmpdir(), 'jpk-xml-')), 'jpk.xml');
    writeFileSync(f, xml);
    const r = spawnSync('xmllint', ['--noout', '--schema', localXsd, f], { encoding: 'utf8' });
    return { ok: r.status === 0, output: (r.stdout || '') + (r.stderr || '') };
}

describe.skipIf(!hasXmllint)('generated JPK validates against the official JPK_V7M(3) XSD', () => {
    it('a realistic month (KSeF numbers, several rates, markers, purchase-side fields) is schema-valid', () => {
        const xml = generateJpkV7M(firm, '2026-02', [
            sale({
                jpk_gtu: ['GTU_12'], jpk_procedures: ['TP'], jpk_doc_type: 'FP',
                invoice_lines: [
                    { name: 'a', qty: 1, unit: 'szt', netPrice: 100, vatRate: '23' },
                    { name: 'b', qty: 1, unit: 'szt', netPrice: 50, vatRate: '8' },
                    { name: 'c', qty: 1, unit: 'szt', netPrice: 30, vatRate: '0-wdt' },
                ] as InvoiceLine[],
            }),
            sale({ id: 3, invoice_number: 'FV/2/2026', ksef_number: undefined, jpk_marker: 'BFK', buyer_nip: '', buyer_name: '' }),
            purchase({ jpk_doc_type: 'MK', jpk_import: true }),
            purchase({ id: 4, invoice_number: 'ZK/10', ksef_number: KSEF, jpk_marker: undefined }),
        ]);
        const r = validate(xml);
        expect(r.output).toContain('validates');
        expect(r.ok).toBe(true);
    });

    it('an empty month is schema-valid too', () => {
        expect(validate(generateJpkV7M(firm, '2026-02', [])).ok).toBe(true);
    });

    it('the validator really rejects a bad file (guards against a vacuous pass)', () => {
        const xml = generateJpkV7M(firm, '2026-02', [sale()]).replace('<tns:KodUrzedu>1471', '<tns:KodUrzedu>9999');
        expect(validate(xml).ok).toBe(false);
    });
});

describe('JPK_V7M(3) envelope', () => {
    const xml = generateJpkV7M(firm, '2026-02', [sale(), purchase()]);

    it('carries the V7M(3) identifiers and namespace, not the old JPK_VAT (3) ones', () => {
        expect(xml).toContain('kodSystemowy="JPK_V7M (3)"');
        expect(xml).toContain('wersjaSchemy="1-0E"');
        expect(xml).toContain('xmlns:tns="http://crd.gov.pl/wzor/2025/12/19/14090/"');
        expect(xml).not.toContain('JPK_VAT (3)');
        expect(xml).not.toContain('wersjaSchemy="1-2"');
        expect(xml).not.toContain('jpk.mf.gov.pl/wzor/2022');
        expect(xml).not.toContain('KodKSeF');
    });

    it('puts KodUrzedu/Rok/Miesiac in Naglowek and never the placeholder office 0000', () => {
        expect(xml).toContain('<tns:KodUrzedu>1471</tns:KodUrzedu>');
        expect(xml).toContain('<tns:Rok>2026</tns:Rok>');
        expect(xml).toContain('<tns:Miesiac>2</tns:Miesiac>');
        expect(xml).not.toContain('0000');
        expect(xml).not.toContain('DataOd');
    });

    it('declares the KSeF reference as NrKSeF, or the stored OFF/BFK/DI marker', () => {
        expect(xml).toContain(`<tns:NrKSeF>${KSEF}</tns:NrKSeF>`);
        expect(xml).toContain('<tns:OFF>1</tns:OFF>');
    });

    it('writes declaration amounts as whole zloty and keeps grosze in the register', () => {
        const decl = xml.slice(xml.indexOf('<tns:PozycjeSzczegolowe>'), xml.indexOf('</tns:PozycjeSzczegolowe>'));
        expect(decl).not.toMatch(/\.\d\d</);
        expect(xml).toContain('<tns:K_42>50.40</tns:K_42>');
    });

    it('puts Deklaracja before Ewidencja, as the schema orders them', () => {
        expect(xml.indexOf('<tns:Deklaracja>')).toBeLessThan(xml.indexOf('<tns:Ewidencja>'));
    });

    it('uses BRAK for a contractor with no number or name', () => {
        const out = generateJpkV7M(firm, '2026-02', [sale({ buyer_nip: '', buyer_name: '' })]);
        expect(out).toContain('<tns:NrKontrahenta>BRAK</tns:NrKontrahenta>');
        expect(out).toContain('<tns:NazwaKontrahenta>BRAK</tns:NazwaKontrahenta>');
    });

    it('emits TypDokumentu / DokumentZakupu / IMP only when set', () => {
        const withAll = generateJpkV7M(firm, '2026-02', [
            sale({ jpk_doc_type: 'RO' }), purchase({ jpk_doc_type: 'VAT_RR', jpk_import: true }),
        ]);
        expect(withAll).toContain('<tns:TypDokumentu>RO</tns:TypDokumentu>');
        expect(withAll).toContain('<tns:DokumentZakupu>VAT_RR</tns:DokumentZakupu>');
        expect(withAll).toContain('<tns:IMP>1</tns:IMP>');
        expect(xml).not.toContain('TypDokumentu');
        expect(xml).not.toContain('DokumentZakupu');
        expect(xml).not.toContain('<tns:IMP>');
    });
});

describe('generateJpkV7M refuses input that cannot make a valid file', () => {
    const problemsOf = (fn: () => unknown): string[] => {
        try { fn(); } catch (e) { if (e instanceof JpkGenerationError) return e.problems; throw e; }
        return [];
    };

    it('needs a valid tax office code', () => {
        expect(problemsOf(() => generateJpkV7M({ ...firm, taxOfficeCode: null }, '2026-02', [])).join()).toContain('urzędu skarbowego');
        expect(problemsOf(() => generateJpkV7M({ ...firm, taxOfficeCode: '9999' }, '2026-02', [])).length).toBe(1);
    });

    it('rejects a row with neither a KSeF number nor OFF/BFK/DI, listing every such invoice', () => {
        const p = problemsOf(() => generateJpkV7M(firm, '2026-02', [
            sale({ ksef_number: undefined, jpk_marker: undefined }),
            purchase({ jpk_marker: 'NrKSeF' }),
        ]));
        expect(p).toHaveLength(2);
        expect(p[0]).toContain('FV/1/2026');
        expect(p[1]).toContain('ZK/9');
    });

    it('rejects a malformed KSeF number instead of writing it', () => {
        expect(problemsOf(() => generateJpkV7M(firm, '2026-02', [sale({ ksef_number: 'STC-123' })]))[0]).toContain('numer KSeF');
    });

    it('needs the taxpayer e-mail that Podmiot1 requires', () => {
        expect(problemsOf(() => generateJpkV7M({ ...firm, email: '' }, '2026-02', []))[0]).toContain('e-mail');
    });

    it('rejects a malformed taxpayer NIP', () => {
        expect(problemsOf(() => generateJpkV7M({ ...firm, nip: '12345' }, '2026-02', []))[0]).toContain('NIP');
    });

    it('refuses periods before the V7M(3) start (2026-02)', () => {
        expect(problemsOf(() => generateJpkV7M(firm, '2026-01', []))[0]).toContain('2026-02');
    });
});

describe('document-type markers and tax office codes', () => {
    it('validates the code set per direction', () => {
        expect(normalizeJpkDocType('FP', 'sales')).toBe('FP');
        expect(normalizeJpkDocType('MK', 'purchase')).toBe('MK');
        expect(normalizeJpkDocType('WEW', 'sales')).toBe('WEW');
        expect(normalizeJpkDocType('WEW', 'purchase')).toBe('WEW');
        expect(normalizeJpkDocType('', 'sales')).toBeNull();
        expect(() => normalizeJpkDocType('MK', 'sales')).toThrow(InvalidJpkMarkerError);
        expect(() => normalizeJpkDocType('FP', 'purchase')).toThrow(InvalidJpkMarkerError);
    });

    it('generateJpkV7M refuses an unknown document type', () => {
        expect(() => generateJpkV7M(firm, '2026-02', [sale({ jpk_doc_type: 'XX' })])).toThrow(InvalidJpkMarkerError);
    });

    it('knows the official office list', () => {
        expect(isValidTaxOfficeCode('1471')).toBe(true);
        expect(isValidTaxOfficeCode('0000')).toBe(false);
        expect(isValidTaxOfficeCode(undefined)).toBe(false);
    });
});

describe.skipIf(!hasXmllint)('remaining optional JPK_V7M(3) inputs validate against the official XSD', () => {
    const individual = { ...firm, taxpayerType: 'individual' as const, firstName: 'Jan', lastName: 'Kowalski', birthDate: '1980-05-17' };

    it('a sole trader is written as OsobaFizyczna (NIP, name, surname, birth date, then Email)', () => {
        const xml = generateJpkV7M(individual, '2026-02', [sale()]);
        expect(xml).toContain('<tns:OsobaFizyczna>');
        expect(xml).toContain('<etd:DataUrodzenia>1980-05-17</etd:DataUrodzenia>');
        expect(xml).not.toContain('OsobaNiefizyczna');
        const r = validate(xml);
        expect(r.output).toContain('validates');
    });

    it('a correction filing carries CelZlozenia 2', () => {
        const xml = generateJpkV7M(firm, '2026-02', [sale()], { purpose: 2 });
        expect(xml).toContain('<tns:CelZlozenia poz="P_7">2</tns:CelZlozenia>');
        expect(validate(xml).ok).toBe(true);
        expect(generateJpkV7M(firm, '2026-02', [sale()])).toContain('<tns:CelZlozenia poz="P_7">1</tns:CelZlozenia>');
    });

    it('foreign contractors get KodKrajuNadaniaTIN and a number without the prefix', () => {
        const xml = generateJpkV7M(firm, '2026-02', [
            sale({ buyer_nip: 'DE 123456789', jpk_counterparty_country: 'DE' }),
            purchase({ seller_nip: 'EL123456789', jpk_counterparty_country: 'EL' }),
            sale({ id: 5, invoice_number: 'FV/PL', jpk_counterparty_country: 'PL' }),
        ]);
        expect(xml).toContain('<tns:KodKrajuNadaniaTIN>DE</tns:KodKrajuNadaniaTIN>');
        expect(xml).toContain('<tns:NrKontrahenta>123456789</tns:NrKontrahenta>');
        expect(xml).toContain('<tns:KodKrajuNadaniaTIN>EL</tns:KodKrajuNadaniaTIN>');
        expect((xml.match(/KodKrajuNadaniaTIN>/g) || []).length).toBe(4); // DE and EL only, never PL
        expect(validate(xml).ok).toBe(true);
    });

    it('an unknown country code is refused', () => {
        expect(() => generateJpkV7M(firm, '2026-02', [sale({ jpk_counterparty_country: 'ZZ' })])).toThrow(JpkGenerationError);
    });

    it('DataSprzedazy only when the supply date differs from the issue date', () => {
        const xml = generateJpkV7M(firm, '2026-02', [
            sale({ delivery_date: '2026-02-01' }),
            sale({ id: 6, invoice_number: 'FV/SAME', delivery_date: '2026-02-05' }),
        ]);
        expect(xml).toContain('<tns:DataSprzedazy>2026-02-01</tns:DataSprzedazy>');
        expect((xml.match(/<tns:DataSprzedazy>/g) || []).length).toBe(1);
        expect(validate(xml).ok).toBe(true);
    });

    it('DataWplywu comes from the KSeF acquisition instant in Polish time, only when it differs', () => {
        // 2026-02-28T23:30Z is already 1 March in Warsaw (UTC+1).
        const late = generateJpkV7M(firm, '2026-02', [purchase({ issue_date: '2026-02-27', ksef_acquisition_date: new Date('2026-02-28T23:30:00Z') })]);
        expect(late).toContain('<tns:DataWplywu>2026-03-01</tns:DataWplywu>');
        const same = generateJpkV7M(firm, '2026-02', [purchase({ issue_date: '2026-02-10', ksef_acquisition_date: new Date('2026-02-10T09:00:00Z') })]);
        expect(same).not.toContain('DataWplywu');
        expect(validate(late).ok).toBe(true);
    });

    it('margin-scheme rows carry SprzedazVAT_Marza / ZakupVAT_Marza; MR_T/MR_UZ without an amount is refused', () => {
        const xml = generateJpkV7M(firm, '2026-02', [
            sale({ jpk_procedures: ['MR_UZ'], jpk_margin_gross: 1230.5 }),
            purchase({ jpk_margin_gross: 800 }),
        ]);
        expect(xml).toContain('<tns:SprzedazVAT_Marza>1230.50</tns:SprzedazVAT_Marza>');
        expect(xml).toContain('<tns:ZakupVAT_Marza>800.00</tns:ZakupVAT_Marza>');
        expect(validate(xml).ok).toBe(true);
        expect(() => generateJpkV7M(firm, '2026-02', [sale({ jpk_procedures: ['MR_T'] })])).toThrow(/SprzedazVAT_Marza/);
        expect(() => generateJpkV7M(firm, '2026-02', [sale({ jpk_margin_gross: 10 })])).toThrow(/bez oznaczenia/);
    });
});

describe('sole-trader taxpayer needs identity data', () => {
    it('is refused without name, surname or birth date', () => {
        const bad = { ...firm, taxpayerType: 'individual' as const, firstName: 'Jan', lastName: '', birthDate: null };
        expect(() => generateJpkV7M(bad, '2026-02', [])).toThrow(/imienia, nazwiska i daty urodzenia/);
    });
});
