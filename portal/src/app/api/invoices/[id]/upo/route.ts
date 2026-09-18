import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { initInteractiveSession, downloadUpoByKsefNumber } from '@/lib/ksef-client';
import { clientCredentialContext, decryptSecret } from '@/lib/credential-crypto';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // Ownership check directly against invoices.firm_id, matching every
    // other per-invoice route (xml, download, payment) — see those for why
    // a client_nip join alone isn't safe post-tenancy-fix. Joined to
    // clients here (firm_id on both sides, same reason) only for the token
    // the fallback retry below needs — never for the ownership check itself.
    const res = await query(
        `SELECT i.upo_xml, i.upo_retrieved_at, i.ksef_number, i.ksef_session_reference_number,
                c.id AS client_id, c.nip, c.ksef_token_encrypted
         FROM invoices i
         LEFT JOIN clients c ON c.nip = i.client_nip AND c.firm_id = i.firm_id
         WHERE i.id = $1 AND i.firm_id = $2`,
        [id, session.firmId]
    );

    if (!res.rows[0]) return NextResponse.json({ error: 'Faktura nie znaleziona' }, { status: 404 });
    const { upo_xml, upo_retrieved_at, ksef_number, ksef_session_reference_number, client_id, nip, ksef_token_encrypted } = res.rows[0];

    if (upo_xml) {
        return NextResponse.json({ upoXml: upo_xml, retrievedAt: upo_retrieved_at });
    }

    if (!ksef_number) {
        return NextResponse.json({ error: 'Faktura nie została jeszcze wysłana do KSeF' }, { status: 404 });
    }

    // Fallback: the original pollAndStoreUpo() pass (ksef/send/route.ts)
    // either never ran long enough to reach a terminal status, or the
    // pre-signed upoDownloadUrl it got had already expired by the time it
    // tried to fetch it. Retry live via the authenticated endpoint, which
    // only needs the online session's reference number (not the
    // now-expired URL) plus a fresh Bearer token — best-effort: any
    // failure here (still processing, session's own retention window
    // elapsed, token missing) falls through to the same "not yet
    // available" response as before, not a 500.
    if (ksef_session_reference_number && nip && ksef_token_encrypted) {
        try {
            const tokenPlaintext = decryptSecret(ksef_token_encrypted, clientCredentialContext(client_id));
            const accessToken = await initInteractiveSession(nip, tokenPlaintext);
            const upo = await downloadUpoByKsefNumber(accessToken, ksef_session_reference_number, ksef_number);
            await query(
                `UPDATE invoices SET upo_xml = $1, upo_hash = $2, upo_retrieved_at = NOW() WHERE id = $3`,
                [upo.xml, upo.hash, id]
            );
            return NextResponse.json({ upoXml: upo.xml, retrievedAt: new Date().toISOString() });
        } catch {
            // fall through to the "try again later" response below
        }
    }

    return NextResponse.json({ error: 'UPO jeszcze niedostępne — spróbuj ponownie za chwilę' }, { status: 404 });
}
