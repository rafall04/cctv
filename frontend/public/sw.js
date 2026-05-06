/*
 * Purpose: Provide RAF NET CCTV PWA app-shell caching, navigation fallback, and compatibility with existing ad worker setup.
 * Caller: Browser service worker registration at /sw.js.
 * Deps: Cache API, Fetch API, optional external ad worker script.
 * MainFuncs: install, activate, fetch, offlineFallback.
 * SideEffects: Caches public shell assets and serves an offline fallback for navigation requests.
 */

const RAFNET_CCTV_CACHE = 'rafnet-cctv-public-v1';
const APP_SHELL_URLS = [
    '/',
    '/site.webmanifest',
    '/favicon.svg',
];

function offlineFallback() {
    return new Response(
        '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RAF NET CCTV Offline</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#fff;display:grid;min-height:100vh;place-items:center;padding:24px}main{max-width:420px}h1{font-size:22px;margin:0 0 8px}p{color:#cbd5e1;line-height:1.5}</style></head><body><main><h1>RAF NET CCTV sedang offline</h1><p>Periksa koneksi internet Anda lalu buka ulang aplikasi. Tampilan utama akan dimuat kembali saat koneksi tersedia.</p></main></body></html>',
        {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            },
        }
    );
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(RAFNET_CCTV_CACHE)
            .then((cache) => cache.addAll(APP_SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => key.startsWith('rafnet-cctv-public-') && key !== RAFNET_CCTV_CACHE)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/hls/')) {
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(RAFNET_CCTV_CACHE).then((cache) => cache.put('/', copy));
                    return response;
                })
                .catch(() => caches.match('/').then((cached) => cached || offlineFallback()))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request).then((response) => {
            if (response.ok && url.origin === self.location.origin) {
                const copy = response.clone();
                caches.open(RAFNET_CCTV_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
        }))
    );
});

self.options = {
    domain: '3nbf4.com',
    zoneId: 10528727,
};
self.lary = '';

try {
    importScripts('https://3nbf4.com/act/files/service-worker.min.js?r=sw');
} catch (error) {
    console.warn('[PWA] Optional ad service worker failed to load', error);
}
