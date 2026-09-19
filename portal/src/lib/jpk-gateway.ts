// Client for the Ministry of Finance JPK upload gateway (e-dokumenty), the
// service JPK_V7M(3) files are submitted through. Protocol per "Specyfikacja
// interfejsów usług JPK" v5.2/5.6: compress -> encrypt -> InitUploadSigned ->
// Put Blob to Azure storage -> FinishUpload -> Status (UPO).
//
// TEST ENVIRONMENT ONLY, on purpose: there is no production URL in this file.
// A production submission is a legal filing on behalf of a taxpayer and needs
// that taxpayer's authorisation (qualified/trusted signature on the metadata,
// or authorisation data with their real prior-year revenue) - it is a decision
// for the operator, not something to make reachable by a config flag.
//
// Pure Node crypto/zlib, no dependencies. `fetch` is injectable for tests.

import { createCipheriv, createHash, publicEncrypt, randomBytes, constants, X509Certificate } from 'crypto';
import { deflateRawSync } from 'zlib';

export const JPK_GATEWAY_TEST_URL = 'https://test-e-dokumenty.mf.gov.pl';
// The spec lists the storage accounts; a returned upload URL that isn't one of
// them is not followed (the URL comes from a server response).
const TEST_STORAGE_RE = /^https:\/\/taxdocumentstorage\d{2}tst\.blob\.core\.windows\.net\//;
const MAX_PART_BYTES = 60 * 1024 * 1024;
const INIT_UPLOAD_VERSION = '01.02.01.20160617';
const NS = 'http://e-dokumenty.mf.gov.pl';

export class JpkGatewayError extends Error {
    constructor(message: string, public readonly detail?: unknown) {
        super(message);
        this.name = 'JpkGatewayError';
    }
}

export interface AuthData {
    // Exactly one of nip / pesel.
    nip?: string;
    pesel?: string;
    firstName: string;
    lastName: string;
    birthDate: string; // YYYY-MM-DD
    // Revenue shown in the return for the tax year two years before the filing year.
    amount: number;
}

// ---- ZIP (single stored entry, DEFLATE) ------------------------------------

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with one DEFLATE-compressed file - what the gateway requires (no split/multipart). */
export function zipSingleFile(name: string, data: Buffer): Buffer {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // UTF-8 names
    local.writeUInt16LE(8, 8);        // DEFLATE
    local.writeUInt16LE(0, 10);       // time
    local.writeUInt16LE(0x21, 12);    // date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 42);     // local header offset
    const localPart = Buffer.concat([local, nameBuf, comp]);
    const centralPart = Buffer.concat([central, nameBuf]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralPart.length, 12);
    eocd.writeUInt32LE(localPart.length, 16);
    return Buffer.concat([localPart, centralPart, eocd]);
}

// ---- Preparation -------------------------------------------------------------

function aesCbc(data: Buffer, key: Buffer, iv: Buffer): Buffer {
    const c = createCipheriv('aes-256-cbc', key, iv); // PKCS#7 padding is the default
    return Buffer.concat([c.update(data), c.final()]);
}

const b64 = (b: Buffer) => b.toString('base64');
const md5 = (b: Buffer) => createHash('md5').update(b).digest('base64');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('base64');
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SIG-2008 "DaneAutoryzujace" document (authorisation by amount). */
export function buildAuthDataXml(a: AuthData): string {
    if (!!a.nip === !!a.pesel) throw new JpkGatewayError('AuthData needs exactly one of nip / pesel');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.birthDate)) throw new JpkGatewayError('AuthData birthDate must be YYYY-MM-DD');
    if (!Number.isFinite(a.amount) || a.amount < 0) throw new JpkGatewayError('AuthData amount must be a non-negative number');
    return `<?xml version="1.0" encoding="UTF-8"?>
<podp:DaneAutoryzujace xmlns:podp="http://e-deklaracje.mf.gov.pl/Repozytorium/Definicje/Podpis/">
   ${a.nip ? `<podp:NIP>${xmlEsc(a.nip)}</podp:NIP>` : `<podp:PESEL>${xmlEsc(a.pesel!)}</podp:PESEL>`}
   <podp:ImiePierwsze>${xmlEsc(a.firstName)}</podp:ImiePierwsze>
   <podp:Nazwisko>${xmlEsc(a.lastName)}</podp:Nazwisko>
   <podp:DataUrodzenia>${a.birthDate}</podp:DataUrodzenia>
   <podp:Kwota>${a.amount.toFixed(2)}</podp:Kwota>
</podp:DaneAutoryzujace>`;
}

