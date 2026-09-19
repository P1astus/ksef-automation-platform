import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { requireActiveSubscription } from '@/lib/entitlements';
import { query } from '@/lib/db';
import { JpkGatewayError, prepareJpkUpload, signInitUploadWithSidecar, submitToTestGateway } from '@/lib/jpk-gateway';

// This switch is intentionally server-only and false unless explicitly set.
// It does not select a URL: the gateway client contains only the MF TEST URL.
export const isJpkTestGatewayEnabled = () => process.env.JPK_TEST_GATEWAY_ENABLED === 'true';

function gatewayStatus(code: number): 'processing' | 'accepted' | 'rejected' {
    if (code >= 200 && code < 300) return 'accepted';
    if (code >= 400) return 'rejected';
    return 'processing';
}

function failureMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientNip = new URL(request.url).searchParams.get('clientNip');
    const res = await query(
        `SELECT id, client_nip, period, reference_number, status, gateway_code, gateway_description,
                gateway_details, created_at, completed_at
         FROM jpk_test_submissions
         WHERE firm_id = $1 ${clientNip ? 'AND client_nip = $2' : ''}
         ORDER BY created_at DESC LIMIT 20`,
        clientNip ? [session.firmId, clientNip] : [session.firmId]
    );
    return NextResponse.json({ enabled: isJpkTestGatewayEnabled(), submissions: res.rows });
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const planError = await requireActiveSubscription(session.firmId);
    if (planError) return planError;
    if (!isJpkTestGatewayEnabled()) {
        return NextResponse.json({ error: 'Wysyłka do bramki testowej MF jest wyłączona.' }, { status: 403 });
    }
    const certificatePem = process.env.JPK_TEST_GATEWAY_CERTIFICATE_PEM;
    const certificateBase64 = process.env.JPK_TEST_GATEWAY_CERTIFICATE_BASE64;
    if (!certificatePem && !certificateBase64) {
        return NextResponse.json({ error: 'Brakuje publicznego certyfikatu szyfrowania bramki testowej MF w konfiguracji serwera.' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const clientNip = typeof body.clientNip === 'string' ? body.clientNip : '';
    const period = typeof body.period === 'string' ? body.period : '';
    if (!clientNip || !/^\d{4}-\d{2}$/.test(period)) {
        return NextResponse.json({ error: 'Wymagane pola: clientNip, period (YYYY-MM)' }, { status: 400 });
    }

    // Never generate a report as a hidden side effect of sending. The operator
    // first creates/reviews the exact XML, which is then read only from this
    // firm-scoped history row.
    const preparation = await query(
        `SELECT export_data FROM jpk_preparations
         WHERE firm_id = $1 AND client_nip = $2 AND period = $3`,
        [session.firmId, clientNip, period]
    );
    const xml = preparation.rows[0]?.export_data;
    if (typeof xml !== 'string' || !xml.trim()) {
        return NextResponse.json({ error: 'Najpierw wygeneruj JPK_V7M dla wybranego klienta i okresu.' }, { status: 409 });
    }

    // The flag never makes taxpayer credentials or AuthData reachable. Signed
    // metadata uses only the sidecar's already-configured server-side TEST key.
    const requestedBy = session.userId == null ? session.adminEmail : `user:${session.userId}`;
    const inserted = await query(
        `INSERT INTO jpk_test_submissions (firm_id, client_nip, period, requested_by, status)
         VALUES ($1, $2, $3, $4, 'submitting') RETURNING id`,
        [session.firmId, clientNip, period, requestedBy]
    );
    const submissionId = inserted.rows[0]?.id;
    if (!submissionId) throw new Error('Nie utworzono wpisu audytowego wysyłki testowej JPK.');

    try {
        const prepared = prepareJpkUpload({
            xml,
            fileName: `JPK_V7M_${clientNip}_${period}.xml`,
            // The public TEST encryption certificate must be explicitly
            // configured with the flag; it is not a taxpayer certificate.
            certificate: certificatePem || Buffer.from(certificateBase64!, 'base64'),
        });
        const signed = await signInitUploadWithSidecar(prepared.initUploadXml);
        const result = await submitToTestGateway(prepared, { signedInitUploadXml: signed });
        const status = gatewayStatus(result.status.code);
        await query(
            `UPDATE jpk_test_submissions
             SET reference_number = $1, status = $2, gateway_code = $3, gateway_description = $4,
                 gateway_details = $5, gateway_upo = $6, completed_at = NOW()
             WHERE id = $7 AND firm_id = $8`,
            [result.referenceNumber, status, result.status.code, result.status.description,
                result.status.details ?? null, result.status.upo ?? null, submissionId, session.firmId]
        );
        return NextResponse.json({ submission: { id: submissionId, referenceNumber: result.referenceNumber, status, ...result.status } });
    } catch (err) {
        const message = failureMessage(err);
        // A rejection from the gateway must be visible and durable. This write
        // is intentionally not best-effort: losing it would be a silent audit
        // failure after an operator initiated an external submission.
        await query(
            `UPDATE jpk_test_submissions
             SET status = 'error', gateway_description = $1, completed_at = NOW()
             WHERE id = $2 AND firm_id = $3`,
            [message, submissionId, session.firmId]
        );
        const detail = err instanceof JpkGatewayError ? err.detail : undefined;
        return NextResponse.json({ error: message, detail }, { status: 502 });
    }
}
