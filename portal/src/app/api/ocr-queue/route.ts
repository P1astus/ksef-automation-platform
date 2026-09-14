import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

// Lists items awaiting review (or recently completed/rejected, for
// context) — ocr_queue existed in the schema, tenancy-scoped, since before
// the tenancy migration itself, but nothing ever read from it until this
// route.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const statuses = status ? [status] : ['manual_review', 'queued'];

    const res = await query(
        `SELECT id, client_nip, source_type, file_path, file_type, ocr_status,
                extracted_data, confidence_score, matched_ksef_number, error_message,
                created_at, processed_at
         FROM ocr_queue
         WHERE firm_id = $1 AND ocr_status = ANY($2)
         ORDER BY created_at DESC`,
        [session.firmId, statuses]
    );

    return NextResponse.json({ items: res.rows });
}
