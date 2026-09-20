import { describe, expect, it } from 'vitest';
import { verifySameOrigin } from '../csrf';

function request(origin?: string, fetchSite?: string) {
    const headers = new Headers({ host: 'portal.example.pl', 'x-forwarded-proto': 'https' });
    if (origin) headers.set('origin', origin);
    if (fetchSite) headers.set('sec-fetch-site', fetchSite);
    return new Request('http://portal:3000/api/jobs/run', { method: 'POST', headers });
}

describe('verifySameOrigin', () => {
    it('accepts a matching public origin behind the reverse proxy', () => {
        expect(verifySameOrigin(request('https://portal.example.pl', 'same-origin'))).toEqual({ ok: true });
    });

    it('denies a cross-site browser request even when it targets the right host', () => {
        expect(verifySameOrigin(request('https://evil.example', 'cross-site'))).toMatchObject({ ok: false });
    });

    it('fails closed when the Origin proof is absent', () => {
        expect(verifySameOrigin(request(undefined, 'same-origin'))).toMatchObject({ ok: false });
    });
});
