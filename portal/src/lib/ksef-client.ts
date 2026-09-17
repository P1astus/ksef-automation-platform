/**
 * KSeF 2.0 API client
 * API base: https://api-test.ksef.mf.gov.pl/v2  (test)
 *           https://api.ksef.mf.gov.pl/v2        (prod)
 *
 * Auth flow (token):
 *  1. GET  /security/public-key-certificates → find KsefTokenEncryption cert
 *  2. POST /auth/challenge → { challenge, timestampMs }
 *  3. XAdES sidecar: encrypt `token|timestampMs` with RSA-OAEP SHA-256
 *  4. POST /auth/ksef-token → { referenceNumber, authenticationToken }
 *  5. GET  /auth/{referenceNumber} (Bearer: authenticationToken) → poll until status.code 200
 *  6. POST /auth/token/redeem (Bearer: authenticationToken) → { accessToken, refreshToken }
 *  7. Use accessToken.token as Bearer for all subsequent calls
 */

export const BASE_URL = process.env.KSEF_ENVIRONMENT === 'prod'
    ? 'https://api.ksef.mf.gov.pl/v2'
    : 'https://api-test.ksef.mf.gov.pl/v2';

// Docker Compose's service name is "xades-sidecar" (hyphen) - the container
// also gets an underscored alias from its container_name, but Tomcat's
// embedded HTTP parser rejects any Host header containing an underscore
// with a 400 (confirmed live: curl -H "Host: xades_sidecar:8090" against
// the running container returns 400, curl -H "Host: xades-sidecar:8090"
// returns 200). Every real call through this file was hitting that 400 in
// the actual running docker-compose stack - `curl localhost:8090/...`
// worked in every prior verification because the Host header there is
// "localhost", never the underscored container hostname.
export const XADES_SIDECAR = process.env.XADES_SIDECAR_URL || 'http://xades-sidecar:8090';

// Round 4: the sidecar's crypto endpoints had no authentication at all and
// are published on 0.0.0.0:8090 - every request except /actuator/** now
// requires this header (see xades-sidecar's SidecarApiKeyFilter). Checked
// lazily, not at module load, for the same reason auth.ts's JWT_SECRET check
// is lazy - see that file's comment.
export function sidecarHeaders(): Record<string, string> {
    const apiKey = process.env.SIDECAR_API_KEY;
    if (!apiKey) {
        throw new Error('SIDECAR_API_KEY is not set. Refusing to call the XAdES sidecar: it requires this header on every request except /actuator/**.');
    }
    return { 'Content-Type': 'application/json', 'X-Sidecar-Api-Key': apiKey };
}

// GET /security/public-key-certificates returns certificates for two
// distinct purposes (confirmed against the real test API): KsefTokenEncryption
// for the auth flow's token encryption, SymmetricKeyEncryption for wrapping
// the AES key used to encrypt invoices in an online/batch session. They are
// different certificates - fetching without specifying which one silently
// picked KsefTokenEncryption (or data[0]), which is the wrong cert for
// opening an invoice-sending session.
export type CertificateUsage = 'KsefTokenEncryption' | 'SymmetricKeyEncryption';

// Cache public key certificates (valid for 1 hour), keyed by usage
const certCache = new Map<CertificateUsage, { certificate: string; ts: number }>();

export async function getPublicKeyCertificate(usage: CertificateUsage = 'KsefTokenEncryption'): Promise<string> {
    const now = Date.now();
    const cached = certCache.get(usage);
    if (cached && now - cached.ts < 3600_000) return cached.certificate;

    const res = await fetch(`${BASE_URL}/security/public-key-certificates`, {
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Failed to fetch KSeF public key certificates: ${res.status}`);
    const data: Array<{ certificate: string; usage: string[] }> = await res.json();

    const entry = data.find(c => c.usage?.includes(usage));
    if (!entry) throw new Error(`No ${usage} certificate found`);

    certCache.set(usage, { certificate: entry.certificate, ts: now });
    return entry.certificate;
}

export async function getChallenge(): Promise<{ challenge: string; timestamp: string; timestampMs: number }> {
    const res = await fetch(`${BASE_URL}/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`KSeF auth/challenge failed (${res.status}): ${body}`);
    }
    return res.json();
}

