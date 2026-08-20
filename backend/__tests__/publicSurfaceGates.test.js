/**
 * Purpose: Pin the AUTH gates that a public-surface sweep found missing, and the credential strip
 *          that stands in for a gate where one would have broken a legitimate user.
 * Caller: Vitest backend suite.
 * Deps: a real Fastify instance via inject() for the route-level gates; direct calls for the rest.
 *
 * WHY THESE ARE SEPARATE FROM publicSurfaceProjections.test.js
 * ------------------------------------------------------------
 * Those tests ask "what does this row contain". These ask "who is allowed to ask at all" — a
 * different failure mode, found the same day and by the same sweep, but fixed with a preHandler
 * rather than a column list. Keeping them apart means a future reader can tell at a glance which
 * kind of defence they are about to weaken.
 *
 * The cache tests use a REAL Fastify instance rather than asserting on the route table, because
 * the bug was not "the gate is the wrong one" but "there is no gate, and the paths are not the
 * paths anybody thought they were". Only actually mounting the plugin and calling it can catch
 * both halves of that.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/*
 * The real authMiddleware would need a signed JWT, a users table and a session store to say "no".
 * The rule under test is only whether the handler sits BEHIND those two functions at all, so they
 * are stubbed to a deterministic 401/403 and their identity is what the assertions check.
 */
vi.mock('../middleware/authMiddleware.js', () => ({
    authMiddleware: async (request, reply) => {
        if (!request.headers['x-test-user']) {
            return reply.code(401).send({ success: false, message: 'unauthenticated' });
        }
        request.user = { id: 1, role: request.headers['x-test-user'] };
        return undefined;
    },
    requireAdmin: async (request, reply) => {
        if (request.user?.role !== 'admin') {
            return reply.code(403).send({ success: false, message: 'admin only' });
        }
        return undefined;
    },
}));

const { cachePlugin } = await import('../middleware/cacheMiddleware.js');
const { getCameraById } = await import('../controllers/cameraController.js');
const cameraService = (await import('../services/cameraService.js')).default;

function buildApp() {
    const app = Fastify({ logger: false });
    // Registered exactly as server.js does it — the prefix comes from here, not from the plugin.
    app.register(cachePlugin, { prefix: '/api/cache' });
    return app;
}

describe('/api/cache/* — endpoint yang dulu terbuka untuk siapa saja', () => {
    /*
     * Every one of these carried an "(admin only)" comment and nothing enforced it. The two POSTs
     * are the sharp end: an anonymous caller could flush the server-side response cache by pattern,
     * forcing every cached public read model to be recomputed from SQLite on demand — on a box that
     * is also running the recorders. An availability problem written as a comment.
     */
    it.each([
        ['GET', '/api/cache/stats'],
        ['POST', '/api/cache/invalidate'],
        ['POST', '/api/cache/clear'],
    ])('%s %s menolak pemanggil anonim', async (method, url) => {
        const app = buildApp();
        const response = await app.inject({ method, url, payload: method === 'POST' ? { pattern: 'x' } : undefined });

        expect(response.statusCode).toBe(401);
        await app.close();
    });

    it.each([
        ['GET', '/api/cache/stats'],
        ['POST', '/api/cache/invalidate'],
        ['POST', '/api/cache/clear'],
    ])('%s %s menolak pengguna yang login tapi bukan admin', async (method, url) => {
        const app = buildApp();
        const response = await app.inject({
            method, url,
            headers: { 'x-test-user': 'viewer' },
            payload: method === 'POST' ? { pattern: 'x' } : undefined,
        });

        expect(response.statusCode).toBe(403);
        await app.close();
    });

    it('admin tetap bisa membaca statistik cache', async () => {
        const app = buildApp();
        const response = await app.inject({
            method: 'GET', url: '/api/cache/stats', headers: { 'x-test-user': 'admin' },
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).success).toBe(true);
        await app.close();
    });

    /*
     * The second half of the bug. Fastify applies the register() prefix to the encapsulated
     * instance AND still hands it to the plugin, which used to prepend it a second time — so the
     * real path was /api/cache/api/cache/stats while the /api/cache/stats that server.js prints on
     * boot answered 404. That is why an open endpoint went unnoticed for so long: it was too broken
     * to be used, and not broken enough to be reported.
     */
    it('jalurnya tidak terduplikasi lagi', async () => {
        const app = buildApp();
        const doubled = await app.inject({
            method: 'GET', url: '/api/cache/api/cache/stats', headers: { 'x-test-user': 'admin' },
        });

        expect(doubled.statusCode).toBe(404);
        await app.close();
    });
});

describe('GET /api/cameras/:id — kredensial disaring untuk non-admin', () => {
    const CAMERA_ROW = {
        id: 11,
        name: 'CCTV LAPANGAN DANDER',
        private_rtsp_url: 'rtsp://admin:rahasia@10.0.0.11:554/stream1',
        stream_key: 'sk_lapangan',
        camera_class: 'community',
    };

    const reply = () => {
        const sent = {};
        return {
            sent,
            code(status) { sent.status = status; return this; },
            send(payload) { sent.payload = payload; return this; },
        };
    };

    beforeEach(() => {
        vi.spyOn(cameraService, 'getCameraDetailById').mockImplementation(() => ({ ...CAMERA_ROW }));
    });

    /*
     * This route requires a login but NOT requireAdmin, and `viewer` is a real staff role — the
     * Camera Management page is reachable by both. So every viewer account could read every
     * camera's RTSP credentials, against the Critical Invariant that RTSP URLs never reach the
     * frontend at all.
     *
     * Gating the route would have been the wrong fix: viewers are meant to open that page. What
     * they may not do is EDIT — PUT /:id does carry requireAdmin — so the credentials are only ever
     * needed by an admin filling the form.
     */
    it('peran viewer tidak menerima RTSP maupun stream key', async () => {
        const res = reply();
        await getCameraById({ params: { id: 11 }, user: { role: 'viewer' } }, res);

        expect(res.sent.payload.data).not.toHaveProperty('private_rtsp_url');
        expect(res.sent.payload.data).not.toHaveProperty('stream_key');
        expect(res.sent.payload.data.name).toBe('CCTV LAPANGAN DANDER');
    });

    it('permintaan tanpa peran sama sekali juga disaring', async () => {
        const res = reply();
        await getCameraById({ params: { id: 11 } }, res);

        expect(res.sent.payload.data).not.toHaveProperty('private_rtsp_url');
    });

    it('admin TETAP menerimanya — formulir edit membutuhkannya', async () => {
        const res = reply();
        await getCameraById({ params: { id: 11 }, user: { role: 'admin' } }, res);

        expect(res.sent.payload.data.private_rtsp_url).toBe(CAMERA_ROW.private_rtsp_url);
        expect(res.sent.payload.data.stream_key).toBe('sk_lapangan');
    });

    /* The strip works on a copy of the service's row, so it must not corrupt any shared cache. */
    it('penyaringan tidak merusak baris untuk pemanggil berikutnya', async () => {
        await getCameraById({ params: { id: 11 }, user: { role: 'viewer' } }, reply());
        const res = reply();
        await getCameraById({ params: { id: 11 }, user: { role: 'admin' } }, res);

        expect(res.sent.payload.data.private_rtsp_url).toBe(CAMERA_ROW.private_rtsp_url);
    });
});
