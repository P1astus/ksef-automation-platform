import { readFile } from 'fs/promises';
import { basename } from 'path';
import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { uploadedFilePath } from '@/lib/file-storage';

const CONTENT_TYPES: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member', 'readonly']);
    if (roleError) return roleError;

    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Nieprawidłowy identyfikator' }, { status: 400 });

    const result = await query(
        `SELECT file_path, file_type FROM ocr_queue WHERE id = $1 AND firm_id = $2`,
        [id, session.firmId]
    );
    const row = result.rows[0];
    if (!row) return NextResponse.json({ error: 'Dokument nie istnieje' }, { status: 404 });

    // Only filenames created by saveUploadedFile() are accepted. Never let a
    // database value turn this route into an arbitrary-file reader.
    const storedName = String(row.file_path || '');
    if (!storedName || basename(storedName) !== storedName || !/^[0-9a-f-]+(?:\.[a-z0-9]{1,8})?$/i.test(storedName)) {
        return NextResponse.json({ error: 'Nieprawidłowa ścieżka dokumentu' }, { status: 500 });
    }

    try {
        const data = await readFile(uploadedFilePath(storedName));
        const type = String(row.file_type || '').toLowerCase();
        return new NextResponse(data, {
            headers: {
                'Content-Type': CONTENT_TYPES[type] || 'application/octet-stream',
                'Content-Disposition': `inline; filename="dokument-${id}.${type || 'bin'}"`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return NextResponse.json({ error: 'Plik dokumentu nie jest już dostępny' }, { status: 404 });
        }
        console.error('OCR source file read failed:', error);
        return NextResponse.json({ error: 'Nie udało się odczytać dokumentu' }, { status: 500 });
    }
}