/**
 * Full token-based authentication flow.
 * Returns the Bearer accessToken to use for subsequent API calls.
 */
export async function initInteractiveSession(
    nip: string,
    tokenPlaintext: string
): Promise<string> {
    const [certificate, { challenge, timestampMs }] = await Promise.all([
        getPublicKeyCertificate('KsefTokenEncryption'),
        getChallenge(),
    ]);

    // XAdES sidecar encrypts `token|timestampMs` with RSA-OAEP SHA-256
    const encRes = await fetch(`${XADES_SIDECAR}/encrypt-for-session`, {
        method: 'POST',
        headers: sidecarHeaders(),
        body: JSON.stringify({
            token: tokenPlaintext,
            timestamp: String(timestampMs),   // pass as ms string — sidecar concatenates token|timestamp
            ksefPublicKeyPem: certificate,
        }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!encRes.ok) {
        const body = await encRes.text().catch(() => '');
        throw new Error(`XAdES encrypt-for-session failed (${encRes.status}): ${body}`);
    }
    const { encryptedToken } = await encRes.json();

    // Start authentication with KSeF token
    const authRes = await fetch(`${BASE_URL}/auth/ksef-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            challenge,
            contextIdentifier: { type: 'Nip', value: nip },
            encryptedToken,
        }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!authRes.ok) {
        const body = await authRes.text().catch(() => '');
        throw new Error(`KSeF auth/ksef-token failed (${authRes.status}): ${body}`);
    }
    const { referenceNumber, authenticationToken } = await authRes.json();
    const operationToken: string = authenticationToken?.token;
    if (!operationToken) throw new Error('KSeF: no authenticationToken in response');

    // Poll until auth completes (status.code === 200). Round 11 fix: this
    // used to fall through unconditionally once the loop exhausted its 10
    // attempts still "processing" (100-199) — the redeem call below would
    // then fail with a confusing "auth/token/redeem failed" instead of a
    // clear timeout, since nothing tracked whether a terminal status was
    // ever actually reached.
    let authenticated = false;
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 800));
        const statusRes = await fetch(`${BASE_URL}/auth/${referenceNumber}`, {
            headers: { 'Authorization': `Bearer ${operationToken}` },
            signal: AbortSignal.timeout(8000),
        });
        if (!statusRes.ok) continue;
        const { status } = await statusRes.json();
        if (status?.code === 200) { authenticated = true; break; }
        if (status?.code >= 400) throw new Error(`KSeF auth failed: ${status.description}`);
    }
    if (!authenticated) {
        throw new Error(`KSeF auth timed out: reference ${referenceNumber} never reached a terminal status after 10 polling attempts`);
    }

    // Redeem access token (can only be done once)
    const redeemRes = await fetch(`${BASE_URL}/auth/token/redeem`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${operationToken}`,
        },
        signal: AbortSignal.timeout(10_000),
    });
    if (!redeemRes.ok) {
        const body = await redeemRes.text().catch(() => '');
        throw new Error(`KSeF auth/token/redeem failed (${redeemRes.status}): ${body}`);
    }
    const { accessToken } = await redeemRes.json();
    const token: string = accessToken?.token;
    if (!token) throw new Error('KSeF: no accessToken in redeem response');
    return token;
}

/**
 * Terminate current session (DELETE /auth/sessions/current).
 * Non-critical — session expires on its own.
 */
export async function terminateSession(accessToken: string): Promise<void> {
    try {
        await fetch(`${BASE_URL}/auth/sessions/current`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(5000),
        });
    } catch {
        // Non-critical
    }
}

/**
 * Query invoice metadata.
 * Returns up to pageSize invoice metadata records for the given date range.
 */
export async function queryInvoices(
    accessToken: string,
    opts: {
        dateFrom: string;  // ISO date string
        dateTo: string;
        type?: 'Received' | 'Issued';
        pageOffset?: number;
        pageSize?: number;
    }
): Promise<{ invoices: unknown[]; hasMore: boolean; isTruncated: boolean }> {
    const body: Record<string, unknown> = {
        dateRange: { from: opts.dateFrom, to: opts.dateTo },
        pageSize: opts.pageSize ?? 100,
        pageOffset: opts.pageOffset ?? 0,
    };
    if (opts.type) body.type = opts.type;

    const res = await fetch(`${BASE_URL}/invoices/query/metadata?sortOrder=Asc`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`KSeF invoices/query/metadata failed (${res.status}): ${text}`);
    }
    return res.json();
}

