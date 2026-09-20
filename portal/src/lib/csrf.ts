export type OriginCheck = { ok: true } | { ok: false; error: string };

function firstHeaderValue(value: string | null): string | null {
    return value?.split(',')[0]?.trim() || null;
}

/**
 * Browser mutation guard. SameSite cookies are useful defence in depth, but the server still requires an Origin that
 * matches the externally visible scheme/host and rejects an explicit cross-site Fetch Metadata signal.
 */
export function verifySameOrigin(request: Request): OriginCheck {
    const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
    if (fetchSite && fetchSite !== 'same-origin') return { ok: false, error: 'Cross-site request denied' };

    const origin = request.headers.get('origin');
    if (!origin) return { ok: false, error: 'Origin header is required' };

    const url = new URL(request.url);
    const host = firstHeaderValue(request.headers.get('x-forwarded-host'))
        ?? firstHeaderValue(request.headers.get('host'))
        ?? url.host;
    const proto = firstHeaderValue(request.headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '');
    const expected = `${proto}://${host}`;
    try {
        if (new URL(origin).origin !== expected) return { ok: false, error: 'Origin does not match this site' };
    } catch {
        return { ok: false, error: 'Origin header is invalid' };
    }
    return { ok: true };
}
