const CACHE_NAME = 'xylosync-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/css/style.css',
    '/js/main.js',
    '/img/android-chrome-512x512.png',
    '/homepage.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
}); 