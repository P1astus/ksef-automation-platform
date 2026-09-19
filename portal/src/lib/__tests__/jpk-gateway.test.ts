import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { createDecipheriv, createHash } from 'crypto';
import {
    zipSingleFile, prepareJpkUpload, buildAuthDataXml, submitToTestGateway, JpkGatewayError, JPK_GATEWAY_TEST_URL,
} from '../jpk-gateway';

// The MF gateway protocol (spec "Interfejsy usług JPK" 5.2/5.6), tested offline.
// The live round trip against test-e-dokumenty.mf.gov.pl is jpk-gateway.live.test.ts.

const GATEWAY_DIR = join(__dirname, '..', '..', '..', '..', 'schemas', 'jpk-v7m3', 'gateway');
const pem = readFileSync(join(GATEWAY_DIR, 'TEST-23090b332d381c2e5d84ea33e8fce7e7.cer'));
const xml = readFileSync(join(GATEWAY_DIR, 'sample-jpk_v7m-3-organization.xml'), 'utf8');
const KEY = Buffer.alloc(32, 7);
const IV = Buffer.alloc(16, 9);

function decryptAll(parts: Buffer[]): Buffer {
    return Buffer.concat(parts.map(p => {
        const d = createDecipheriv('aes-256-cbc', KEY, IV);
        return Buffer.concat([d.update(p), d.final()]);
    }));
}

describe('zipSingleFile', () => {
    it('produces a valid ZIP that a real unzip accepts and extracts byte-for-byte', () => {
        const dir = mkdtempSync(join(tmpdir(), 'jpkzip-'));
        const data = Buffer.from(xml.repeat(20), 'utf8');
        writeFileSync(join(dir, 'a.zip'), zipSingleFile('jpk.xml', data));
        const t = spawnSync('unzip', ['-t', join(dir, 'a.zip')], { encoding: 'utf8' });
        expect(t.stdout + t.stderr).toContain('No errors detected');
        const out = spawnSync('unzip', ['-p', join(dir, 'a.zip'), 'jpk.xml']);
        expect(Buffer.compare(out.stdout, data)).toBe(0);
    });
});

describe('prepareJpkUpload', () => {
    const prepared = prepareJpkUpload({ xml, fileName: 'JPK_V7M_1010000000_2026-02.xml', certificate: pem, key: KEY, iv: IV });

    it('encrypts to AES-256-CBC parts that decrypt back to the zip of the document', () => {
        expect(prepared.parts).toHaveLength(1);
        expect(prepared.parts[0].fileName).toBe('JPK_V7M_1010000000_2026-02.xml.zip.aes');
        const dir = mkdtempSync(join(tmpdir(), 'jpkdec-'));
        writeFileSync(join(dir, 'z.zip'), decryptAll(prepared.parts.map(p => p.data)));
        const out = spawnSync('unzip', ['-p', join(dir, 'z.zip'), 'JPK_V7M_1010000000_2026-02.xml']);
        expect(out.stdout.toString('utf8')).toBe(xml);
    });

    it('declares the exact sizes and hashes of what it will send', () => {
        const x = prepared.initUploadXml;
        expect(x).toContain(`<ContentLength>${Buffer.byteLength(xml)}</ContentLength>`);
        expect(x).toContain(`<HashValue algorithm="SHA-256" encoding="Base64">${createHash('sha256').update(xml).digest('base64')}</HashValue>`);
        expect(x).toContain(`<HashValue algorithm="MD5" encoding="Base64">${createHash('md5').update(prepared.parts[0].data).digest('base64')}</HashValue>`);
        expect(x).toContain(`<ContentLength>${prepared.parts[0].data.length}</ContentLength>`);
        expect(x).toContain('systemCode="JPK_V7M (3)" schemaVersion="1-0E"');
        expect(x).toContain(`<IV bytes="16" encoding="Base64">${IV.toString('base64')}</IV>`);
    });

    it('wraps the AES key with RSA (344 base64 chars for a 2048-bit key) and validates against the MF InitUpload schema', () => {
        expect(prepared.initUploadXml.match(/encoding="Base64">([^<]{344})<\/EncryptionKey>/)).not.toBeNull();
        const dir = mkdtempSync(join(tmpdir(), 'jpkinit-'));
        writeFileSync(join(dir, 'i.xml'), prepared.initUploadXml);
        const r = spawnSync('xmllint', ['--noout', '--schema', join(GATEWAY_DIR, 'InitUpload.xsd'), join(dir, 'i.xml')], { encoding: 'utf8' });
        expect(r.stderr).toContain('validates');
    });

    it('rejects a file name the gateway would refuse', () => {
        expect(() => prepareJpkUpload({ xml, fileName: 'a b.xml', certificate: pem })).toThrow(JpkGatewayError);
        expect(() => prepareJpkUpload({ xml, fileName: 'x.x', certificate: pem })).toThrow(JpkGatewayError);
    });

    it('adds AuthData (the SIG-2008 document, AES-encrypted with the same key/IV, Base64) when given', () => {
        const p = prepareJpkUpload({
            xml, fileName: 'JPK_V7M_1010000000_2026-02.xml', certificate: pem, key: KEY, iv: IV,
            authData: { nip: '1010000000', firstName: 'Jan', lastName: 'Kowalski', birthDate: '1980-01-01', amount: 123.5 },
        });
        const m = p.initUploadXml.match(/<AuthData>([^<]+)<\/AuthData>/);
        expect(m).not.toBeNull();
        const d = createDecipheriv('aes-256-cbc', KEY, IV);
        const plain = Buffer.concat([d.update(Buffer.from(m![1], 'base64')), d.final()]).toString('utf8');
        expect(plain).toContain('<podp:Kwota>123.50</podp:Kwota>');
        expect(plain).toContain('<podp:NIP>1010000000</podp:NIP>');
    });
});

