const CACHE_NAME = 'xylosync-v4';
const ASSETS_TO_CACHE = [
    '/',
    '/css/style.css',
    '/js/main.js',
    '/img/android-chrome-512x512.png',
    '/homepage' // was /homepage.html
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Always go to network for API calls and session-related requests
    const isApi = url.pathname.startsWith('/api/');
    const isSession = url.pathname === '/api/session';
    const isNavigate = event.request.mode === 'navigate' || event.request.destination === 'document';

    if (isApi || isSession || isNavigate) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    // Cache-first for static assets
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});