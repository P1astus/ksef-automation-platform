import { describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { readFileSync } from 'fs';
import { join } from 'path';

// The worker container runs a bundle of src/worker/main.ts, which pulls in
// shared library code (mail transport, KSeF client, jobs). Every process.env
// variable read anywhere in that bundle must reach the ksef_worker service,
// or the worker silently runs without it (SMTP_CHECK_TO was missing, so every
// worker e-mail failed under SMTP). Bundled exactly as portal/Dockerfile does.
const PORTAL = join(__dirname, '../../..');
const EXEMPT = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'OCR_UPLOAD_DIR', 'NEXT_PUBLIC_BASE_URL', 'HOSTNAME']);

describe('ksef_worker environment', () => {
    it('passes through every variable the worker bundle reads', () => {
        const result = buildSync({
            entryPoints: [join(PORTAL, 'src/worker/main.ts')], bundle: true, platform: 'node', format: 'cjs',
            write: false, metafile: true, external: ['pg-native'], logLevel: 'silent', absWorkingDir: PORTAL,
            tsconfig: join(PORTAL, 'tsconfig.json'),
        });
        const sources = Object.keys(result.metafile!.inputs).filter(f => f.startsWith('src/'));
        expect(sources.length).toBeGreaterThan(10);
        const used = new Set<string>();
        for (const f of sources) {
            for (const m of readFileSync(join(PORTAL, f), 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
        }
        const compose = readFileSync(join(PORTAL, '../docker-compose.yml'), 'utf8');
        const worker = compose.slice(compose.indexOf('  ksef_worker:'), compose.indexOf('  # One-shot'));
        const missing = [...used].filter(v => !EXEMPT.has(v) && !new RegExp(`[-"\\s]${v}=`).test(worker));
        expect(missing).toEqual([]);
    });
});
