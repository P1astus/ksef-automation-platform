import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { classifyInvoice } from '@/lib/classify';
import { mapVatColumns } from '@/lib/vat-mapper';
import { loadEntitlements, subscriptionInactiveResponse } from '@/lib/entitlements';
import { clientSyncMode, enqueueClientSync } from '@/lib/jobs/manual-sync';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const entitlements = await loadEntitlements(session.firmId);
    if (entitlements.accessState !== 'ok') return subscriptionInactiveResponse(entitlements.accessState);

    const { id } = await params;

    const clientRes = await query(
        'SELECT id, nip, client_name, ksef_token_encrypted FROM clients WHERE id = $1 AND firm_id = $2',
        [id, session.firmId]
    );
    if (!clientRes.rows[0]) return NextResponse.json({ error: 'Klient nie znaleziony' }, { status: 404 });

    const client = clientRes.rows[0];
    if (!client.ksef_token_encrypted) {
        return NextResponse.json({
            error: 'Brak tokenu KSeF. Skonfiguruj token w Ustawienia → Tokeny KSeF przed synchronizacją.'
        }, { status: 400 });
    }

    // The portal does not itself retrieve invoices; something else does. Refuse to claim a sync was queued unless one of
    // the two is really there: the embedded worker (invoice-retrieval job) or the legacy n8n webhook.
    const mode = clientSyncMode();
    if (mode === 'none') {
        return NextResponse.json({ error: 'Synchronizacja KSeF nie jest skonfigurowana na serwerze' }, { status: 503 });
    }
    try {
        if (mode === 'scheduler') {
            await enqueueClientSync({ query }, { clientId: client.id, firmId: session.firmId });
        } else {
            const webhook = await fetch(process.env.N8N_SYNC_WEBHOOK_URL as string, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: client.id, nip: client.nip }),
                signal: AbortSignal.timeout(5000),
            });
            if (!webhook.ok) throw new Error(`Webhook synchronizacji zwrócił ${webhook.status}`);
        }
    } catch (err) {
        console.error('KSeF sync could not be queued:', err);
        return NextResponse.json({ error: 'Nie udało się zlecić synchronizacji KSeF' }, { status: 502 });
    }

    await logActivity(session.firmId, 'sync_triggered', `Synchronizacja KSeF: ${client.client_name}`);

    // Classify unclassified purchase invoices in the background. AI
    // classification is a paid feature, gated here rather than by blocking sync
    // itself: Start keeps syncing, its purchases just stay unclassified (JPK
    // maps a null category to K_42/K_43 like every other non-fixed-asset one).
    if (entitlements.has('ai_classification') && process.env.ANTHROPIC_API_KEY) {
        const unclassified = await query(
            `SELECT id, seller_name, buyer_name, invoice_number, net_amount FROM invoices
             WHERE client_nip = $1 AND firm_id = $2 AND direction = 'purchase' AND cost_category IS NULL LIMIT 20`,
            [client.nip, session.firmId]
        );
        for (const inv of unclassified.rows) {
            const result = await classifyInvoice(inv);
            if (result) {
                const vatMapping = mapVatColumns(result.category);
                await query(
                    'UPDATE invoices SET cost_category = $1, classification_confidence = $2, kpir_column = $3, vat_register_field = $4 WHERE id = $5',
                    [result.category, result.confidence, vatMapping.kpirColumn, vatMapping.vatRegisterField, inv.id]
                );
            }
        }
    }

    return NextResponse.json({
        success: true,
        message: `Synchronizacja dla ${client.client_name} została zlecona. Faktury pojawią się za chwilę.`,
    });
}
