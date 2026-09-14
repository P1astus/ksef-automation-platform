import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import {
    initInteractiveSession, openOnlineSession, encryptInvoiceForSession, sendInvoice,
    closeOnlineSession, terminateSession, getSessionInvoiceStatus, downloadUpo,
} from '@/lib/ksef-client';

// KSeF processes a submitted invoice asynchronously - sendInvoice() returning
// only means it was accepted for processing, not that it has a permanent
// ksefNumber or a UPO yet. Poll a bounded number of times (same ~8s budget
// as initInteractiveSession()'s auth poll) before giving up and leaving
// those invoices' UPO retrieval for later - the send itself already
// succeeded either way.
const UPO_POLL_ATTEMPTS = 10;
const UPO_POLL_INTERVAL_MS = 800;

export async function pollAndStoreUpo(
    accessToken: string,
    sessionReferenceNumber: string,
    sent: { id: number; ksefReferenceNumber: string }[]
): Promise<Set<number>> {
    const pending = new Set(sent.map(s => s.id));
    const byRef = new Map(sent.map(s => [s.ksefReferenceNumber, s.id]));

    for (let attempt = 0; attempt < UPO_POLL_ATTEMPTS && pending.size > 0; attempt++) {
        await new Promise(r => setTimeout(r, UPO_POLL_INTERVAL_MS));
        let statuses;
        try {
            statuses = await getSessionInvoiceStatus(accessToken, sessionReferenceNumber);
        } catch {
            break; // best-effort - stop polling, remaining ids stay "pending"
        }

        for (const status of statuses) {
            const invoiceId = byRef.get(status.referenceNumber);
            if (invoiceId === undefined || !pending.has(invoiceId)) continue;
            if (status.status.code < 200 || status.status.code >= 300) continue; // not a terminal success (still processing, or a real failure) - leave pending for this pass

            pending.delete(invoiceId);

            let upoXml: string | null = null;
            let upoHash: string | null = null;
            if (status.upoDownloadUrl) {
                try {
                    const upo = await downloadUpo(status.upoDownloadUrl);
                    upoXml = upo.xml;
                    upoHash = upo.hash;
                } catch {
                    // Best-effort - the invoice still has its real ksefNumber
                    // stored below even if the UPO fetch itself failed.
                }
            }

            await query(
                `UPDATE invoices
                 SET ksef_number = COALESCE($1, ksef_number),
                     ksef_acquisition_date = $2,
                     ksef_permanent_storage_date = $3,
                     upo_xml = COALESCE($4, upo_xml),
                     upo_reference_number = $5,
                     upo_hash = COALESCE($6, upo_hash),
                     upo_retrieved_at = CASE WHEN $4 IS NOT NULL THEN NOW() ELSE upo_retrieved_at END
                 WHERE id = $7`,
                [status.ksefNumber ?? null, status.acquisitionDate ?? null, status.permanentStorageDate ?? null,
                 upoXml, status.referenceNumber, upoHash, invoiceId]
            );

            if (status.ksefNumber) {
                await query(
                    `UPDATE offline_invoices SET uploaded_to_ksef = true, ksef_number = $1
                     WHERE invoice_id = $2 AND uploaded_to_ksef = false`,
                    [status.ksefNumber, invoiceId]
                );
            }
        }
    }

    return pending; // whatever's left never reached a terminal status in time
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Sending a real invoice to KSeF is the highest-stakes write in the
    // system — readonly must not be able to trigger it.
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;

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

    const results: { id: number; ksefReferenceNumber?: string; error?: string; upoPending?: boolean }[] = [];

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

        const sentThisClient: { id: number; ksefReferenceNumber: string }[] = [];
        for (const inv of invoices) {
            if (!inv.raw_xml) {
                results.push({ id: inv.id, error: 'Brak XML faktury' });
                continue;
            }
            try {
                const encryptedPayload = await encryptInvoiceForSession(inv.raw_xml, onlineSession.keyBase64, onlineSession.ivBase64);
                // ksefRef here is sendInvoice()'s own referenceNumber, scoped
                // to this session — NOT the permanent KSeF invoice number.
                // The real ksefNumber (and the UPO) only exist once KSeF has
                // finished processing the invoice, which pollAndStoreUpo()
                // below waits for — offline_invoices.ksef_number is updated
                // there, not here, so it's never given this session-scoped
                // value under that name.
                const ksefRef = await sendInvoice(accessToken, onlineSession.referenceNumber, encryptedPayload);
                await query(
                    `UPDATE invoices
                     SET processing_status = 'exported_jpk',
                         ksef_submission_date = NOW()
                     WHERE id = $1`,
                    [inv.id]
                );
                results.push({ id: inv.id, ksefReferenceNumber: ksefRef });
                sentThisClient.push({ id: inv.id, ksefReferenceNumber: ksefRef });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Błąd wysyłki faktury';
                results.push({ id: inv.id, error: msg });
            }
        }

        if (sentThisClient.length > 0) {
            const stillPending = await pollAndStoreUpo(accessToken, onlineSession.referenceNumber, sentThisClient);
            for (const result of results) {
                if (stillPending.has(result.id)) result.upoPending = true;
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