describe('buildAuthDataXml', () => {
    it('needs exactly one identifier, a real date and a non-negative amount', () => {
        const base = { firstName: 'A', lastName: 'B', birthDate: '1980-01-01', amount: 1 };
        expect(() => buildAuthDataXml({ ...base })).toThrow(/exactly one/);
        expect(() => buildAuthDataXml({ ...base, nip: '1', pesel: '2' })).toThrow(/exactly one/);
        expect(() => buildAuthDataXml({ ...base, nip: '1010000000', birthDate: '01.01.1980' })).toThrow(/YYYY-MM-DD/);
        expect(() => buildAuthDataXml({ ...base, nip: '1010000000', amount: -1 })).toThrow(/amount/);
    });
});

describe('submitToTestGateway (mocked transport)', () => {
    const prepared = prepareJpkUpload({ xml, fileName: 'JPK_V7M_1010000000_2026-02.xml', certificate: pem, key: KEY, iv: IV });
    const partName = prepared.parts[0].fileName;
    const storage = 'https://taxdocumentstorage03tst.blob.core.windows.net/ref1/blob1?sv=x&sig=y';

    function fakeFetch(calls: Array<{ url: string; init?: RequestInit }>, overrides: Record<string, () => Response> = {}): typeof fetch {
        return (async (url: any, init?: RequestInit) => {
            const u = String(url);
            calls.push({ url: u, init });
            for (const [k, v] of Object.entries(overrides)) if (u.includes(k)) return v();
            if (u.endsWith('/InitUploadSigned')) {
                return new Response(JSON.stringify({
                    ReferenceNumber: 'ref1', TimeoutInSec: 900,
                    RequestToUploadFileList: [{ BlobName: 'blob1', FileName: partName, Url: storage, Method: 'PUT', HeaderList: [{ Key: 'x-ms-blob-type', Value: 'BlockBlob' }, { Key: 'Content-MD5', Value: prepared.parts[0].md5 }] }],
                }), { status: 200 });
            }
            if (u.startsWith('https://taxdocumentstorage')) return new Response(null, { status: 201 });
            if (u.endsWith('/FinishUpload')) return new Response(null, { status: 200 });
            if (u.includes('/Status/')) return new Response(JSON.stringify({ Code: 200, Description: 'ok', Upo: '<upo/>' }), { status: 200 });
            return new Response('unexpected', { status: 500 });
        }) as typeof fetch;
    }

    it('runs Init -> Put Blob -> Finish -> Status against the test host only', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const r = await submitToTestGateway(prepared, { fetchImpl: fakeFetch(calls), pollDelayMs: 0 });
        expect(r).toMatchObject({ referenceNumber: 'ref1', status: { code: 200, upo: '<upo/>' } });
        expect(calls[0].url).toBe(`${JPK_GATEWAY_TEST_URL}/api/Storage/InitUploadSigned`);
        expect(calls[1].url).toBe(storage);
        expect((calls[1].init!.headers as Record<string, string>)['x-ms-blob-type']).toBe('BlockBlob');
        expect(JSON.parse(String(calls[2].init!.body))).toEqual({ ReferenceNumber: 'ref1', AzureBlobNameList: ['blob1'] });
        expect(calls.every(c => c.url.startsWith(JPK_GATEWAY_TEST_URL) || /^https:\/\/taxdocumentstorage\d{2}tst\./.test(c.url))).toBe(true);
    });

    it('never uploads to a host that is not a listed test storage account', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const evil = () => new Response(JSON.stringify({
            ReferenceNumber: 'r', RequestToUploadFileList: [{ BlobName: 'b', FileName: partName, Url: 'https://evil.example/x', Method: 'PUT', HeaderList: [] }],
        }), { status: 200 });
        await expect(submitToTestGateway(prepared, { fetchImpl: fakeFetch(calls, { InitUploadSigned: evil }) })).rejects.toThrow(/unexpected host/);
        expect(calls.some(c => c.url.includes('evil.example'))).toBe(false);
    });

    it('surfaces a gateway rejection with its message instead of swallowing it', async () => {
        const rej = () => new Response(JSON.stringify({ Message: 'Podpis negatywnie zweryfikowany', Code: 120 }), { status: 400 });
        await expect(submitToTestGateway(prepared, { fetchImpl: fakeFetch([], { InitUploadSigned: rej }) })).rejects.toThrow(/Podpis negatywnie/);
    });

    it('returns a 4xx processing status as-is (rejected documents are a result, not an exception)', async () => {
        const st = () => new Response(JSON.stringify({ Code: 401, Description: 'Weryfikacja negatywna – dokument niezgodny ze schematem XSD' }), { status: 200 });
        const r = await submitToTestGateway(prepared, { fetchImpl: fakeFetch([], { '/Status/': st }), pollDelayMs: 0 });
        expect(r.status.code).toBe(401);
    });
});
