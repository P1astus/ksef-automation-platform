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

const XADES_SIDECAR = process.env.XADES_SIDECAR_URL || 'http://xades_sidecar:8090';

// Cache public key certificate (valid for 1 hour)
let cachedCert: string | null = null;
let cachedCertTs = 0;

export async function getPublicKeyCertificate(): Promise<string> {
    const now = Date.now();
    if (cachedCert && now - cachedCertTs < 3600_000) return cachedCert;

    const res = await fetch(`${BASE_URL}/security/public-key-certificates`, {
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Failed to fetch KSeF public key certificates: ${res.status}`);
    const data: Array<{ certificate: string; usage: string[] }> = await res.json();

    // Find the certificate intended for token encryption
    const entry = data.find(c => c.usage?.includes('KsefTokenEncryption')) ?? data[0];
    if (!entry) throw new Error('No KsefTokenEncryption certificate found');

    cachedCert = entry.certificate;
    cachedCertTs = now;
    return cachedCert as string;
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
        getPublicKeyCertificate(),
        getChallenge(),
    ]);

    // XAdES sidecar encrypts `token|timestampMs` with RSA-OAEP SHA-256
    const encRes = await fetch(`${XADES_SIDECAR}/encrypt-for-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    // Poll until auth completes (status.code === 200)
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 800));
        const statusRes = await fetch(`${BASE_URL}/auth/${referenceNumber}`, {
            headers: { 'Authorization': `Bearer ${operationToken}` },
            signal: AbortSignal.timeout(8000),
        });
        if (!statusRes.ok) continue;
        const { status } = await statusRes.json();
        if (status?.code === 200) break;
        if (status?.code >= 400) throw new Error(`KSeF auth failed: ${status.description}`);
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

/**
 * Send an invoice (KSeF 2.0 — invoice must be encrypted).
 * In KSeF 2.0, invoices are encrypted with AES-256-GCM;
 * the session referenceNumber comes from the auth flow.
 * This is a placeholder — full encryption requires XAdES sidecar support.
 */
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
