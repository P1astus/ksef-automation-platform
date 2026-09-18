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

// Largest document any upload path accepts. Kept below nginx's
// client_max_body_size (12m, nginx/nginx.conf) so the app returns a clear 413
// itself instead of nginx cutting the request off first.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TOO_LARGE_MESSAGE = 'Plik jest za duży. Maksymalny rozmiar to 10 MB.';

// The extension comes from a client-supplied filename, so only a short
// alphanumeric one is kept: anything else (a "/" in particular would make the
// write below target a nonexistent subdirectory and 500) is dropped.
export function safeExtension(originalFilename: string): string {
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(originalFilename);
    return m ? `.${m[1].toLowerCase()}` : '';
}

export async function saveUploadedFile(buffer: Buffer, originalFilename: string): Promise<string> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = safeExtension(originalFilename);
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
