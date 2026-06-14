/**
 * Purpose: Verify the admin voucher routes (/api/admin/voucher/*) — flag, area-gate toggle, profile
 *          CRUD, code generation/listing/revocation — wiring, schema validation, and error mapping.
 * Deps: vitest, fastify, mocked voucherService + authMiddleware (pass-through admin).
 * SideEffects: In-memory Fastify only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { voucherMock } = vi.hoisted(() => ({
    voucherMock: {
        isFeatureEnabled: vi.fn(() => false),
        listGatedAreaIds: vi.fn(() => []),
        setFeatureEnabled: vi.fn(),
        setAreaGated: vi.fn(),
        listProfiles: vi.fn(() => []),
        createProfile: vi.fn(),
        updateProfile: vi.fn(),
        deleteProfile: vi.fn(),
        generateCodes: vi.fn(() => []),
        listCodes: vi.fn(() => []),
        revokeCode: vi.fn(),
    },
}));

vi.mock('../services/voucherService.js', () => ({ default: voucherMock }));
vi.mock('../middleware/authMiddleware.js', () => ({
    authMiddleware: async () => {},
    requireAdmin: async () => {},
}));

import voucherAdminRoutes from '../routes/voucherAdminRoutes.js';

async function buildApp() {
    const app = Fastify();
    await app.register(voucherAdminRoutes, { prefix: '/api/admin/voucher' });
    return app;
}

describe('voucher admin routes', () => {
    let app;
    beforeEach(async () => {
        Object.values(voucherMock).forEach((fn) => fn.mockReset());
        voucherMock.isFeatureEnabled.mockReturnValue(false);
        voucherMock.listGatedAreaIds.mockReturnValue([]);
        app = await buildApp();
    });

    it('GET /settings returns the flag + gated area ids', async () => {
        voucherMock.isFeatureEnabled.mockReturnValue(true);
        voucherMock.listGatedAreaIds.mockReturnValue([1, 2]);
        const res = await app.inject({ method: 'GET', url: '/api/admin/voucher/settings' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual({ enabled: true, gated_area_ids: [1, 2] });
    });

    it('PUT /settings toggles the flag', async () => {
        voucherMock.setFeatureEnabled.mockReturnValue({ enabled: true });
        const res = await app.inject({ method: 'PUT', url: '/api/admin/voucher/settings', payload: { enabled: true } });
        expect(res.statusCode).toBe(200);
        expect(voucherMock.setFeatureEnabled).toHaveBeenCalledWith(true, expect.anything());
    });

    it('PUT /settings rejects a non-boolean via schema', async () => {
        const res = await app.inject({ method: 'PUT', url: '/api/admin/voucher/settings', payload: { enabled: 'yes' } });
        expect(res.statusCode).toBe(400);
        expect(voucherMock.setFeatureEnabled).not.toHaveBeenCalled();
    });

    it('PUT /areas/:id/gate marks an area gated', async () => {
        voucherMock.setAreaGated.mockReturnValue({ area_id: 5, is_access_gated: 1 });
        const res = await app.inject({ method: 'PUT', url: '/api/admin/voucher/areas/5/gate', payload: { gated: true } });
        expect(res.statusCode).toBe(200);
        expect(voucherMock.setAreaGated).toHaveBeenCalledWith(5, true, expect.anything());
    });

    it('POST /profiles creates (service validates) and maps a 400', async () => {
        voucherMock.createProfile.mockReturnValue({ id: 1, name: 'RW Dander' });
        const ok = await app.inject({ method: 'POST', url: '/api/admin/voucher/profiles', payload: { name: 'RW Dander', price: 10000, area_ids: [1] } });
        expect(ok.statusCode).toBe(200);
        expect(ok.json().data.id).toBe(1);

        const err = new Error('Nama profil minimal 2 karakter');
        err.statusCode = 400;
        voucherMock.createProfile.mockImplementation(() => { throw err; });
        const bad = await app.inject({ method: 'POST', url: '/api/admin/voucher/profiles', payload: { name: 'x' } });
        expect(bad.statusCode).toBe(400);
    });

    it('POST /profiles/:id/codes generates a batch', async () => {
        voucherMock.generateCodes.mockReturnValue([{ id: 1, code: 'ABCD-EFGH' }]);
        const res = await app.inject({ method: 'POST', url: '/api/admin/voucher/profiles/3/codes', payload: { count: 2 } });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toHaveLength(1);
        expect(voucherMock.generateCodes).toHaveBeenCalledWith(3, 2, expect.objectContaining({ source: 'admin' }), expect.anything());
    });

    it('GET /codes lists codes with filters', async () => {
        voucherMock.listCodes.mockReturnValue([{ id: 1, code: 'X' }]);
        const res = await app.inject({ method: 'GET', url: '/api/admin/voucher/codes?profileId=3&status=unused' });
        expect(res.statusCode).toBe(200);
        expect(voucherMock.listCodes).toHaveBeenCalledWith({ profileId: 3, status: 'unused', limit: 200 });
    });

    it('POST /codes/:id/revoke revokes a code', async () => {
        voucherMock.revokeCode.mockReturnValue({ id: 9, status: 'revoked' });
        const res = await app.inject({ method: 'POST', url: '/api/admin/voucher/codes/9/revoke' });
        expect(res.statusCode).toBe(200);
        expect(voucherMock.revokeCode).toHaveBeenCalledWith(9, expect.anything());
    });

    it('DELETE /profiles/:id maps the service 400 (profile has codes)', async () => {
        const err = new Error('Tidak bisa hapus profil — sudah ada kode');
        err.statusCode = 400;
        voucherMock.deleteProfile.mockImplementation(() => { throw err; });
        const res = await app.inject({ method: 'DELETE', url: '/api/admin/voucher/profiles/3' });
        expect(res.statusCode).toBe(400);
    });
});
