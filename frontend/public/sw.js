/*
 * Purpose: Provide RAF NET CCTV PWA app-shell caching, navigation fallback, and compatibility with existing ad worker setup.
 * Caller: Browser service worker registration at /sw.js.
 * Deps: Cache API, Fetch API, optional external ad worker script.
 * MainFuncs: install, activate, fetch, offlineFallback.
 * SideEffects: Caches public shell assets and serves an offline fallback for navigation requests.
 */

// `__SW_VERSION__` is replaced at build time (vite closeBundle plugin) with a short
// hash of the built asset filenames. Because the hash changes whenever the app's
// output changes, each deploy ships a byte-different sw.js → the browser detects a
// new service worker → install → the new worker WAITS.
//
// It waits on purpose. This used to call skipWaiting() in install and clients.claim()
// in activate, so a new worker seized a page whose HTML and JS were still the old
// build — and activate immediately deleted the cache holding the assets that running
// page was still using. registerServiceWorker then force-reloaded to paper over the
// mismatch, roughly 3s after the visitor came back (measured). A visitor reported the
// page arriving skewed with black down the right before that reload "fixed" it, which
// is what a half-styled document looks like.
//
// Now nothing takes over until the visitor accepts the update, so the old page keeps
// being served consistently by the old worker for its whole life. See
// utils/registerServiceWorker.js and components/UpdateAvailableBar.jsx.
const SW_VERSION = '__SW_VERSION__';
const RAFNET_CCTV_CACHE = `rafnet-cctv-public-${SW_VERSION}`;
const APP_SHELL_URLS = [
    '/',
    // Versioned, because index.html links them that way — caching the bare path stored an
    // entry nothing ever requests, so the manifest went to the network on every install check.
    '/site.webmanifest?v=1',
    '/admin.webmanifest?v=1',
    '/favicon.svg',
    '/admin-icon.svg',
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
    event.waitUntil(caches.open(RAFNET_CCTV_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)));
});

// The ONLY way this worker may take over early. The page posts this after the visitor
// taps "Muat ulang", and reloads itself once the takeover completes — so activate's
// cache purge below can never delete assets a live page still needs.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
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

// Third-party ad service worker import REMOVED.
//
// The previous block called importScripts('https://3nbf4.com/...service-worker.min.js'),
// which gave that remote origin the ability to install its own fetch
// handler on OUR origin's service worker. Any subsequent fetch from our
// site — including authenticated /api/* calls, /hls/* segments, and the
// CSRF / playback cookies riding along with them — would have been
// observable (and modifiable) by that external script. There is no
// configuration knob that makes that safe; the only correct action is
// to not load remote code into our SW at all.
//
// Network-side ads (AdSense, Adsterra, etc.) continue to load through the
// per-page ad slots in components/ads/* which run in normal page scope,
// not in the service worker. Service worker stays scoped to its actual
// job: app-shell caching and the offline fallback above.
