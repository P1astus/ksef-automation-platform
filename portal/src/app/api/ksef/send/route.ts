import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { initInteractiveSession, openOnlineSession, encryptInvoiceForSession, sendInvoice, closeOnlineSession, terminateSession } from '@/lib/ksef-client';

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const invoiceIds: number[] = Array.isArray(body.invoiceIds) ? body.invoiceIds : [];
    if (!invoiceIds.length) {
        return NextResponse.json({ error: 'Brak faktur do wysłania' }, { status: 400 });
    }

    // Fetch invoices with client token — must belong to this firm. The join
    // is scoped by firm_id on both sides: a NIP can now belong to more than
    // one firm, so joining on client_nip alone could match another firm's
    // client row and send that firm's invoice using this firm's token.
    const placeholders = invoiceIds.map((_, i) => `$${i + 2}`).join(',');
    const invRes = await query(
        `SELECT i.id, i.invoice_number, i.raw_xml, i.direction,
                c.nip, c.client_name, c.ksef_token_encrypted
         FROM invoices i
         JOIN clients c ON i.client_nip = c.nip AND i.firm_id = c.firm_id
         WHERE i.id IN (${placeholders}) AND i.firm_id = $1`,
        [session.firmId, ...invoiceIds]
    );

    if (!invRes.rows.length) {
        return NextResponse.json({ error: 'Nie znaleziono faktur' }, { status: 404 });
    }

    // Group by client (each client has its own token / session)
    const byClient = new Map<string, typeof invRes.rows>();
    for (const row of invRes.rows) {
        const key = row.nip;
        if (!byClient.has(key)) byClient.set(key, []);
        byClient.get(key)!.push(row);
    }

    const results: { id: number; ksefReferenceNumber?: string; error?: string }[] = [];

    for (const [nip, invoices] of byClient) {
        const { ksef_token_encrypted, client_name } = invoices[0];
        if (!ksef_token_encrypted) {
            for (const inv of invoices) {
                results.push({ id: inv.id, error: `Brak tokenu KSeF dla ${client_name}` });
            }
            continue;
        }

        const tokenPlaintext = Buffer.from(ksef_token_encrypted, 'base64').toString('utf8');
        let accessToken: string | null = null;

        try {
            accessToken = await initInteractiveSession(nip, tokenPlaintext);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Błąd inicjalizacji sesji KSeF';
            for (const inv of invoices) results.push({ id: inv.id, error: msg });
            continue;
        }

        // Opening the online (invoice-sending) session is separate from the
        // auth session above: it needs its own referenceNumber and its own
        // AES key/IV (see openOnlineSession in ksef-client.ts). One failure
        // here fails every invoice for this client, same as an auth failure.
        let onlineSession: Awaited<ReturnType<typeof openOnlineSession>> | null = null;
        try {
            onlineSession = await openOnlineSession(accessToken);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Błąd otwarcia sesji wysyłki KSeF';
            for (const inv of invoices) results.push({ id: inv.id, error: msg });
            await terminateSession(accessToken);
            continue;
        }

        for (const inv of invoices) {
            if (!inv.raw_xml) {
                results.push({ id: inv.id, error: 'Brak XML faktury' });
                continue;
            }
            try {
                const encryptedPayload = await encryptInvoiceForSession(inv.raw_xml, onlineSession.keyBase64, onlineSession.ivBase64);
                const ksefRef = await sendInvoice(accessToken, onlineSession.referenceNumber, encryptedPayload);
                await query(
                    `UPDATE invoices
                     SET processing_status = 'exported_jpk',
                         ksef_submission_date = NOW()
                     WHERE id = $1`,
                    [inv.id]
                );
                results.push({ id: inv.id, ksefReferenceNumber: ksefRef });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Błąd wysyłki faktury';
                results.push({ id: inv.id, error: msg });
            }
        }

        await closeOnlineSession(accessToken, onlineSession.referenceNumber);
        await terminateSession(accessToken);
    }

    const sentCount = results.filter(r => r.ksefReferenceNumber).length;
    if (sentCount > 0) {
        await logActivity(session.firmId, 'ksef_send', `Wysłano ${sentCount} faktur do KSeF`);
    }

    return NextResponse.json({ ok: true, results, sent: sentCount });
}
