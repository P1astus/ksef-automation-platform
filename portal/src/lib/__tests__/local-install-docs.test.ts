import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const install = readFileSync(join(__dirname, '..', '..', '..', '..', 'INSTALL.md'), 'utf8');

describe('local installation runbook', () => {
    it('uses the secure overlay and a zsh function for every Compose operation', () => {
        expect(install).toContain('docker-compose.local.yml');
        expect(install).toMatch(/dc\(\)\s*\{/);
        expect(install).toContain('--profile legacy-n8n');
    });

    it('documents certificate generation and trust on Windows and macOS', () => {
        expect(install).toContain('generate-local-certificate.sh');
        expect(install).toContain('subjectAltName');
        expect(install).toContain('certutil -addstore');
        expect(install).toContain('security add-trusted-cert');
    });

    it('covers first run, backup proof, LAN exposure, egress, and Secure cookies', () => {
        for (const text of [
            '/setup',
            'backup-local.sh',
            'verify-local-backup.sh',
            'verify-local-network.sh',
            "connect-src 'self'",
            'NODE_ENV=production',
            'Secure',
        ]) expect(install).toContain(text);
    });
});
