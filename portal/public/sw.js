const CACHE = 'ksef-auto-v1';
const SHELL = ['/dashboard', '/login', '/manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const { request } = e;
    // Only handle GET requests for same-origin navigation
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // API routes: network-only
    if (url.pathname.startsWith('/api/')) return;

    // Pages: network first, fallback to cache
    e.respondWith(
        fetch(request)
            .then(res => {
                const clone = res.clone();
                caches.open(CACHE).then(c => c.put(request, clone));
                return res;
            })
            .catch(() => caches.match(request))
    );
});
