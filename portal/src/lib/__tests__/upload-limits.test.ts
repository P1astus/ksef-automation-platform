import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { safeExtension, MAX_UPLOAD_BYTES } from '../file-storage';

describe('upload safety', () => {
    it('keeps only a short alphanumeric extension', () => {
        expect(safeExtension('faktura.PDF')).toBe('.pdf');
        expect(safeExtension('scan.jpeg')).toBe('.jpeg');
        expect(safeExtension('noext')).toBe('');
    });

    it('drops extensions that could name a subdirectory or carry markup', () => {
        expect(safeExtension('a./../x')).toBe('');
        expect(safeExtension('evil./tmp/x')).toBe('');
        expect(safeExtension('x.<svg onload=1>')).toBe('');
        expect(safeExtension('x.' + 'a'.repeat(20))).toBe('');
    });

    it('nginx accepts uploads at least as large as the app cap (else nginx 413s first)', () => {
        const conf = readFileSync(join(__dirname, '../../../../nginx/nginx.conf'), 'utf8');
        const m = /client_max_body_size\s+(\d+)m;/.exec(conf);
        expect(m).not.toBeNull();
        expect(Number(m![1]) * 1024 * 1024).toBeGreaterThan(MAX_UPLOAD_BYTES);
    });
});