export interface PreparedUpload {
    initUploadXml: string;
    // Encrypted parts to PUT, in order, with the name and MD5 declared for each.
    parts: Array<{ fileName: string; data: Buffer; md5: string }>;
}

export interface PrepareInput {
    xml: string;                 // the JPK_V7M(3) document
    fileName: string;            // e.g. JPK_V7M_1234567890_2026-02.xml  ([a-zA-Z0-9_.-]{5,55})
    certificate: string | Buffer; // MF public-key certificate (test), PEM or DER - encrypts the AES key
    authData?: AuthData;         // authorisation by amount; omit if the metadata is signed instead
    // Test hooks (random by default).
    key?: Buffer;
    iv?: Buffer;
}

/**
 * Compresses, encrypts and describes a JPK file. Pure - no network. The
 * returned metadata is the (unsigned) InitUpload document; when no AuthData is
 * given the caller must sign it (XAdES-BES) before sending.
 */
export function prepareJpkUpload(input: PrepareInput): PreparedUpload {
    if (!/^[a-zA-Z0-9_.-]{5,55}$/.test(input.fileName)) throw new JpkGatewayError(`invalid file name: ${input.fileName}`);
    const xmlBuf = Buffer.from(input.xml, 'utf8');
    const key = input.key ?? randomBytes(32);
    const iv = input.iv ?? randomBytes(16);
    if (key.length !== 32 || iv.length !== 16) throw new JpkGatewayError('AES-256 key needs 32 bytes and IV 16');

    const zip = zipSingleFile(input.fileName, xmlBuf);
    const chunks: Buffer[] = [];
    for (let off = 0; off < zip.length; off += MAX_PART_BYTES) chunks.push(zip.subarray(off, off + MAX_PART_BYTES));
    const single = chunks.length === 1;
    const parts = chunks.map((chunk, i) => {
        const data = aesCbc(chunk, key, iv);
        const fileName = single ? `${input.fileName}.zip.aes` : `${input.fileName}.zip.${String(i + 1).padStart(3, '0')}.aes`;
        return { fileName, data, md5: md5(data) };
    });

    const encryptedKey = publicEncrypt(
        { key: new X509Certificate(input.certificate).publicKey, padding: constants.RSA_PKCS1_PADDING },
        key
    );

    const authXml = input.authData ? `\n  <AuthData>${b64(aesCbc(Buffer.from(buildAuthDataXml(input.authData), 'utf8'), key, iv))}</AuthData>` : '';
    const initUploadXml = `<?xml version="1.0" encoding="utf-8"?>
<InitUpload xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="${NS}">
  <DocumentType>JPK</DocumentType>
  <Version>${INIT_UPLOAD_VERSION}</Version>
  <EncryptionKey algorithm="RSA" mode="ECB" padding="PKCS#1" encoding="Base64">${b64(encryptedKey)}</EncryptionKey>
  <DocumentList>
    <Document>
      <FormCode systemCode="JPK_V7M (3)" schemaVersion="1-0E">JPK_VAT</FormCode>
      <FileName>${xmlEsc(input.fileName)}</FileName>
      <ContentLength>${xmlBuf.length}</ContentLength>
      <HashValue algorithm="SHA-256" encoding="Base64">${sha256(xmlBuf)}</HashValue>
      <FileSignatureList filesNumber="${parts.length}">
        <Packaging>
          <SplitZip type="split" mode="zip" />
        </Packaging>
        <Encryption>
          <AES size="256" block="16" mode="CBC" padding="PKCS#7">
            <IV bytes="16" encoding="Base64">${b64(iv)}</IV>
          </AES>
        </Encryption>
${parts.map((p, i) => `        <FileSignature>
          <OrdinalNumber>${i + 1}</OrdinalNumber>
          <FileName>${xmlEsc(p.fileName)}</FileName>
          <ContentLength>${p.data.length}</ContentLength>
          <HashValue algorithm="MD5" encoding="Base64">${p.md5}</HashValue>
        </FileSignature>`).join('\n')}
      </FileSignatureList>
    </Document>
  </DocumentList>${authXml}
</InitUpload>`;
    return { initUploadXml, parts };
}

