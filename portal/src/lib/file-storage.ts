import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

// None of the ingestion paths (OCR upload, email sync, the tokened client
// upload) persisted the original file anywhere — ocr/route.ts processed the
// buffer in memory and discarded it. A reviewer in the OCR review queue
// needs to see the source document, so uploads are written to a directory
// backed by a named Docker volume (docker-compose.yml's `ocr_uploads` on
// the portal service) rather than the container's writable layer, which is
// lost on every rebuild.
const UPLOAD_DIR = process.env.OCR_UPLOAD_DIR || '/app/uploads';

export async function saveUploadedFile(buffer: Buffer, originalFilename: string): Promise<string> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = originalFilename.includes('.') ? originalFilename.slice(originalFilename.lastIndexOf('.')) : '';
    const filename = `${randomUUID()}${ext}`;
    await writeFile(join(UPLOAD_DIR, filename), buffer);
    return filename; // relative path, stored as ocr_queue.file_path
}

export function uploadedFilePath(filename: string): string {
    return join(UPLOAD_DIR, filename);
}

// ocr_queue.file_type is VARCHAR(10) — a short extension-like value
// ("pdf", "jpg"), not the full MIME type string ("application/pdf" alone
// is already 16 characters and would fail the column's own length
// constraint at insert time).
const MIME_TO_SHORT_TYPE: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
};

export function shortFileType(mimeType: string): string {
    return MIME_TO_SHORT_TYPE[mimeType] || mimeType.split('/')[1]?.slice(0, 10) || 'unknown';
}
