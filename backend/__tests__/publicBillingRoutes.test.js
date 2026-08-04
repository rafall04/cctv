/**
 * Purpose: Lock the public price list — it is unauthenticated, so what it returns is what the
 *          whole internet sees, and it is now the single source the sales page renders from.
 * Caller: backend test gate.
 * Deps: Fastify, vitest, billingPlanService + cacheMiddleware mocked.
 * SideEffects: In-memory Fastify injection only.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listPlansMock } = vi.hoisted(() => ({ listPlansMock: vi.fn() }));

vi.mock('../services/billingPlanService.js', () => ({
    default: { listPlans: listPlansMock },
}));

vi.mock('../middleware/cacheMiddleware.js', () => ({
    cacheMiddleware: () => async () => {},
    invalidateCache: vi.fn(),
}));

const ROW = {
    id: 2, key: 'basic', name: 'Basic', description: 'Rumah, satu titik pantau',
    price_per_camera: 25000, recording_price_per_camera: 15000, max_cameras: 1,
    is_trial: 0, trial_days: null, active: 1, sort_order: 2,
    // Columns a price list has no business publishing.
    created_at: '2026-01-01', updated_at: '2026-08-04',
};

const build = async () => {
    const { default: routes } = await import('../routes/publicBillingRoutes.js');
    const app = Fastify();
    await app.register(routes, { prefix: '/api/public/billing' });
    return app;
};

const get = async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/public/billing/plans' });
    await app.close();
    return { status: res.statusCode, body: res.json() };
};

beforeEach(() => listPlansMock.mockReset().mockReturnValue([ROW]));

describe('GET /api/public/billing/plans', () => {
    it('serves the price list without any authentication', async () => {
        const { status, body } = await get();
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toHaveLength(1);
    });

    it('asks for ACTIVE plans only — a retired plan must not be quoted to anyone', async () => {
        await get();
        expect(listPlansMock).toHaveBeenCalledWith({ activeOnly: true });
    });

    it('returns both prices as integer rupiah', async () => {
        const { body } = await get();
        const plan = body.data[0];
        expect(plan.price_per_camera).toBe(25000);
        expect(plan.recording_price_per_camera).toBe(15000);
        expect(Number.isInteger(plan.price_per_camera)).toBe(true);
        expect(Number.isInteger(plan.recording_price_per_camera)).toBe(true);
    });

    it('publishes only price-list fields, never the whole row', async () => {
        const { body } = await get();
        expect(Object.keys(body.data[0]).sort()).toEqual([
            'description', 'is_trial', 'key', 'max_cameras', 'name',
            'price_per_camera', 'recording_price_per_camera', 'trial_days',
        ]);
    });

    it('treats a plan predating the recording column as 0, not null', async () => {
        // Older rows can carry NULL; the page would print "Rp null" if that leaked through.
        listPlansMock.mockReturnValue([{ ...ROW, recording_price_per_camera: null }]);
        const { body } = await get();
        expect(body.data[0].recording_price_per_camera).toBe(0);
    });

    it('reports is_trial as a boolean and keeps trial_days', async () => {
        listPlansMock.mockReturnValue([{ ...ROW, is_trial: 1, trial_days: 3 }]);
        const { body } = await get();
        expect(body.data[0].is_trial).toBe(true);
        expect(body.data[0].trial_days).toBe(3);
    });

    it('fails closed with 500 rather than leaking the error to the public', async () => {
        // Two deliberate details, both learned the hard way here:
        //
        // 1. `mockImplementationOnce(throw).mockReturnValue([])`, never a bare
        //    `mockImplementation(throw)`. A permanently-throwing implementation is surfaced by
        //    Vitest as an unhandled error and fails the test even though the handler catches it
        //    and returns a correct 500 — the assertions all passed while the test went red.
        // 2. The controller logs the real error to stderr on purpose (an unreachable plans table
        //    IS something an operator must see), so the expected noise is silenced and then
        //    asserted, which keeps the logging itself covered rather than merely quiet.
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        listPlansMock.mockImplementationOnce(() => { throw new Error('kolom rusak'); }).mockReturnValue([]);

        const { status, body } = await get();
        expect(listPlansMock).toHaveBeenCalledTimes(1);

        expect(status).toBe(500);
        expect(JSON.stringify(body)).not.toContain('kolom rusak');
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});
