import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { BASE_URL, getPublicKeyCertificate, getChallenge, sidecarHeaders } from '@/lib/ksef-client';
import { clientCredentialContext, decryptSecret } from '@/lib/credential-crypto';

// Dev-only diagnostic endpoint — blocked in production
export async function GET(request: Request) {
    if (process.env.KSEF_ENVIRONMENT === 'prod') {
        return NextResponse.json({ error: 'Disabled in production' }, { status: 403 });
    }

    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    const XADES = process.env.XADES_SIDECAR_URL || 'http://localhost:8090';
    const result: Record<string, unknown> = { baseUrl: BASE_URL, xadesSidecarUrl: XADES };

    // Step 1 — fetch KSeF public key certificate
    try {
        const cert = await getPublicKeyCertificate();
        result.publicKey = { ok: true, certLength: cert.length, preview: cert.slice(0, 60) + '...' };
    } catch (e: any) {
        result.publicKey = { ok: false, error: e.message };
    }

    // Step 2 — get challenge
    let challengeData: { challenge: string; timestamp: string; timestampMs: number } | null = null;
    try {
        challengeData = await getChallenge();
        result.challenge = {
            ok: true,
            challenge: challengeData.challenge?.slice(0, 40) + '...',
            timestampMs: challengeData.timestampMs,
        };
    } catch (e: any) {
        result.challenge = { ok: false, error: e.message };
    }

    // Step 3 — ping XAdES sidecar health
    try {
        const res = await fetch(`${XADES}/actuator/health`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        result.xadesSidecar = { ok: true, status: data.status };
    } catch (e: any) {
        result.xadesSidecar = { ok: false, error: e.message };
    }

    // Step 4 — try full session init if client has a token
    let accessToken: string | null = null;
    if (clientId) {
        try {
            // Round 11 fix: this queried a column that has never existed
            // (ksef_auth_method) — the real column is auth_method, and its
            // stored value for certificate auth is 'certificate', not 'cert'
            // (see settings/ksef/route.ts's dbAuthMethodToApi() — this route
            // missed the same round-3 fix). Passing ?clientId= always threw
            // inside the surrounding try/catch, so this diagnostic could
            // never actually confirm a working session for any client.
            const cr = await query(
                'SELECT nip, ksef_token_encrypted, auth_method FROM clients WHERE id = $1 AND firm_id = $2',
                [clientId, session.firmId]
            );
            const client = cr.rows[0];
            if (!client?.ksef_token_encrypted) {
                result.sessionInit = { ok: false, error: 'No token stored for this client' };
            } else if (client.auth_method === 'certificate') {
                result.sessionInit = { ok: false, error: 'Cert auth — session init test not supported here' };
            } else {
                const tokenPlaintext = decryptSecret(client.ksef_token_encrypted, clientCredentialContext(clientId));
                const cert = await getPublicKeyCertificate();
                const ch = await getChallenge();

                // Ask XAdES sidecar to encrypt token|timestampMs
                const encRes = await fetch(`${XADES}/encrypt-for-session`, {
                    method: 'POST',
                    headers: sidecarHeaders(),
                    body: JSON.stringify({
                        token: tokenPlaintext,
                        timestamp: ch.timestamp,   // ISO-8601: the sidecar Instant.parse()s it and derives the epoch ms itself
                        ksefPublicKeyPem: cert,
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                if (!encRes.ok) throw new Error(`XAdES encrypt failed: HTTP ${encRes.status}: ${await encRes.text()}`);
                const { encryptedToken } = await encRes.json();

                // Authenticate
                const authRes = await fetch(`${BASE_URL}/auth/ksef-token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        challenge: ch.challenge,
                        contextIdentifier: { type: 'Nip', value: client.nip },
                        encryptedToken,
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                if (!authRes.ok) {
                    const body = await authRes.text();
                    throw new Error(`auth/ksef-token HTTP ${authRes.status}: ${body.slice(0, 200)}`);
                }
                const { referenceNumber, authenticationToken } = await authRes.json();
                const opToken: string = authenticationToken?.token;
                if (!opToken) throw new Error('No authenticationToken in response');

                // Poll auth status
                let authStatus = 0;
                for (let i = 0; i < 10; i++) {
                    await new Promise(r => setTimeout(r, 800));
                    const sr = await fetch(`${BASE_URL}/auth/${referenceNumber}`, {
                        headers: { 'Authorization': `Bearer ${opToken}` },
                        signal: AbortSignal.timeout(8000),
                    });
                    if (!sr.ok) continue;
                    const sd = await sr.json();
                    authStatus = sd.status?.code;
                    if (authStatus === 200 || authStatus >= 400) break;
                }
                if (authStatus !== 200) throw new Error(`Auth status: ${authStatus} (expected 200)`);

                // Redeem access token
                const redeemRes = await fetch(`${BASE_URL}/auth/token/redeem`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${opToken}`,
                    },
                    signal: AbortSignal.timeout(10000),
                });
                if (!redeemRes.ok) {
                    const body = await redeemRes.text();
                    throw new Error(`auth/token/redeem HTTP ${redeemRes.status}: ${body.slice(0, 200)}`);
                }
                const { accessToken: at } = await redeemRes.json();
                accessToken = at?.token;
                if (!accessToken) throw new Error('No accessToken in redeem response');
                result.sessionInit = { ok: true, accessToken: (accessToken as string).slice(0, 30) + '...' };
            }
        } catch (e: any) {
            result.sessionInit = { ok: false, error: e.message };
        }

        // Step 5 — terminate session if we got one
        if (accessToken) {
            try {
                const termRes = await fetch(`${BASE_URL}/auth/sessions/current`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    signal: AbortSignal.timeout(5000),
                });
                result.sessionEnd = { ok: termRes.ok || termRes.status === 204, status: termRes.status };
            } catch (e: any) {
                result.sessionEnd = { ok: false, error: e.message };
            }
        }
    } else {
        result.sessionInit = { ok: null, note: 'Pass ?clientId=N to test full session flow' };
        result.sessionEnd  = { ok: null, note: 'Pass ?clientId=N to test full session flow' };
    }

    // Summary
    const steps = [result.publicKey, result.challenge, result.xadesSidecar, result.sessionInit, result.sessionEnd]
        .filter((s: any) => s?.ok !== null && s?.ok !== undefined);
    const allOk = steps.every((s: any) => s.ok === true);
    result.summary = allOk ? '✓ All checks passed' : '✗ Some checks failed — see above';

    return NextResponse.json(result, { status: 200 });
}
