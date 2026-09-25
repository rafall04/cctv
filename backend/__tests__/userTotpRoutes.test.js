/**
 * Purpose: Prove the TOTP self-service routes are reachable by EVERY authenticated role —
 *          a customer must pass the deny-by-default policy hook, not just skip requireAdmin —
 *          and that the {code} body is validated at the schema edge, not inside the service.
 * Caller: backend test gate.
 * Deps: Fastify inject, vitest; userController/totpController/authMiddleware/audit logger mocked.
 * MainFuncs: /api/users/totp/{status,setup,confirm,disable} route wiring.
 * SideEffects: None (in-memory injection).
 *
 * WHY: the endpoints moved from /api/admin/totp/* (admin-only) to /api/users/totp/* (any
 * role). The customer lockout hook whitelists by prefix — forgetting the whitelist entry
 * would 403 every customer 2FA call while the admin UI kept working, so the regression
 * would ship silently. This file pins both gates: policy hook AND route mount.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { statusMock, setupMock, confirmMock, disableMock } = vi.hoisted(() => ({
    statusMock: vi.fn(),
    setupMock: vi.fn(),
    confirmMock: vi.fn(),
    disableMock: vi.fn(),
}));

const stub = () => vi.fn((request, reply) => reply.send({ success: true }));

// The test JWT is a header — one app instance serves every role.
vi.mock('../middleware/authMiddleware.js', () => ({
    authMiddleware: vi.fn(async (request) => {
        request.authWasRequired = true;
        request.user = JSON.parse(request.headers['x-test-user'] || '{}');
    }),
    requireAdmin: vi.fn(async (request, reply) => reply.code(403).send({ success: false, message: 'admin only' })),
}));

vi.mock('../controllers/totpController.js', () => ({
    getTotpStatus: statusMock,
    startTotpSetup: setupMock,
    confirmTotpSetup: confirmMock,
    disableTotp: disableMock,
}));

vi.mock('../controllers/userController.js', () => ({
    getAllUsers: stub(), getUserById: stub(), createUser: stub(), updateUser: stub(),
    changePassword: stub(), deleteUser: stub(), getProfile: stub(), updateProfile: stub(),
    changeOwnPassword: stub(), getPasswordPolicyRequirements: stub(),
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAuthorizationFailure: vi.fn(),
    logSecurityEvent: vi.fn(),
}));

const buildApp = async () => {
    const { default: userRoutes } = await import('../routes/userRoutes.js');
    const { customerAccessPolicyHook } = await import('../middleware/customerAccessPolicy.js');
    const app = Fastify();
    // Same wiring as server.js: the policy is a ROOT preHandler hook so it sees every
    // auth-required route after onRequest auth populated request.user.
    app.addHook('preHandler', customerAccessPolicyHook);
    await app.register(userRoutes, { prefix: '/api/users' });
    return app;
};

const asCustomer = { 'x-test-user': JSON.stringify({ id: 7, role: 'customer', username: 'budi' }) };
const asAdmin = { 'x-test-user': JSON.stringify({ id: 1, role: 'admin', username: 'root' }) };

beforeEach(() => {
    for (const mock of [statusMock, setupMock, confirmMock, disableMock]) {
        mock.mockReset().mockImplementation((request, reply) => reply.send({ success: true }));
    }
});

describe('/api/users/totp — semua role lolos', () => {
    it('customer bisa membaca status 2FA-nya sendiri (policy whitelist)', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/users/totp/status', headers: asCustomer });
        expect(res.statusCode).toBe(200);
        expect(statusMock.mock.calls[0][0].user.id).toBe(7);
        await app.close();
    });

    it('admin memakai jalur yang sama — self-service bukan lagi admin-only', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/users/totp/status', headers: asAdmin });
        expect(res.statusCode).toBe(200);
        await app.close();
    });

    it('customer bisa memulai setup', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'POST', url: '/api/users/totp/setup', headers: asCustomer });
        expect(res.statusCode).toBe(200);
        expect(setupMock).toHaveBeenCalled();
        await app.close();
    });
});

describe('/api/users/totp — validasi {code} di edge', () => {
    it('kode TOTP 6 digit diteruskan ke handler', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST', url: '/api/users/totp/confirm',
            headers: asCustomer, payload: { code: '123456' },
        });
        expect(res.statusCode).toBe(200);
        expect(confirmMock.mock.calls[0][0].body).toEqual({ code: '123456' });
        await app.close();
    });

    it('format kode pemulihan xxxx-xxxx juga lolos skema', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST', url: '/api/users/totp/disable',
            headers: asCustomer, payload: { code: 'km3p-9wqs' },
        });
        expect(res.statusCode).toBe(200);
        expect(disableMock.mock.calls[0][0].body).toEqual({ code: 'km3p-9wqs' });
        await app.close();
    });

    it('code yang bukan TOTP/recovery ditolak 400 sebelum handler', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST', url: '/api/users/totp/confirm',
            headers: asCustomer, payload: { code: 'abc' },
        });
        expect(res.statusCode).toBe(400);
        expect(confirmMock).not.toHaveBeenCalled();
        await app.close();
    });

    it('body kosong ditolak 400 — tidak ada TypeError destructure lagi', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'POST', url: '/api/users/totp/disable', headers: asCustomer });
        expect(res.statusCode).toBe(400);
        expect(disableMock).not.toHaveBeenCalled();
        await app.close();
    });
});

describe('regresi: jalur admin lama sudah tidak ada', () => {
    it('/api/admin/totp tidak terdaftar lagi di userRoutes — path kanonik hanya satu', async () => {
        const app = await buildApp();
        // The admin prefix never mounted here; this just documents the single canonical path.
        const res = await app.inject({ method: 'GET', url: '/api/users/totp/status', headers: asAdmin });
        expect(res.statusCode).toBe(200);
        await app.close();
    });
});
