import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');

describe('local backup and restore proof', () => {
    it('keeps Compose projects isolated instead of claiming global container names', () => {
        const compose = read('docker-compose.local.yml');
        for (const service of ['portal', 'nginx', 'ksef_db', 'ksef_migrate', 'ksef_worker', 'xades-sidecar', 'postgres', 'n8n']) {
            expect(compose).toMatch(new RegExp(`${service}:[\\s\\S]*?container_name: !reset null`));
        }
        expect(read('nginx/nginx.local.conf')).toContain('server portal:3000;');
    });

    it('backs up the local database, uploads, certificates, and environment through Compose services', () => {
        const backup = read('scripts/backup-local.sh');
        expect(backup).toContain('docker compose');
        expect(backup).toContain('exec -T ksef_db pg_dump');
        expect(backup).toContain('exec -T portal tar');
        for (const artifact of ['ksef_platform.sql.gz', 'ocr_uploads.tgz', 'certificates', '.env', 'SHA256SUMS']) {
            expect(backup).toContain(artifact);
        }
        expect(backup).not.toMatch(/docker exec ksef_/);
    });

    it('restores every artifact, proves migrations are a no-op, and decrypts a stored credential with the restored key', () => {
        const verify = read('scripts/verify-local-backup.sh');
        expect(verify).toContain('ksef_migrate');
        expect(verify).toMatch(/no migrations to apply/i);
        expect(verify).toContain('schema_migrations');
        expect(verify).toContain('KSEF_CREDENTIALS_KEY');
        expect(verify).toContain('aes-256-gcm');
        expect(verify).toContain('ocr_uploads.tgz');
        expect(verify).toContain('certificates');
        expect(verify).toContain('down --volumes');
    });
});
