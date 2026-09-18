import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        exclude: ['tests/**', 'node_modules/**'],
        environment: 'node',
        // Several integration files boot their own PGlite (Postgres/WASM)
        // instance. Letting Vitest scale to every host CPU can start 14 of
        // them at once and intermittently exhaust resources during beforeAll.
        // Four forks keeps useful parallelism while bounding that pressure;
        // hookTimeout gives schema/fixture setup room on a busy CI host.
        pool: 'forks',
        poolOptions: {
            forks: {
                minForks: 1,
                maxForks: 4,
            },
        },
        hookTimeout: 30_000,
    },
});
