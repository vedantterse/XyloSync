// The old XyloSync service worker cached assets aggressively. This replacement
// clears those caches and unregisters itself so browsers always load fresh files.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
        await self.registration.unregister();
    })());
});
