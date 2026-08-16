/**
 * Purpose: Prove the plan-pricing fields survive the ROUTE SCHEMA, not just the service.
 * Caller: backend test gate.
 * Deps: Fastify, vitest, billingAdminRoutes with controller + auth mocked.
 * MainFuncs: POST /plans, PUT /plans/:id body schema.
 * SideEffects: In-memory Fastify injection only.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * recording_price_per_camera shipped with a migration, service support, a panel input and six
 * passing tests — and did nothing. Every one of those tests called billingPlanService directly,
 * so none of them crossed the route schema, and the route schema never listed the field.
 *
 * Fastify defaults to ajv `removeAdditional: true`. With `additionalProperties: false` that does
 * not reject an unlisted field, it silently DELETES it: the PUT returns 200, the admin sees a
 * saved-looking form, and the price never changes. Verified on production before the fix — the
 * request reached the backend twice and the column stayed 0 both times.
 *
 * So this file asserts at the only layer that was untested: what the handler actually receives.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createPlanMock, updatePlanMock } = vi.hoisted(() => ({
    createPlanMock: vi.fn(),
    updatePlanMock: vi.fn(),
}));

// Only the two plan handlers matter; the rest must merely exist, or registering the plugin throws.
// Listed explicitly because Vitest's ESM mocking resolves real named exports — a Proxy is not one.
const stub = () => vi.fn((request, reply) => reply.send({ success: true }));
vi.mock('../controllers/billingAdminController.js', () => ({
    createPlan: createPlanMock,
    updatePlan: updatePlanMock,
    listCustomers: stub(), manualTopup: stub(), adjustWallet: stub(),
    listSubscriptions: stub(), assignSubscription: stub(), updateSubscription: stub(),
    setCameraClass: stub(), unpublishCamera: stub(),
    listPayments: stub(), markPaymentPaid: stub(), runCharges: stub(),
    listPlansAdmin: stub(), changeCustomerPlan: stub(),
    getRegistrationSettings: stub(), updateRegistrationSettings: stub(),
    listRegistrations: stub(), approveRegistration: stub(), rejectRegistration: stub(),
    getPaymentGateway: stub(), updatePaymentGateway: stub(), testPaymentGateway: stub(),
    listPaymentGatewayChannels: stub(), listCustomerCameraIps: stub(),
    listPromos: stub(), createPromo: stub(), updatePromo: stub(), deletePromo: stub(),
    healOrphans: stub(),
}));

vi.mock('../middleware/authMiddleware.js', () => ({
    authMiddleware: vi.fn(async () => {}),
    requireAdmin: vi.fn(async () => {}),
}));

const buildApp = async () => {
    const { default: billingAdminRoutes } = await import('../routes/billingAdminRoutes.js');
    const app = Fastify();
    await app.register(billingAdminRoutes, { prefix: '/api/admin/billing' });
    return app;
};

const BASE_PLAN = { key: 'uji', name: 'Paket Uji', price_per_camera: 25000, max_cameras: 4 };

beforeEach(() => {
    createPlanMock.mockReset().mockImplementation((request, reply) => reply.send({ success: true }));
    updatePlanMock.mockReset().mockImplementation((request, reply) => reply.send({ success: true }));
});

describe('harga rekaman menembus skema rute', () => {
    it('PUT /plans/:id meneruskan recording_price_per_camera ke handler', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'PUT',
            url: '/api/admin/billing/plans/2',
            payload: { recording_price_per_camera: 7000 },
        });

        expect(res.statusCode).toBe(200);
        // Before the fix this body was {} — stripped, with a 200 to hide it.
        expect(updatePlanMock.mock.calls[0][0].body).toEqual({ recording_price_per_camera: 7000 });
        await app.close();
    });

    it('POST /plans meneruskan recording_price_per_camera ke handler', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST',
            url: '/api/admin/billing/plans',
            payload: { ...BASE_PLAN, recording_price_per_camera: 5000 },
        });

        expect(res.statusCode).toBe(200);
        expect(createPlanMock.mock.calls[0][0].body.recording_price_per_camera).toBe(5000);
        await app.close();
    });

    it('0 tetap terkirim, bukan dibuang sebagai nilai kosong', async () => {
        // Clearing a surcharge is a real edit; a falsy-value bug here would make it un-clearable.
        const app = await buildApp();
        await app.inject({
            method: 'PUT',
            url: '/api/admin/billing/plans/2',
            payload: { recording_price_per_camera: 0 },
        });

        expect(updatePlanMock.mock.calls[0][0].body).toEqual({ recording_price_per_camera: 0 });
        await app.close();
    });

    it('harga rekaman negatif ditolak di perbatasan', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'PUT',
            url: '/api/admin/billing/plans/2',
            payload: { recording_price_per_camera: -1 },
        });

        expect(res.statusCode).toBe(400);
        expect(updatePlanMock).not.toHaveBeenCalled();
        await app.close();
    });

    it('PUT /plans/:id meneruskan recording_retention_days ke handler', async () => {
        // Added the day after the surcharge bug, through the same three layers — so the same
        // silent-strip failure would repeat exactly here if the schema were forgotten again.
        const app = await buildApp();
        const res = await app.inject({
            method: 'PUT',
            url: '/api/admin/billing/plans/2',
            payload: { recording_retention_days: 7 },
        });

        expect(res.statusCode).toBe(200);
        expect(updatePlanMock.mock.calls[0][0].body).toEqual({ recording_retention_days: 7 });
        await app.close();
    });

    it('retensi di luar 0-365 hari ditolak di perbatasan', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'PUT',
            url: '/api/admin/billing/plans/2',
            payload: { recording_retention_days: 400 },
        });

        expect(res.statusCode).toBe(400);
        expect(updatePlanMock).not.toHaveBeenCalled();
        await app.close();
    });

    it('field yang benar-benar asing tetap dibuang diam-diam (ini mekanismenya)', async () => {
        // Documents the behaviour that caused the bug, so the next reader does not have to
        // rediscover why an unlisted field produces a 200 and no change.
        const app = await buildApp();
        const res = await app.inject({
            method: 'PUT',
            url: '/api/admin/billing/plans/2',
            payload: { recording_price_per_camera: 3000, kolom_yang_tidak_ada: 999 },
        });

        expect(res.statusCode).toBe(200);
        expect(updatePlanMock.mock.calls[0][0].body).toEqual({ recording_price_per_camera: 3000 });
        await app.close();
    });
});
