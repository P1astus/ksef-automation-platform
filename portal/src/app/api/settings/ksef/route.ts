import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { XADES_SIDECAR } from '@/lib/ksef-client';

// Simple reversible obfuscation for storing tokens
// In production, replace with proper encryption (e.g. AES-256-GCM with KMS)
function mask(value: string): string {
    return Buffer.from(value).toString('base64');
}
function unmask(value: string): string {
    return Buffer.from(value, 'base64').toString('utf8');
}
function maskDisplay(value: string): string {
    if (!value || value.length < 8) return '••••••••';
    return value.slice(0, 4) + '••••••••' + value.slice(-4);
}

// clients.auth_method's CHECK constraint only allows 'token'/'certificate';
// this route's own API contract (and the settings page frontend) uses
// 'token'/'cert'. Translate DB -> API here so the two vocabularies stay in
// exactly one place instead of drifting the way ksef_auth_method did.
function dbAuthMethodToApi(dbValue: string | null): 'token' | 'cert' {
    return dbValue === 'certificate' ? 'cert' : 'token';
}

export async function GET(request: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const clientId = searchParams.get('client_id');

        if (clientId) {
            // Single client config
            const res = await query(
                `SELECT id, nip, client_name, auth_method, ksef_token_encrypted
                 FROM clients WHERE id = $1 AND firm_id = $2`,
                [clientId, session.firmId]
            );
            if (!res.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
            const row = res.rows[0];
            return NextResponse.json({
                id: row.id,
                nip: row.nip,
                client_name: row.client_name,
                auth_method: dbAuthMethodToApi(row.auth_method),
                has_token: !!row.ksef_token_encrypted,
                token_masked: row.ksef_token_encrypted
                    ? maskDisplay(unmask(row.ksef_token_encrypted))
                    : null,
            });
        }

        // All clients for this firm
        const res = await query(
            `SELECT id, nip, client_name, auth_method, ksef_token_encrypted
             FROM clients WHERE firm_id = $1 ORDER BY client_name`,
            [session.firmId]
        );

        return NextResponse.json({
            clients: res.rows.map(row => ({
                id: row.id,
                nip: row.nip,
                client_name: row.client_name,
                auth_method: dbAuthMethodToApi(row.auth_method),
                has_token: !!row.ksef_token_encrypted,
            })),
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        // Saving a client's KSeF token/certificate is the most sensitive
        // action in the system — restrict it to the firm owner/admin.
        const roleError = await requireRole(session, ['owner', 'admin']);
        if (roleError) return roleError;

        const contentType = request.headers.get('content-type') || '';
        let client_id: string, auth_method: string, token: string | undefined;
        let certBase64: string | undefined, certPassword: string | undefined;

        if (contentType.includes('multipart/form-data')) {
            const form = await request.formData();
            client_id = form.get('client_id') as string;
            auth_method = form.get('auth_method') as string;
            certPassword = form.get('cert_password') as string;
            const certFile = form.get('cert') as File | null;
            if (certFile) {
                const buf = await certFile.arrayBuffer();
                certBase64 = Buffer.from(buf).toString('base64');
            }
        } else {
            const body = await request.json();
            client_id = body.client_id;
            auth_method = body.auth_method;
            token = body.token;
        }

        if (!client_id) return NextResponse.json({ error: 'Brak client_id' }, { status: 400 });

        // Verify client belongs to this firm
        const check = await query(
            'SELECT id, nip FROM clients WHERE id = $1 AND firm_id = $2',
            [client_id, session.firmId]
        );
        if (!check.rows[0]) return NextResponse.json({ error: 'Klient nie znaleziony' }, { status: 404 });

        if (auth_method === 'token') {
            if (!token?.trim()) return NextResponse.json({ error: 'Podaj token KSeF' }, { status: 400 });
            await query(
                'UPDATE clients SET auth_method = $1, ksef_token_encrypted = $2 WHERE id = $3',
                ['token', mask(token.trim()), client_id]
            );
        } else if (auth_method === 'cert') {
            if (!certBase64) return NextResponse.json({ error: 'Brak pliku certyfikatu' }, { status: 400 });
            if (!certPassword) return NextResponse.json({ error: 'Podaj hasło certyfikatu' }, { status: 400 });
            // Store cert as base64 and password encrypted — the XAdES sidecar handles the actual signing.
            // DB column's CHECK constraint requires 'certificate', not this route's own 'cert' - see
            // dbAuthMethodToApi() for the reverse translation on read.
            const certData = JSON.stringify({ cert: certBase64, password: mask(certPassword) });
            await query(
                'UPDATE clients SET auth_method = $1, ksef_token_encrypted = $2 WHERE id = $3',
                ['certificate', mask(certData), client_id]
            );
        } else {
            return NextResponse.json({ error: 'Nieznana metoda uwierzytelniania' }, { status: 400 });
        }

        // Test connection by pinging the XAdES sidecar health endpoint
        let connectionOk = false;
        let connectionMsg = 'Nie można połączyć się z serwisem KSeF';
        try {
            const ping = await fetch(`${XADES_SIDECAR}/actuator/health`, {
                signal: AbortSignal.timeout(3000),
            });
            connectionOk = ping.ok;
            connectionMsg = ping.ok ? 'Połączenie z serwisem OK' : 'Serwis KSeF niedostępny';
        } catch {
            connectionMsg = 'Serwis XAdES niedostępny (token zapisany)';
        }

        return NextResponse.json({
            success: true,
            connectionOk,
            connectionMsg,
            message: auth_method === 'cert' ? 'Certyfikat PKCS12 zapisany pomyślnie' : 'Token KSeF zapisany pomyślnie',
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
