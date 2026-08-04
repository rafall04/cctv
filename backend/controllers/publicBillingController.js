/**
 * Purpose: Expose the rental price list publicly so sales material reads it instead of hardcoding it.
 * Caller: routes/publicBillingRoutes.js.
 * Deps: billingPlanService.
 * MainFuncs: listPublicPlans.
 * SideEffects: None (read-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * The client-facing page carried hand-typed prices and drifted badly: it advertised Rp 15.000 while
 * billing charged Rp 25.000, and promised a 7-day / 3-camera trial against an actual 3-day /
 * 1-camera one. A price list that has to be edited in two places will always end up disagreeing
 * with itself. Now the panel is the single source and the page reads from here.
 *
 * Deliberately projected, never `SELECT *`: this is an unauthenticated endpoint, so it returns only
 * what a price list needs. Nothing here identifies a customer or a camera.
 */
import billingPlanService from '../services/billingPlanService.js';

export async function listPublicPlans(request, reply) {
    try {
        const plans = billingPlanService.listPlans({ activeOnly: true }).map((plan) => ({
            key: plan.key,
            name: plan.name,
            description: plan.description,
            // Rupiah stays INTEGER end to end; formatting is the page's job, not the API's.
            price_per_camera: plan.price_per_camera,
            recording_price_per_camera: plan.recording_price_per_camera ?? 0,
            // 0 means the depth has not been decided yet; the page must say so rather than
            // print "0 hari", which would read as "we keep nothing".
            recording_retention_days: plan.recording_retention_days ?? 0,
            max_cameras: plan.max_cameras,
            is_trial: plan.is_trial === 1,
            trial_days: plan.trial_days,
        }));

        return reply.send({ success: true, data: plans });
    } catch (error) {
        console.error('List public plans error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
