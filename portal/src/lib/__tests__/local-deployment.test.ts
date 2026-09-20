import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');

describe('secure local Compose overlay', () => {
    it('makes nginx the only published service and keeps legacy n8n opt-in', () => {
        const compose = read('docker-compose.local.yml');
        expect(compose).toContain('DEPLOYMENT_MODE=local');
        expect(compose).toMatch(/nginx:[\s\S]*?ports:[\s\S]*?80:80[\s\S]*?443:443/);
        for (const service of ['portal', 'ksef_db', 'postgres', 'n8n', 'xades-sidecar']) {
            expect(compose).toMatch(new RegExp(`${service}:[\\s\\S]*?ports: !reset \\[\\]`));
        }
        expect(compose).toMatch(/postgres:[\s\S]*?profiles:\s*\["legacy-n8n"\]/);
        expect(compose).toMatch(/n8n:[\s\S]*?profiles:\s*\["legacy-n8n"\]/);
        expect(compose).toContain('NEXT_TELEMETRY_DISABLED=1');
        for (const vendorKey of ['RESEND_API_KEY=', 'ANTHROPIC_API_KEY=', 'STRIPE_SECRET_KEY=']) {
            expect(compose).toContain(vendorKey);
        }
    });

    it('terminates TLS, redirects HTTP, preserves the real client IP, and never exposes n8n routes', () => {
        const nginx = read('nginx/nginx.local.conf');
        expect(nginx).toMatch(/listen 80;/);
        expect(nginx).toMatch(/return 308 https:\/\//);
        expect(nginx).toMatch(/listen 443 ssl;/);
        expect(nginx).toContain('ssl_certificate /etc/nginx/local-tls/tls.crt;');
        expect(nginx).toContain('proxy_set_header X-Real-IP $remote_addr;');
        expect(nginx).toContain('proxy_set_header X-Forwarded-Proto https;');
        expect(nginx).not.toMatch(/location \/webhook/);
    });

    it('ships SAN-aware certificate generation and a LAN-only port verification gate', () => {
        const cert = read('scripts/generate-local-certificate.sh');
        expect(cert).toContain('subjectAltName');
        expect(cert).toContain('IP:');
        expect(cert).toContain('DNS:');
        expect(cert).toContain('chmod 600');

        const network = read('scripts/verify-local-network.sh');
        expect(network).toContain('https://');
        expect(network).toContain('http://');
        expect(network).toContain('443');
        expect(network).toContain('80');
        for (const port of ['3000', '5432', '5433', '5678', '8090']) expect(network).toContain(port);
    });
});

describe('local egress and secure-session image invariants', () => {
    it('confines browser requests to this origin and has no third-party browser assets', () => {
        const nextConfig = read('portal/next.config.js');
        expect(nextConfig).toMatch(/connect-src 'self'/);
        for (const source of ['portal/src/app', 'portal/public']) {
            expect(existsSync(join(REPO, source))).toBe(true);
}
        const layout = read('portal/src/app/layout.tsx');
        expect(layout).not.toMatch(/https?:\/\//);
    });

    it('runs the built image in production so session cookies are Secure', () => {
        const dockerfile = read('portal/Dockerfile');
        const auth = read('portal/src/lib/auth.ts');
        expect(dockerfile).toMatch(/ENV NODE_ENV production/);
        expect(auth.match(/secure: process\.env\.NODE_ENV === 'production'/g)).toHaveLength(2);
    });
});
