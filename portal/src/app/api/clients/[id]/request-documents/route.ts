import { NextResponse } from 'next/server';
import { requireActiveSubscription } from '@/lib/entitlements';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendDocumentRequest } from '@/lib/email';
import { logActivity } from '@/lib/activity';
import { appUrl } from '@/lib/app-url';

// Generates a firm-scoped, expiring upload link and emails it to the
// client — the firm-side half of the document-request flow (see
// GET/POST /upload/[token] for the public, no-login half). Same token
// pattern as team/route.ts's invite flow, but reusable until expiry: a
// client may upload several documents over a few days, not just accept
// once.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const planError = await requireActiveSubscription(session.firmId);
    if (planError) return planError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const message: string | undefined = typeof body.message === 'string' ? body.message.trim() || undefined : undefined;

    const clientRes = await query(
        'SELECT id, client_name, contact_email FROM clients WHERE id = $1 AND firm_id = $2',
        [id, session.firmId]
    );
    const client = clientRes.rows[0];
    if (!client) return NextResponse.json({ error: 'Klient nie znaleziony' }, { status: 404 });
    if (!client.contact_email) {
        return NextResponse.json({ error: 'Klient nie ma ustawionego adresu e-mail kontaktowego' }, { status: 400 });
    }

    const firmRes = await query('SELECT firm_name FROM firms WHERE id = $1', [session.firmId]);
    const firmName = firmRes.rows[0]?.firm_name || 'KSeF Auto';

    const { randomBytes } = await import('crypto');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days, same as team invites

    await query(
        `INSERT INTO document_requests (firm_id, client_id, token, message, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [session.firmId, id, token, message || null, expiresAt]
    );

    const uploadUrl = `${appUrl()}/upload/${token}`;
    // Not swallowed: the UI reports "link sent to the client", so a failed
    // send (no mail provider, no public URL to link to) must say so instead.
    if (!appUrl()) {
        return NextResponse.json({ error: 'Adres publiczny portalu (NEXT_PUBLIC_APP_URL) nie jest skonfigurowany - link byłby nieprawidłowy.' }, { status: 503 });
    }
    try {
        await sendDocumentRequest(client.contact_email, client.client_name, firmName, uploadUrl, message, expiresAt.toISOString());
    } catch {
        return NextResponse.json({ error: 'Nie udało się wysłać e-maila do klienta. Sprawdź konfigurację poczty.' }, { status: 502 });
    }

    await logActivity(session.firmId, 'document_request', `Poproszono o dokumenty: ${client.client_name}`);

    return NextResponse.json({ ok: true, uploadUrl, expiresAt });
}
