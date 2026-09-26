// Content-Security-Policy for rendered pages (edge-safe: used by middleware).
// Scripts run only from this origin or with the per-request nonce, so an
// injected inline <script> is refused by the browser. Styles keep
// 'unsafe-inline': React style attributes need it and nonces do not cover
// attributes. No third-party origins anywhere (fonts are self-hosted).
export function contentSecurityPolicy(nonce: string, dev = false): string {
    return [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self'",
        "font-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "frame-src 'none'",
        "img-src 'self' data: blob:",
        "manifest-src 'self'",
        "media-src 'self'",
        "object-src 'none'",
        // Next.js dev mode evaluates code for fast refresh; production never does.
        `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ''}`,
        "style-src 'self' 'unsafe-inline'",
        "worker-src 'self' blob:",
    ].join('; ');
}

export function newNonce(): string {
    return btoa(crypto.randomUUID());
}
