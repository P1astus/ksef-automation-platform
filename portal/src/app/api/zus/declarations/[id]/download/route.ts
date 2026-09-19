import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member', 'readonly']);
    if (roleError) return roleError;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Nieprawidłowy identyfikator.' }, { status: 400 });

    const result = await query(
        'SELECT source_filename, source_xml FROM zus_declarations WHERE id = $1 AND firm_id = $2',
        [id, session.firmId]
    );
    const declaration = result.rows[0];
    if (!declaration) return NextResponse.json({ error: 'Deklaracja nie istnieje.' }, { status: 404 });
    await query('INSERT INTO zus_declaration_events (declaration_id, firm_id, event_type) VALUES ($1, $2, $3)', [id, session.firmId, 'downloaded']);
    return new NextResponse(declaration.source_xml, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Content-Disposition': `attachment; filename="${String(declaration.source_filename).replace(/["\\]/g, '_')}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
