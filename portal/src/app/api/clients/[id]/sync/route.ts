import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { classifyInvoice } from '@/lib/classify';
import { mapVatColumns } from '@/lib/vat-mapper';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Try to trigger n8n webhook if configured
    const n8nWebhookUrl = process.env.N8N_SYNC_WEBHOOK_URL;
    if (n8nWebhookUrl) {
        try {
            await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: client.id, nip: client.nip }),
                signal: AbortSignal.timeout(5000),
            });
        } catch {
            // n8n unreachable — still return success (sync is async)
        }
    }

    // Record sync attempt
    await query(
        'UPDATE clients SET last_sync_at = NOW() WHERE id = $1',
        [id]
    );

    await logActivity(session.firmId, 'sync_triggered', `Synchronizacja KSeF: ${client.client_name}`);

    // Classify unclassified purchase invoices in the background
    if (process.env.ANTHROPIC_API_KEY) {
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
