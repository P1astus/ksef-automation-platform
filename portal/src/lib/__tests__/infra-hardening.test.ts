import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Host exposure and container hardening for the hosted Compose stack.
const root = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('docker-compose.yml', () => {
    const compose = read('docker-compose.yml');

    it('publishes internal services (databases, n8n, sidecar) on loopback only', () => {
        for (const port of ['5432:5432', '5433:5432', '5678:5678', '8090:8090']) {
            const lines = compose.split(/\r?\n/).filter(l => l.includes(`:${port}"`) || l.trim() === `- "${port}"`);
            expect(lines.length, port).toBeGreaterThan(0);
            for (const line of lines) expect(line, port).toContain(`"127.0.0.1:${port}"`);
        }
    });

    it('pins the n8n image instead of tracking :latest', () => {
        expect(compose).not.toMatch(/image:\s*n8nio\/n8n:latest/);
        expect(compose).toMatch(/image:\s*n8nio\/n8n:\d+\.\d+\.\d+/);
    });
});

describe('hosted nginx', () => {
    it('does not publish n8n webhooks (nothing external calls them; workflow 01 had an unauthenticated one)', () => {
        const conf = read('nginx/nginx.conf');
        expect(conf).not.toMatch(/location \/webhook/);
        expect(conf).not.toMatch(/n8n/);
    });
});

describe('xades-sidecar', () => {
    it('runs as a non-root user', () => {
        const lines = read('xades-sidecar/Dockerfile').split(/\r?\n/);
        const runtimeStart = lines.findIndex(l => /^FROM eclipse-temurin:\S+-jre/.test(l));
        const user = lines.slice(runtimeStart).find(l => /^USER\s+/.test(l));
        expect(user).toBeDefined();
        expect(user).not.toMatch(/^USER\s+(root|0)\b/);
    });

    it('does not show health details to unauthenticated callers', () => {
        expect(read('xades-sidecar/src/main/resources/application.yml')).toMatch(/show-details:\s*never/);
    });
});

describe('portal image', () => {
    it('builds on a supported Node LTS (Node 20 reached end of life in April 2026)', () => {
        const dockerfile = read('portal/Dockerfile');
        expect(dockerfile).toMatch(/^FROM node:24-alpine AS base/m);
        expect(dockerfile).toContain('--target=node24');
    });
});

describe('hosted HTTPS overlay (docker-compose.tls.yml + nginx/nginx.tls.conf)', () => {
    const conf = read('nginx/nginx.tls.conf');
    const overlay = read('docker-compose.tls.yml');

    it('redirects HTTP to HTTPS except the ACME challenge path', () => {
        expect(conf).toMatch(/listen 80;[\s\S]*location \/\.well-known\/acme-challenge\/[\s\S]*return 308 https:\/\/\$host\$request_uri;/);
    });

    it('serves only modern TLS with HSTS and no client-supplied forwarding headers', () => {
        expect(conf).toMatch(/listen 443 ssl;/);
        expect(conf).toMatch(/ssl_protocols TLSv1\.2 TLSv1\.3;/);
        expect(conf).toMatch(/Strict-Transport-Security "max-age=31536000"/);
        expect(conf).toContain('proxy_set_header X-Real-IP $remote_addr;');
        expect(conf).toContain('proxy_set_header X-Forwarded-Proto https;');
        expect(conf).not.toMatch(/n8n|location \/webhook/);
    });

    it('resolves the portal per request', () => {
        expect(conf).toMatch(/resolver 127\.0\.0\.11/);
        expect(conf).toContain('proxy_pass $portal_upstream;');
    });

    it('mounts the certificate directory read-only from the git-ignored certificates folder', () => {
        expect(overlay).toContain('./certificates/hosted:/etc/nginx/tls:ro');
        expect(overlay).toContain('./nginx/nginx.tls.conf:/etc/nginx/nginx.conf:ro');
        expect(read('.gitignore')).toMatch(/^certificates\/$/m);
    });
});
