/*
Unit tests for the node-provisioning gate (audit 2026-09-22, F1):
GET /api/admin/audio/node/install and /node/agent served the installer + agent source to ANY
anonymous caller under an /api/admin/* prefix. They now require x-device-token, which exists
before install because the operator creates the node in the admin UI first.
connectionPool is mocked — authDevice is just one SELECT by token.
*/

import { vi, describe, it, expect, beforeEach } from 'vitest';

const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: () => [],
    queryOne: queryOneMock,
    execute: () => ({ changes: 0 }),
}));

const { nodeInstallScript, nodeAgentScript } = await import('../controllers/audioDeviceController.js');

const GOOD = 'spk-valid-token';
const req = (headers = {}) => ({ headers, log: { error: () => {} } });
const res = () => {
    const r = { status: 200, body: null, headers: {} };
    r.code = (c) => { r.status = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.header = (k, v) => { r.headers[k] = v; return r; };
    r.type = (t) => { r.headers['Content-Type'] = t; return r; };
    return r;
};

describe('node provisioning endpoints require x-device-token', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // authDevice: SELECT * FROM audio_devices WHERE token = ? AND enabled = 1
        queryOneMock.mockImplementation((_sql, [token]) => (token === GOOD ? { id: 7, token: GOOD } : null));
    });

    it.each([nodeInstallScript, nodeAgentScript])('rejects anonymous callers with 401', async (handler) => {
        const r = res();
        await handler(req(), r);
        expect(r.status).toBe(401);
        expect(r.body).toMatchObject({ success: false });
    });

    it.each([nodeInstallScript, nodeAgentScript])('rejects an unknown/disabled token with 401', async (handler) => {
        const r = res();
        await handler(req({ 'x-device-token': 'spk-wrong' }), r);
        expect(r.status).toBe(401);
    });

    it('serves the installer to a valid device token, with HUB_URL baked in', async () => {
        const r = res();
        await nodeInstallScript(req({ 'x-device-token': GOOD, host: 'cctv.raf.my.id' }), r);
        expect(r.status).toBe(200);
        expect(String(r.body)).toContain('x-device-token');
        expect(String(r.body)).toContain('https://cctv.raf.my.id'); // __HUB_URL__ replaced
    });

    it('serves the agent source to a valid device token', async () => {
        const r = res();
        await nodeAgentScript(req({ 'x-device-token': GOOD }), r);
        expect(r.status).toBe(200);
        expect(r.headers['Content-Type']).toContain('text/x-python');
    });
});
