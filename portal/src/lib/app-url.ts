// The public origin of this portal, used to build every link that leaves the
// app (invite / reset / document-request emails, Stripe redirect URLs).
// Historically routes read two different variables (NEXT_PUBLIC_APP_URL and
// NEXT_PUBLIC_BASE_URL) and neither reached the container (docker-compose.yml
// now passes it through), so emailed links had no host. One reader, one
// fallback order, no trailing slash. Returns '' when unset - callers building
// an EXTERNAL link should treat that as "not configured".
export function appUrl(): string {
    const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    return raw.trim().replace(/\/+$/, '');
}
