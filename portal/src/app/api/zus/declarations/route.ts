import { requireLicenceWrite } from '@/lib/entitlements';
import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { inspectZusDeclarationXml, MAX_ZUS_XML_BYTES, safeZusFilename, ZusDeclarationValidationError } from '@/lib/zus-declarations';
import { logActivity } from '@/lib/activity';

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member', 'readonly']);
    if (roleError) return roleError;

    const result = await query(
        `SELECT z.id, z.client_nip, c.client_name, z.period, z.document_types, z.source_filename, z.status, z.created_at, z.exported_at
         FROM zus_declarations z
         LEFT JOIN clients c ON c.nip = z.client_nip AND c.firm_id = z.firm_id
         WHERE z.firm_id = $1 ORDER BY z.created_at DESC LIMIT 100`,
        [session.firmId]
    );
    return NextResponse.json({ declarations: result.rows, directSubmissionAvailable: false });
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const licenceError = await requireLicenceWrite(session.firmId);
    if (licenceError) return licenceError;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const clientNip = String(form?.get('clientNip') || '');
    const period = String(form?.get('period') || '');
    if (!(file instanceof File) || !clientNip || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        return NextResponse.json({ error: 'Wymagane są: klient, okres (YYYY-MM) i plik XML.' }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_ZUS_XML_BYTES) {
        return NextResponse.json({ error: 'Plik XML musi mieć od 1 B do 5 MB.' }, { status: 413 });
    }
    if (!/\.xml$/i.test(file.name) && !['application/xml', 'text/xml'].includes(file.type)) {
        return NextResponse.json({ error: 'Dozwolony jest wyłącznie plik XML.' }, { status: 400 });
    }

    const client = await query('SELECT client_name FROM clients WHERE nip = $1 AND firm_id = $2', [clientNip, session.firmId]);
    if (!client.rows[0]) return NextResponse.json({ error: 'Klient nie znaleziony.' }, { status: 404 });

    let xml: string;
    try {
        xml = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
        return NextResponse.json({ error: 'Plik musi być poprawnie zakodowany w UTF-8.' }, { status: 400 });
    }

    try {
        const inspected = inspectZusDeclarationXml(xml);
        const insert = await query(
            `INSERT INTO zus_declarations (firm_id, client_nip, period, document_types, source_filename, source_xml, sha256)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, document_types, status, created_at`,
            [session.firmId, clientNip, period, inspected.documentTypes, safeZusFilename(file.name), xml, inspected.sha256]
        );
        const declaration = insert.rows[0];
        await query('INSERT INTO zus_declaration_events (declaration_id, firm_id, event_type) VALUES ($1, $2, $3)', [declaration.id, session.firmId, 'imported']);
        await logActivity(session.firmId, 'zus_declaration_imported', `Zaimportowano ZUS ${inspected.documentTypes.join('/')} za ${period} dla ${client.rows[0].client_name}`);
        return NextResponse.json({ declaration, notice: 'Zaimportowano do rejestru. Plik nie został wysłany do ZUS.' }, { status: 201 });
    } catch (error: unknown) {
        if (error instanceof ZusDeclarationValidationError) return NextResponse.json({ error: error.message }, { status: 422 });
        const code = (error as { code?: string })?.code;
        if (code === '23505') return NextResponse.json({ error: 'Ten sam plik dla tego klienta i okresu jest już w rejestrze.' }, { status: 409 });
        console.error('ZUS declaration import failed:', error);
        return NextResponse.json({ error: 'Nie udało się zapisać deklaracji ZUS.' }, { status: 500 });
    }
}
