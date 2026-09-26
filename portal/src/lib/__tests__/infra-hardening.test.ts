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
