/*
 * Purpose: Cover the MediaMTX push-hook endpoint (Phase 3) — the SECURITY gate is the point of this
 *          file: a wrong secret, a non-loopback peer, or a proxied (X-Forwarded-For) request must be
 *          rejected and must NOT trigger a re-check; a valid loopback call maps the path to a camera
 *          and triggers exactly one re-check; unmapped/invalid input is a silent 200 no-op.
 * Caller:  Backend Vitest suite.
 * Deps:    internalHookController, mocked cameraHealthService + connectionPool, real config (mutated).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/cameraHealthService.js', () => ({
    default: { checkCamera: vi.fn(() => Promise.resolve(true)) },
}));
vi.mock('../database/connectionPool.js', () => ({
    queryOne: vi.fn(),
}));

const cameraHealthService = (await import('../services/cameraHealthService.js')).default;
const { queryOne } = await import('../database/connectionPool.js');
const { config } = await import('../config/config.js');
const { handleMediaMtxPathEvent } = await import('../controllers/internalHookController.js');

const SECRET = 'testsecret_ABC123';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeReply() {
    return {
        statusCode: 200,
        body: null,
        code(status) { this.statusCode = status; return this; },
        send(payload) { this.body = payload; return this; },
    };
}
// Unique camera id per triggering test so the module-level trigger's per-camera debounce (real clock)
// never suppresses a call across tests.
let nextId = 1000;
const makeRequest = (overrides = {}) => ({
    headers: { 'x-internal-secret': SECRET, ...(overrides.headers || {}) },
    socket: { remoteAddress: '127.0.0.1', ...(overrides.socket || {}) },
    query: { event: 'ready', path: UUID, ...(overrides.query || {}) },
});

beforeEach(() => {
    vi.clearAllMocks();
    config.security.internalHookSecret = SECRET;
    queryOne.mockReturnValue({ id: (nextId += 1) });
});

describe('handleMediaMtxPathEvent — security gate', () => {
    it('503 and no re-check when the feature secret is unset', async () => {
        config.security.internalHookSecret = '';
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest(), reply);
        await flush();
        expect(reply.statusCode).toBe(503);
        expect(cameraHealthService.checkCamera).not.toHaveBeenCalled();
    });

    it('403 and no re-check on a wrong secret', async () => {
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest({ headers: { 'x-internal-secret': 'wrong' } }), reply);
        await flush();
        expect(reply.statusCode).toBe(403);
        expect(cameraHealthService.checkCamera).not.toHaveBeenCalled();
    });

    it('403 and no re-check on a missing secret header', async () => {
        const reply = makeReply();
        const req = makeRequest();
        delete req.headers['x-internal-secret'];
        await handleMediaMtxPathEvent(req, reply);
        await flush();
        expect(reply.statusCode).toBe(403);
        expect(cameraHealthService.checkCamera).not.toHaveBeenCalled();
    });

    it('403 and no re-check from a NON-loopback socket peer (right secret)', async () => {
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest({ socket: { remoteAddress: '203.0.113.9' } }), reply);
        await flush();
        expect(reply.statusCode).toBe(403);
        expect(cameraHealthService.checkCamera).not.toHaveBeenCalled();
    });

    it('403 when X-Forwarded-For is present (a genuine local MediaMTX call has none)', async () => {
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest({ headers: { 'x-forwarded-for': '1.2.3.4' } }), reply);
        await flush();
        expect(reply.statusCode).toBe(403);
        expect(cameraHealthService.checkCamera).not.toHaveBeenCalled();
    });

    it('accepts the IPv4-mapped IPv6 loopback ::ffff:127.0.0.1', async () => {
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), reply);
        await flush();
        expect(reply.statusCode).toBe(200);
        expect(cameraHealthService.checkCamera).toHaveBeenCalledTimes(1);
    });
});

describe('handleMediaMtxPathEvent — mapping + trigger', () => {
    it('200 and triggers exactly one re-check for a valid ready event mapped to a camera', async () => {
        const id = 4242;
        queryOne.mockReturnValue({ id });
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest({ query: { event: 'ready', path: UUID } }), reply);
        await flush();
        expect(reply.statusCode).toBe(200);
        expect(reply.body).toEqual({ success: true });
        expect(cameraHealthService.checkCamera).toHaveBeenCalledTimes(1);
        expect(cameraHealthService.checkCamera).toHaveBeenCalledWith(id);
    });

    it('looks the camera up by stream_key on the enabled set', async () => {
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest(), reply);
        await flush();
        expect(queryOne).toHaveBeenCalledWith(
            'SELECT id FROM cameras WHERE stream_key = ? AND enabled = 1',
            [UUID]
        );
    });

    it('200 no-op (no re-check) when the path maps to no enabled camera', async () => {
        queryOne.mockReturnValue(undefined); // reserved name / deleted / disabled
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest({ query: { event: 'notready', path: 'all_others' } }), reply);
        await flush();
        expect(reply.statusCode).toBe(200);
        expect(cameraHealthService.checkCamera).not.toHaveBeenCalled();
    });

    it('200 no-op and never queries the DB for an unknown event', async () => {
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest({ query: { event: 'published', path: UUID } }), reply);
        await flush();
        expect(reply.statusCode).toBe(200);
        expect(queryOne).not.toHaveBeenCalled();
        expect(cameraHealthService.checkCamera).not.toHaveBeenCalled();
    });

    it('200 no-op and never queries the DB for a path with illegal characters', async () => {
        const reply = makeReply();
        await handleMediaMtxPathEvent(makeRequest({ query: { event: 'ready', path: '../../etc/passwd' } }), reply);
        await flush();
        expect(reply.statusCode).toBe(200);
        expect(queryOne).not.toHaveBeenCalled();
        expect(cameraHealthService.checkCamera).not.toHaveBeenCalled();
    });
});
