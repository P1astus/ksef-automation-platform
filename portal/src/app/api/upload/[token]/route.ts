import { requireLicenceWrite } from '@/lib/entitlements';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { saveUploadedFile, shortFileType, MAX_UPLOAD_BYTES, UPLOAD_TOO_LARGE_MESSAGE } from '@/lib/file-storage';

// Public, no-login route — the whole point of a document request is that
// the client doesn't have an account. firm_id/client_id are resolved here,
// server-side, from the token alone: never accepted from the request body.
// This is the exact contract flagged as missing when 07-document-
// collection.json was deleted (its webhook trusted a bare client_nip in
// the POST body with no way to know which firm it belonged to).
async function resolveRequest(token: string) {
    const res = await query(
        `SELECT dr.firm_id, dr.client_id, dr.expires_at, c.nip AS client_nip, c.client_name
         FROM document_requests dr
         JOIN clients c ON c.id = dr.client_id
         WHERE dr.token = $1`,
        [token]
    );
    const row = res.rows[0];
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const doc = await resolveRequest(token);
    if (!doc) return NextResponse.json({ error: 'Link jest nieprawidłowy lub wygasł' }, { status: 404 });
    return NextResponse.json({ clientName: doc.client_name });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const doc = await resolveRequest(token);
    if (!doc) return NextResponse.json({ error: 'Link jest nieprawidłowy lub wygasł' }, { status: 404 });
    const licenceError = await requireLicenceWrite(doc.firm_id);
    if (licenceError) return licenceError;

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Brak pliku' }, { status: 400 });

    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!ALLOWED.includes(file.type)) {
        return NextResponse.json({ error: 'Nieobsługiwany format pliku. Użyj PDF lub JPEG/PNG.' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: UPLOAD_TOO_LARGE_MESSAGE }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = await saveUploadedFile(buffer, file.name);

    // Lands in the review queue, same as OCR uploads and email-ingested
    // invoices — a client-submitted file is never auto-promoted straight
    // into invoices without a human looking at it first.
    await query(
        `INSERT INTO ocr_queue (firm_id, client_nip, source_type, file_path, file_type, ocr_status)
         VALUES ($1, $2, 'webhook', $3, $4, 'queued')`,
        [doc.firm_id, doc.client_nip, filePath, shortFileType(file.type)]
    );

    return NextResponse.json({ ok: true });
}