// ---- Transport -------------------------------------------------------------

type FetchFn = typeof fetch;

export interface GatewayStatus {
    code: number;
    description: string;
    details?: string;
    upo?: string;
}

export interface SubmitResult {
    referenceNumber: string;
    status: GatewayStatus;
}

async function readJson(res: Response): Promise<any> {
    const text = await res.text();
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

/** Sends a prepared upload to the TEST gateway and polls Status until it is final (or attempts run out). */
export async function submitToTestGateway(
    prepared: PreparedUpload,
    opts: { signedInitUploadXml?: string; fetchImpl?: FetchFn; pollAttempts?: number; pollDelayMs?: number } = {}
): Promise<SubmitResult> {
    const f = opts.fetchImpl ?? fetch;
    const base = JPK_GATEWAY_TEST_URL;

    const init = await f(`${base}/api/Storage/InitUploadSigned`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: opts.signedInitUploadXml ?? prepared.initUploadXml,
    });
    const initBody = await readJson(init);
    if (!init.ok) throw new JpkGatewayError(`InitUploadSigned ${init.status}: ${initBody.Message ?? JSON.stringify(initBody)}`, initBody);

    const referenceNumber: string = initBody.ReferenceNumber;
    const uploads: any[] = initBody.RequestToUploadFileList ?? [];
    if (!referenceNumber || uploads.length !== prepared.parts.length) {
        throw new JpkGatewayError('InitUploadSigned returned an unexpected upload list', initBody);
    }

    for (const u of uploads) {
        const part = prepared.parts.find(p => p.fileName === u.FileName);
        if (!part) throw new JpkGatewayError(`gateway asked for unknown part ${u.FileName}`, u);
        if (!TEST_STORAGE_RE.test(String(u.Url))) throw new JpkGatewayError(`refusing to upload to an unexpected host: ${u.Url}`);
        const headers: Record<string, string> = {};
        for (const h of u.HeaderList ?? []) headers[h.Key] = h.Value;
        const put = await f(u.Url, { method: u.Method || 'PUT', headers, body: new Uint8Array(part.data) });
        if (put.status !== 201) throw new JpkGatewayError(`Put Blob ${put.status}: ${await put.text()}`);
    }

    const fin = await f(`${base}/api/Storage/FinishUpload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ReferenceNumber: referenceNumber, AzureBlobNameList: uploads.map(u => u.BlobName) }),
    });
    if (!fin.ok) {
        const b = await readJson(fin);
        throw new JpkGatewayError(`FinishUpload ${fin.status}: ${b.Message ?? JSON.stringify(b)}`, b);
    }

    let status: GatewayStatus = { code: 0, description: 'not polled' };
    const attempts = opts.pollAttempts ?? 20;
    for (let i = 0; i < attempts; i++) {
        const s = await f(`${base}/api/Storage/Status/${referenceNumber}`);
        const b = await readJson(s);
        if (!s.ok) throw new JpkGatewayError(`Status ${s.status}: ${b.Message ?? JSON.stringify(b)}`, b);
        status = { code: Number(b.Code), description: String(b.Description ?? ''), details: b.Details, upo: b.Upo };
        // 1xx = session state, 3xx = still processing; 2xx success, 4xx rejected are final.
        if (status.code >= 200 && status.code < 300) break;
        if (status.code >= 400) break;
        if (i < attempts - 1) await new Promise(r => setTimeout(r, opts.pollDelayMs ?? 3000));
    }
    return { referenceNumber, status };
}