const FA3_FORM_CODE = { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' };

/**
 * Opens a KSeF 2.0 "online session" (wysyłka interaktywna) for sending
 * single invoices — POST /sessions/online. Distinct from the auth flow's
 * accessToken: this returns a *session* referenceNumber that sendInvoice()
 * needs, plus the raw AES key/IV that encryptInvoiceForSession() needs for
 * every invoice sent within this session (the key is generated once, here,
 * and reused — KSeF's SendInvoiceRequest has no per-invoice IV field, so a
 * fresh key per invoice would be incompatible with the API's own contract).
 *
 * The raw key/IV live only in this Node process for the caller-managed
 * lifetime of the session (same trust boundary as the accessToken already
 * held across calls) — the actual AES-256-CBC/PKCS7 encryption still always
 * happens in the XAdES sidecar, never in the portal itself.
 */
export async function openOnlineSession(
    accessToken: string
): Promise<{ referenceNumber: string; validUntil: string; keyBase64: string; ivBase64: string }> {
    const symmetricKeyCert = await getPublicKeyCertificate('SymmetricKeyEncryption');

    const keyRes = await fetch(`${XADES_SIDECAR}/generate-session-key`, {
        method: 'POST',
        headers: sidecarHeaders(),
        body: JSON.stringify({ ksefPublicKeyPem: symmetricKeyCert }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!keyRes.ok) {
        const body = await keyRes.text().catch(() => '');
        throw new Error(`XAdES generate-session-key failed (${keyRes.status}): ${body}`);
    }
    const { keyBase64, ivBase64, encryptedKeyBase64 } = await keyRes.json();

    const openRes = await fetch(`${BASE_URL}/sessions/online`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            formCode: FA3_FORM_CODE,
            encryption: {
                encryptedSymmetricKey: encryptedKeyBase64,
                initializationVector: ivBase64,
            },
        }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!openRes.ok) {
        const body = await openRes.text().catch(() => '');
        throw new Error(`KSeF sessions/online (open) failed (${openRes.status}): ${body}`);
    }
    const { referenceNumber, validUntil } = await openRes.json();
    if (!referenceNumber) throw new Error('KSeF: no referenceNumber in sessions/online response');

    return { referenceNumber, validUntil, keyBase64, ivBase64 };
}

/**
 * Encrypts one invoice XML for sending within an already-open online
 * session, using that session's key/IV (from openOnlineSession above).
 * Per the vendored spec (ksef-openapi.json: SendInvoiceRequest.
 * encryptedInvoiceContent) this is AES-256-CBC with PKCS#7 padding — NOT
 * AES-256-GCM. Earlier notes in this codebase (CLAUDE.md, HANDOVER.md,
 * FIXES-2026-09-13.md) assumed GCM; the vendored spec has zero occurrences
 * of "GCM" anywhere, and both the online-session and batch-session flows
 * use CBC+PKCS7 — confirmed by grepping ksef-openapi.json directly rather
 * than trusting the earlier assumption.
 */
export async function encryptInvoiceForSession(
    invoiceXml: string,
    keyBase64: string,
    ivBase64: string
): Promise<{
    invoiceHash: string;
    invoiceSize: number;
    encryptedInvoiceHash: string;
    encryptedInvoiceSize: number;
    encryptedInvoiceContent: string;
}> {
    const res = await fetch(`${XADES_SIDECAR}/encrypt-invoice`, {
        method: 'POST',
        headers: sidecarHeaders(),
        body: JSON.stringify({ invoiceXml, keyBase64, ivBase64 }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`XAdES encrypt-invoice failed (${res.status}): ${body}`);
    }
    return res.json();
}

/**
 * Closes an online session — POST /sessions/online/{referenceNumber}/close.
 * Distinct from terminateSession() (DELETE /auth/sessions/current), which
 * ends the *authentication* session, not the invoice-sending one. Both
 * should be cleaned up; a session left open simply expires at validUntil.
 */
export async function closeOnlineSession(accessToken: string, referenceNumber: string): Promise<void> {
    try {
        await fetch(`${BASE_URL}/sessions/online/${referenceNumber}/close`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(8000),
        });
    } catch {
        // Non-critical — the session expires on its own at validUntil.
    }
}

/**
 * Send an invoice within an already-open online session (see
 * openOnlineSession + encryptInvoiceForSession above). KSeF 2.0 requires
 * the invoice body encrypted with the session's key before this call.
 */
export interface SessionInvoiceStatus {
    ordinalNumber: number;
    invoiceNumber?: string;
    ksefNumber?: string;
    referenceNumber: string;
    invoiceHash: string;
    acquisitionDate?: string;
    invoicingDate?: string;
    permanentStorageDate?: string;
    upoDownloadUrl?: string;
    upoDownloadUrlExpirationDate?: string;
    status: { code: number; description: string };
}

/**
 * Polls the status of every invoice submitted in an online session —
 * GET /sessions/{referenceNumber}/invoices. KSeF processes submitted
 * invoices asynchronously: right after sendInvoice() returns, an invoice
 * typically hasn't yet been assigned its permanent ksefNumber or a
 * upoDownloadUrl — both only appear here once status.code reaches a
 * terminal value (200 = success; >=400 = a real failure, e.g. 440
 * "Duplikat faktury" — see ksef-openapi.json's example). pageSize is
 * generous (an online session realistically holds a handful of invoices
 * per client, not thousands) so this one call covers the whole session
 * without needing the continuation-token pagination the endpoint also
 * supports.
 */
export async function getSessionInvoiceStatus(
    accessToken: string,
    referenceNumber: string
): Promise<SessionInvoiceStatus[]> {
    const res = await fetch(`${BASE_URL}/sessions/${referenceNumber}/invoices?pageSize=100`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`KSeF sessions/{ref}/invoices failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return data.invoices ?? [];
}

/**
 * Downloads the UPO (Urzędowe Poświadczenie Odbioru — the legal
 * proof-of-receipt KSeF issues per invoice) from the pre-signed
 * `upoDownloadUrl` a terminal-status entry from getSessionInvoiceStatus()
 * carries. The URL is a self-authorizing SAS link (no Bearer header) but
 * time-limited — download promptly and persist the content, don't just
 * store the URL.
 */
export async function downloadUpo(upoDownloadUrl: string): Promise<{ xml: string; hash: string | null }> {
    const res = await fetch(upoDownloadUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
        throw new Error(`UPO download failed (${res.status})`);
    }
    return { xml: await res.text(), hash: res.headers.get('x-ms-meta-hash') };
}

/**
 * Authenticated fallback for when the pre-signed upoDownloadUrl from
 * getSessionInvoiceStatus() has already expired (a few days in the vendored
 * spec's own example) before it was ever fetched — GET
 * /sessions/{referenceNumber}/invoices/ksef/{ksefNumber}/upo re-serves the
 * same UPO XML given the *online session's* reference number (not the
 * invoice's permanent ksefNumber alone) and a valid Bearer token. Requires a
 * fresh accessToken — session-scoped tokens don't outlive the session that
 * likely closed right after the original send.
 */
export async function downloadUpoByKsefNumber(
    accessToken: string,
    sessionReferenceNumber: string,
    ksefNumber: string
): Promise<{ xml: string; hash: string | null }> {
    const res = await fetch(`${BASE_URL}/sessions/${sessionReferenceNumber}/invoices/ksef/${ksefNumber}/upo`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`UPO retry download failed (${res.status}): ${body}`);
    }
    return { xml: await res.text(), hash: res.headers.get('x-ms-meta-hash') };
}

export async function sendInvoice(
    accessToken: string,
    sessionReferenceNumber: string,
    encryptedPayload: {
        invoiceHash: string;
        invoiceSize: number;
        encryptedInvoiceHash: string;
        encryptedInvoiceSize: number;
        encryptedInvoiceContent: string;
    }
): Promise<string> {
    const res = await fetch(`${BASE_URL}/sessions/online/${sessionReferenceNumber}/invoices`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ ...encryptedPayload, offlineMode: false }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`KSeF sessions/invoices failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return data.referenceNumber as string;
}
