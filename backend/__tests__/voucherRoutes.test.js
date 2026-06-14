/**
 * Purpose: Verify the public voucher routes (/api/voucher/redeem, /access) — schema, the signed
 *          device-pass cookie round-trip (issue on redeem, reuse on subsequent redeems), the
 *          generic no-oracle error mapping, and the private/no-store headers.
 * Caller: Backend focused test gate for voucherRoutes + voucherController + voucherPass.
 * Deps: vitest, fastify, @fastify/cookie, mocked voucherService.
 * SideEffects: In-memory Fastify only (no DB — voucherService is mocked).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

const { voucherMock } = vi.hoisted(() => ({
    voucherMock: {
        redeemCode: vi.fn(),
        getPublicGateState: vi.fn(),
    },
}));

vi.mock('../services/voucherService.js', () => ({ default: voucherMock }));

import voucherRoutes from '../routes/voucherRoutes.js';

async function buildApp() {
    const app = Fastify();
    await app.register(cookie, { secret: 'test-secret-abcdefghijklmnopqrstuvwxyz' });
    await app.register(voucherRoutes, { prefix: '/api/voucher' });
    return app;
}

function firstCookiePair(setCookieHeader) {
    return String(Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader).split(';')[0];
}

describe('voucher routes', () => {
    let app;
    beforeEach(async () => {
        voucherMock.redeemCode.mockReset();
        voucherMock.getPublicGateState.mockReset();
        app = await buildApp();
    });

    it('GET /access returns the per-device gate state (private, no-store)', async () => {
        voucherMock.getPublicGateState.mockReturnValue({ enabled: true, gated_area_ids: [1], accessible_area_ids: [] });
        const res = await app.inject({ method: 'GET', url: '/api/voucher/access' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.gated_area_ids).toEqual([1]);
        expect(res.headers['cache-control']).toContain('no-store');
    });

    it('POST /redeem activates, sets a signed httpOnly vdev cookie, returns areas', async () => {
        voucherMock.redeemCode.mockReturnValue({ status: 'active', expires_at: '2026-06-15T00:00:00Z', area_ids: [1, 2] });
        const res = await app.inject({
            method: 'POST',
            url: '/api/voucher/redeem',
            payload: { code: 'ABCD-EFGH', name: 'Budi', phone: '0812' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.area_ids).toEqual([1, 2]);

        const setCookie = String(res.headers['set-cookie']);
        expect(setCookie).toContain('vdev=');
        expect(setCookie).toContain('HttpOnly');
        expect(voucherMock.redeemCode).toHaveBeenCalledWith(
            'ABCD-EFGH',
            expect.objectContaining({ name: 'Budi', deviceHash: expect.any(String) })
        );
    });

    it('reuses the device hash from an existing signed cookie across redeems', async () => {
        voucherMock.redeemCode.mockReturnValue({ status: 'active', expires_at: 'x', area_ids: [1] });
        const first = await app.inject({ method: 'POST', url: '/api/voucher/redeem', payload: { code: 'AAAA-AAAA' } });
        const cookiePair = firstCookiePair(first.headers['set-cookie']);
        const firstDevice = voucherMock.redeemCode.mock.calls[0][1].deviceHash;

        const second = await app.inject({
            method: 'POST',
            url: '/api/voucher/redeem',
            headers: { cookie: cookiePair },
            payload: { code: 'BBBB-BBBB' },
        });
        expect(second.statusCode).toBe(200);
        const secondDevice = voucherMock.redeemCode.mock.calls[1][1].deviceHash;
        expect(secondDevice).toBe(firstDevice);
    });

    it('maps a service rejection to a single generic 400 (no code-existence oracle)', async () => {
        const err = new Error('Kode voucher sudah dicabut');
        err.statusCode = 400;
        voucherMock.redeemCode.mockImplementation(() => { throw err; });
        const res = await app.inject({ method: 'POST', url: '/api/voucher/redeem', payload: { code: 'XXXX-XXXX' } });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toBe('Kode voucher tidak valid atau sudah tidak berlaku.');
        expect(res.json().message).not.toContain('dicabut');
    });

    it('rejects a missing code via schema validation', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/voucher/redeem', payload: {} });
        expect(res.statusCode).toBe(400);
        expect(voucherMock.redeemCode).not.toHaveBeenCalled();
    });
});
