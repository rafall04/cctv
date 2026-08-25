/*
 * Purpose: Prove the service worker only promotes our own successful HTML to the cached app shell.
 * Caller: Frontend Vitest suite.
 * Deps: fs, Vitest, public/sw.js evaluated in a fake ServiceWorkerGlobalScope.
 * MainFuncs: navigation fetch-handler tests.
 * SideEffects: None (no real network, no real Cache API).
 */

import fs from 'fs';
import { describe, expect, it, vi } from 'vitest';

const SW_SOURCE = fs.readFileSync('public/sw.js', 'utf8').replaceAll('__SW_VERSION__', 'test');
const ORIGIN = 'https://cctvku.raf.my.id';

/** Minimal Response stand-in: the worker only ever constructs the offline fallback. */
class FakeResponse {
    constructor(body, init) {
        this.body = body;
        this.init = init;
    }
}

function loadWorker(fetchImpl) {
    const listeners = {};
    const cache = { addAll: vi.fn(() => Promise.resolve()), put: vi.fn(() => Promise.resolve()) };
    const caches = {
        open: vi.fn(() => Promise.resolve(cache)),
        match: vi.fn(() => Promise.resolve(undefined)),
        keys: vi.fn(() => Promise.resolve([])),
        delete: vi.fn(() => Promise.resolve(true)),
    };
    const self = {
        addEventListener: (type, handler) => { listeners[type] = handler; },
        location: { origin: ORIGIN },
        clients: { claim: vi.fn(() => Promise.resolve()) },
        skipWaiting: vi.fn(),
    };
    new Function('self', 'caches', 'fetch', 'Response', 'URL', SW_SOURCE)(
        self, caches, vi.fn(fetchImpl), FakeResponse, URL
    );
    return { listeners, cache, caches };
}

/*
 * `body` default-nya adalah app shell sungguhan: worker sekarang MEMBACA isinya, karena
 * same-origin + 200 + text/html juga benar untuk halaman statis /sewa/ dan /t/ yang hidup di
 * dalam scope-nya. Tanpa isi, fixture ini tidak bisa membedakan keduanya — dan fixture yang
 * tidak bisa membedakan tidak bisa gagal.
 */
function serverResponse({ status = 200, contentType = 'text/html; charset=utf-8',
    body = '<!doctype html><html><body><div id="root"></div></body></html>' } = {}) {
    const response = {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
        text: () => Promise.resolve(body),
    };
    response.clone = () => ({ ...response, isClone: true, text: () => Promise.resolve(body) });
    return response;
}

/** Run the navigation branch and let the detached cache.open(...) chain settle. */
async function navigate(worker, url = `${ORIGIN}/playback`) {
    let answered;
    worker.listeners.fetch({
        request: { method: 'GET', mode: 'navigate', url },
        respondWith: (promise) => { answered = promise; },
    });
    const result = await answered;
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    return result;
}

/*
 * The navigation branch cached whatever came back — no response.ok, no origin, no content-type —
 * while the asset branch right below it checked all of that. So during an outage the
 * Cloudflare/nginx error page WAS the app shell, and it kept being served to visitors after the
 * server recovered, because a cached shell wins before the network is ever consulted.
 */
describe('service worker app-shell caching', () => {
    it('caches our own 200 HTML as the shell', async () => {
        const worker = loadWorker(() => Promise.resolve(serverResponse()));

        await navigate(worker);

        expect(worker.cache.put).toHaveBeenCalledWith('/', expect.objectContaining({ isClone: true }));
    });

    it.each([503, 502, 404])('never caches an outage page (%i) as the shell', async (status) => {
        const worker = loadWorker(() => Promise.resolve(serverResponse({ status })));

        const result = await navigate(worker);

        expect(worker.cache.put).not.toHaveBeenCalled();
        // The visitor still gets the real response — this guard is about the cache, not the reply.
        expect(result.status).toBe(status);
    });

    it('never caches a non-HTML 200 as the shell', async () => {
        const worker = loadWorker(() => Promise.resolve(serverResponse({ contentType: 'application/json' })));

        await navigate(worker);

        expect(worker.cache.put).not.toHaveBeenCalled();
    });

    it('falls back to the offline page when the network is gone and nothing is cached', async () => {
        const worker = loadWorker(() => Promise.reject(new Error('offline')));

        const result = await navigate(worker);

        expect(worker.caches.match).toHaveBeenCalledWith('/');
        expect(result.body).toContain('RAF CCTV sedang offline');
    });

    /* The update flow stays visitor-controlled: takeover only via the SKIP_WAITING message. */
    it('does not seize a live page — skipWaiting is reachable only from the message handler', () => {
        expect(SW_SOURCE.match(/self\.skipWaiting\(\)/g)).toHaveLength(1);
        expect(SW_SOURCE).toContain("event.data.type === 'SKIP_WAITING'");
    });
    /*
     * REGRESI YANG DICEGAH DI SINI: halaman jualan statis di /sewa/ adalah 200 text/html
     * same-origin, jadi ketiga syarat isCacheableShell menerimanya dan ia ditulis ke kunci
     * '/' — MENGGANTIKAN app shell. Kunjungan offline berikutnya menampilkan halaman jualan
     * alih-alih aplikasi.
     *
     * Jalur ini bukan hal langka: tombol "Sewa" di navbar publik menuju ke sana.
     */
    it('tidak menjadikan halaman statis /sewa/ sebagai app shell', async () => {
        const halamanJualan = '<!doctype html><html><body><h1>Sewa CCTV</h1></body></html>';
        const worker = loadWorker(() => Promise.resolve(serverResponse({ body: halamanJualan })));

        await navigate(worker, `${ORIGIN}/sewa/`);

        expect(worker.cache.put).not.toHaveBeenCalled();
    });

    it('tetap menyimpan rute SPA sungguhan, yang memasang React ke #root', async () => {
        const worker = loadWorker(() => Promise.resolve(serverResponse()));

        await navigate(worker, `${ORIGIN}/area/dander`);

        expect(worker.cache.put).toHaveBeenCalledWith('/', expect.anything());
    });
});
