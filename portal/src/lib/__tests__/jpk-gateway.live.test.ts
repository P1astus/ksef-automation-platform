import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { prepareJpkUpload, submitToTestGateway, signInitUploadWithSidecar } from '../jpk-gateway';

// LIVE test against the Ministry of Finance TEST gateway (test-e-dokumenty.mf.gov.pl).
// Skipped unless JPK_LIVE=1: it needs the network and creates a (test) session at
// the ministry. There is no production variant of this - see jpk-gateway.ts.
//   JPK_LIVE=1 npx vitest run src/lib/__tests__/jpk-gateway.live.test.ts
// JPK_LIVE_XML=<path> submits your own file instead of the ministry's sample.

const GATEWAY_DIR = join(__dirname, '..', '..', '..', '..', 'schemas', 'jpk-v7m3', 'gateway');

// Authorisation by amount is only allowed for a natural person (status 422
// otherwise), so the identity for AuthData is read from the file's own
// OsobaFizyczna Podmiot1. JPK_LIVE_AMOUNT sets the revenue figure.
function nip10(xml: string) { return xml.match(/<(?:etd:|tns:)?NIP>(\d{10})</)?.[1] ?? '0000000000'; }
function individualAuth(xml: string, amount: number) {
    const g = (tag: string) => xml.match(new RegExp(`<(?:etd:)?${tag}>([^<]+)<`))?.[1];
    const nip = g('NIP'), first = g('ImiePierwsze'), last = g('Nazwisko'), birth = g('DataUrodzenia');
    if (!xml.includes('<OsobaFizyczna>') && !xml.includes('<tns:OsobaFizyczna>')) throw new Error('file is not a sole-trader JPK');
    const id = process.env.JPK_LIVE_PESEL ? { pesel: process.env.JPK_LIVE_PESEL } : { nip: nip! };
    return { ...id, firstName: first!, lastName: last!, birthDate: birth!, amount };
}

// Status codes that mean OUR FILE or PACKAGING was wrong (schema, checksum,
// encryption, encoding, size). Anything else - including 419 "error in the
// authorisation data" - means the ministry unpacked, decrypted, hash-checked
// and validated the document and only refused the taxpayer authorisation.
const PACKAGING_FAILURES = new Set([401, 413, 415, 417, 418, 426, 429, 432]);

describe.skipIf(process.env.JPK_LIVE !== '1')('MF test gateway round trip', () => {
    it('gets a sole-trader JPK_V7M(3) through the whole pipeline; reports the authorisation verdict', async () => {
        const pem = readFileSync(join(GATEWAY_DIR, 'TEST-23090b332d381c2e5d84ea33e8fce7e7.cer'));
        const xml = readFileSync(process.env.JPK_LIVE_XML || join(GATEWAY_DIR, 'sample-jpk_v7m-3-individual.xml'), 'utf8');
        const auth = individualAuth(xml, Number(process.env.JPK_LIVE_AMOUNT || '0'));
        const prepared = prepareJpkUpload({
            xml, fileName: `JPK_V7M_${nip10(xml)}_live${Date.now() % 100000}.xml`, certificate: pem, authData: auth,
        });
        const result = await submitToTestGateway(prepared, { pollAttempts: 15, pollDelayMs: 4000 });
        console.log('LIVE RESULT', JSON.stringify(result.status));
        // The transport always worked if we got here (Init, Put Blob, Finish, Status).
        // A 2xx additionally means the test mock accepted the authorisation data.
        expect(PACKAGING_FAILURES.has(result.status.code)).toBe(false);
        if (result.status.code >= 200 && result.status.code < 300) expect(result.status.upo).toBeTruthy();
    }, 180000);
});

// Signed-metadata mode (companies, and anyone without authorisation data): the
// InitUpload is XAdES-BES-signed by the sidecar with a self-signed TEST key,
// which the ministry's test environment accepts. Needs the sidecar running with
// JPK_SIGNING_KEYSTORE_PATH set, XADES_SIDECAR_URL (e.g. http://localhost:8090)
// and SIDECAR_API_KEY in the environment.
//   JPK_LIVE=1 JPK_LIVE_SIGN=1 XADES_SIDECAR_URL=http://localhost:8090 SIDECAR_API_KEY=... npx vitest run <this file>
describe.skipIf(process.env.JPK_LIVE !== '1' || process.env.JPK_LIVE_SIGN !== '1')('MF test gateway round trip, signed metadata', () => {
    it('gets a company JPK_V7M(3) through the pipeline with XAdES-BES metadata and reports the verdict', async () => {
        const pem = readFileSync(join(GATEWAY_DIR, 'TEST-23090b332d381c2e5d84ea33e8fce7e7.cer'));
        const xml = readFileSync(process.env.JPK_LIVE_XML || join(GATEWAY_DIR, 'sample-jpk_v7m-3-organization.xml'), 'utf8');
        const prepared = prepareJpkUpload({ xml, fileName: `JPK_V7M_${nip10(xml)}_sig${Date.now() % 100000}.xml`, certificate: pem });
        const signed = await signInitUploadWithSidecar(prepared.initUploadXml);
        expect(signed).toContain('<ds:Signature');
        const result = await submitToTestGateway(prepared, { signedInitUploadXml: signed, pollAttempts: 15, pollDelayMs: 4000 });
        console.log('LIVE SIGNED RESULT', JSON.stringify(result.status));
        expect(PACKAGING_FAILURES.has(result.status.code)).toBe(false);
        if (result.status.code >= 200 && result.status.code < 300) expect(result.status.upo).toBeTruthy();
    }, 180000);
});
