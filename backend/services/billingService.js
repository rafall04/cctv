/**
 * Purpose: Subscription billing engine — admin camera→customer assignment, daily prorated
 *          wallet charges, suspend on empty balance, auto-resume on top-up.
 * Caller: billingAdminRoutes, customerRoutes, paymentService (after credit), server.js scheduler.
 * Deps: connectionPool, walletService, cameraService (cache invalidation), timezoneService.
 * MainFuncs: assignSubscription, updateSubscription, setCameraClass, runDailyCharges,
 *            tryResumeForUser, getCustomerBillingSummary, start/stopBillingScheduler.
 * SideEffects: Writes camera_subscriptions/cameras/wallet rows; runs an hourly interval timer.
 *
 * State model:
 *   subscription.status 'active'    → charged daily, camera.billing_status 'active'.
 *   subscription.status 'suspended' → balance ran out (or admin paused); auto-resumes (with an
 *                                     immediate charge) as soon as the wallet covers a day.
 *   subscription.status 'cancelled' → admin termination; never auto-resumes. Camera stays
 *                                     billing-suspended until the admin re-assigns or reclasses.
 *
 * Idempotency: charges are keyed `charge:{subscriptionId}:{YYYY-MM-DD}` (server-local date,
 * Asia/Jakarta by default) and the DB has a partial UNIQUE index on that reference, so the
 * hourly tick, restarts, and topup-triggered resume can never double-charge a day.
 */

import { query, queryOne, execute } from '../database/connectionPool.js';
import walletService from './walletService.js';
import cameraService from './cameraService.js';
import { invalidateCameraAccessCache } from './cameraAccessService.js';
import { getTimezone } from './timezoneService.js';
import settingsService from './settingsService.js';
import { logAdminAction } from './securityAuditLogger.js';

const HOURLY_TICK_MS = 60 * 60 * 1000;
const INITIAL_TICK_DELAY_MS = 20 * 1000;

export function dailyCostOf(monthlyPrice) {
    if (!monthlyPrice || monthlyPrice <= 0) {
        return 0; // free (trial/admin-free) subscriptions never touch the wallet
    }
    return Math.max(1, Math.round(monthlyPrice / 30));
}

export function localDateString(now = new Date()) {
    let timeZone;
    try {
        timeZone = getTimezone() || 'Asia/Jakarta';
    } catch {
        timeZone = 'Asia/Jakarta';
    }
    try {
        // en-CA renders as YYYY-MM-DD.
        return now.toLocaleDateString('en-CA', { timeZone });
    } catch {
        return now.toISOString().slice(0, 10);
    }
}

function chargeReference(subscriptionId, dateString) {
    return `charge:${subscriptionId}:${dateString}`;
}

class BillingService {
    constructor() {
        this._timer = null;
        this._initialTimer = null;
        this._running = false;
    }

    // ------------------------------------------------------------------
    // Pricing: one price per subscription, never a second charge path
    // ------------------------------------------------------------------
    /*
     * A recording camera costs more to run, so plans carry a surcharge on top of the watch price.
     * That surcharge is folded into `monthly_price` rather than deducted separately, deliberately:
     *
     *  - _chargeAndSync already owns the daily deduction, the trial gate, suspension on an empty
     *    wallet, and same-day idempotence via last_charged_date. A second deduction path would
     *    double every place money can go wrong.
     *  - dailyCostOf() stays the single rounding point. Rounding two halves separately drifts from
     *    rounding the sum, and a rupiah a day is a difference nobody can explain to a customer.
     *  - The wallet history stays one readable line per camera per day.
     *
     * Which cameras pay it is not a new concept either: cameras.enable_recording already exists.
     */
    monthlyPriceFor(cameraId) {
        const row = queryOne(
            `SELECT COALESCE(c.enable_recording, 0) AS merekam,
                    p.price_per_camera, p.recording_price_per_camera
             FROM cameras c
             JOIN camera_subscriptions s ON s.camera_id = c.id
             JOIN users u ON u.id = s.user_id
             JOIN billing_plans p ON p.id = u.plan_id
             WHERE c.id = ?`,
            [cameraId]
        );
        if (!row) return null; // no subscription, or owner has no plan — nothing to reprice

        const surcharge = row.merekam === 1 ? (row.recording_price_per_camera ?? 0) : 0;
        return row.price_per_camera + surcharge;
    }

    /** Price on the user's plan before a subscription row exists (monthlyPriceFor reads through one). */
    _planPriceFor(userId, cameraId) {
        const row = queryOne(
            `SELECT COALESCE(c.enable_recording, 0) AS merekam,
                    p.price_per_camera, p.recording_price_per_camera
             FROM cameras c, users u
             JOIN billing_plans p ON p.id = u.plan_id
             WHERE c.id = ? AND u.id = ?`,
            [cameraId, userId]
        );
        if (!row) return 0; // no plan yet — free until one is chosen, same as the trial path
        return row.price_per_camera + (row.merekam === 1 ? (row.recording_price_per_camera ?? 0) : 0);
    }

    /** Re-derive one camera's price, e.g. after its recording flag was switched. */
    repriceSubscriptionForCamera(cameraId) {
        const price = this.monthlyPriceFor(cameraId);
        if (price === null) return null;

        execute(
            `UPDATE camera_subscriptions
             SET monthly_price = ?, updated_at = CURRENT_TIMESTAMP
             WHERE camera_id = ? AND status != 'cancelled'`,
            [price, cameraId]
        );
        return price;
    }

    /**
     * Re-derive every subscription on a plan after its prices change.
     *
     * This replaced a flat `SET monthly_price = <price_per_camera>` across the whole plan, which
     * would have wiped the recording surcharge off every subscription the first time an admin
     * edited any plan price — silently, since the catalog would still advertise the surcharge.
     * The CASE re-reads each camera's own flag, so recording and non-recording cameras on the same
     * plan land on their own correct price.
     */
    repriceSubscriptionsForPlan(planId) {
        const result = execute(
            `UPDATE camera_subscriptions
             SET monthly_price = (
                     SELECT p.price_per_camera
                            + CASE WHEN COALESCE(c.enable_recording, 0) = 1
                                   THEN COALESCE(p.recording_price_per_camera, 0) ELSE 0 END
                     FROM cameras c, billing_plans p
                     WHERE c.id = camera_subscriptions.camera_id AND p.id = ?
                 ),
                 updated_at = CURRENT_TIMESTAMP
             WHERE status != 'cancelled'
               AND user_id IN (SELECT id FROM users WHERE plan_id = ?)`,
            [planId, planId]
        );
        return result.changes;
    }

    // ------------------------------------------------------------------
    // Admin: assignment & lifecycle
    // ------------------------------------------------------------------

    assignSubscription({ camera_id, user_id, monthly_price }, request = null) {
        const cameraId = Number(camera_id);
        const userId = Number(user_id);
        // An explicit price is an admin override (a negotiated discount, say) and always wins.
        // Omit it and the plan decides, surcharge included — so a caller that does not want to
        // re-derive the pricing rules simply leaves it out instead of guessing.
        const priceDiberikan = monthly_price !== undefined && monthly_price !== null && monthly_price !== '';
        const price = priceDiberikan ? Number(monthly_price) : this._planPriceFor(userId, cameraId);

        if (!Number.isInteger(cameraId) || cameraId <= 0) {
            const err = new Error('camera_id is required');
            err.statusCode = 400;
            throw err;
        }
        if (!Number.isInteger(userId) || userId <= 0) {
            const err = new Error('user_id is required');
            err.statusCode = 400;
            throw err;
        }
        if (!Number.isInteger(price) || price < 0) {
            const err = new Error('monthly_price must be a non-negative integer (rupiah)');
            err.statusCode = 400;
            throw err;
        }

        const camera = queryOne('SELECT id, name, owner_user_id FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }
        const user = queryOne('SELECT id, username, role FROM users WHERE id = ?', [userId]);
        if (!user) {
            const err = new Error('User not found');
            err.statusCode = 404;
            throw err;
        }
        if (user.role !== 'customer') {
            const err = new Error('Subscriptions can only be assigned to customer-role users');
            err.statusCode = 400;
            throw err;
        }

        const existing = queryOne('SELECT * FROM camera_subscriptions WHERE camera_id = ?', [cameraId]);
        let subscriptionId;
        if (existing) {
            execute(
                `UPDATE camera_subscriptions
                 SET user_id = ?, monthly_price = ?, status = 'active',
                     activated_at = CURRENT_TIMESTAMP, suspended_at = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [userId, price, existing.id]
            );
            subscriptionId = existing.id;
        } else {
            const result = execute(
                `INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status, activated_at)
                 VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)`,
                [cameraId, userId, price]
            );
            subscriptionId = result.lastInsertRowid;
        }

        // Handover never inherits the previous holder's publish choice: only a re-assignment to the
        // SAME owner keeps is_public, so B never finds A's camera already broadcasting under B's name.
        execute(
            `UPDATE cameras
             SET owner_user_id = ?, camera_class = 'subscriber', billing_status = 'active',
                 is_public = CASE WHEN COALESCE(owner_user_id, 0) = ? THEN is_public ELSE 0 END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [userId, userId, cameraId]
        );
        walletService.ensureWallet(userId);
        invalidateCameraAccessCache(cameraId);
        cameraService.invalidateCameraCache();

        // Day-one charge: service starts today, so today is billed immediately.
        // Insufficient balance → the camera starts suspended until a top-up lands.
        const subscription = queryOne('SELECT * FROM camera_subscriptions WHERE id = ?', [subscriptionId]);
        const chargeResult = this._chargeAndSync(subscription, localDateString());

        if (request) {
            logAdminAction({
                action: 'billing_subscription_assigned',
                cameraId,
                cameraName: camera.name,
                customerId: userId,
                customerUsername: user.username,
                monthlyPrice: price,
                initialStatus: chargeResult.status,
            }, request);
        }

        return this.getSubscriptionById(subscriptionId);
    }

    updateSubscription(id, { monthly_price, status }, request = null) {
        const subscription = queryOne('SELECT * FROM camera_subscriptions WHERE id = ?', [id]);
        if (!subscription) {
            const err = new Error('Subscription not found');
            err.statusCode = 404;
            throw err;
        }

        if (monthly_price !== undefined) {
            const price = Number(monthly_price);
            if (!Number.isInteger(price) || price <= 0) {
                const err = new Error('monthly_price must be a positive integer (rupiah)');
                err.statusCode = 400;
                throw err;
            }
            execute(
                'UPDATE camera_subscriptions SET monthly_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [price, id]
            );
        }

        if (status !== undefined) {
            if (!['active', 'suspended', 'cancelled'].includes(status)) {
                const err = new Error('Invalid subscription status');
                err.statusCode = 400;
                throw err;
            }
            if (status === 'active') {
                // Reactivation runs through the charge path so "active" always
                // means "paid for today" (or instantly re-suspends when broke).
                const fresh = queryOne('SELECT * FROM camera_subscriptions WHERE id = ?', [id]);
                this._chargeAndSync({ ...fresh, status: 'suspended' }, localDateString());
            } else {
                execute(
                    `UPDATE camera_subscriptions
                     SET status = ?, suspended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [status, id]
                );
                execute(
                    "UPDATE cameras SET billing_status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [subscription.camera_id]
                );
                cameraService.invalidateCameraCache();
            }
        }

        if (request) {
            logAdminAction({
                action: 'billing_subscription_updated',
                subscriptionId: Number(id),
                cameraId: subscription.camera_id,
                changes: { monthly_price, status },
            }, request);
        }

        return this.getSubscriptionById(id);
    }

    /**
     * Admin reclass for non-subscriber flows: community (public hub) or
     * owner_private (staff-assigned private camera, no billing). Subscriber
     * class must go through assignSubscription so billing state stays coherent.
     */
    setCameraClass(cameraId, { camera_class, owner_user_id = null }, request = null) {
        if (!['community', 'owner_private'].includes(camera_class)) {
            const err = new Error('camera_class must be community or owner_private (use subscription assignment for subscriber)');
            err.statusCode = 400;
            throw err;
        }

        const camera = queryOne('SELECT id, name FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        const activeSubscription = queryOne(
            "SELECT id FROM camera_subscriptions WHERE camera_id = ? AND status != 'cancelled'",
            [cameraId]
        );
        if (activeSubscription) {
            const err = new Error('Cancel the camera subscription before changing its class');
            err.statusCode = 400;
            throw err;
        }

        let ownerId = null;
        if (camera_class === 'owner_private') {
            ownerId = Number(owner_user_id);
            if (!Number.isInteger(ownerId) || ownerId <= 0) {
                const err = new Error('owner_user_id is required for owner_private cameras');
                err.statusCode = 400;
                throw err;
            }
            const owner = queryOne('SELECT id FROM users WHERE id = ?', [ownerId]);
            if (!owner) {
                const err = new Error('Owner user not found');
                err.statusCode = 404;
                throw err;
            }
        }

        execute(
            `UPDATE cameras
             SET camera_class = ?, owner_user_id = ?, billing_status = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [camera_class, ownerId, cameraId]
        );
        // Both caches. The list cache alone made a camera vanish from public PAGES instantly while
        // the live stream stayed openable to anyone holding the URL for up to the access cache's
        // 30s TTL — the wrong half to leave running when an operator has just said "make it private".
        invalidateCameraAccessCache(cameraId);
        cameraService.invalidateCameraCache();

        if (request) {
            logAdminAction({
                action: 'billing_camera_class_changed',
                cameraId: Number(cameraId),
                cameraName: camera.name,
                cameraClass: camera_class,
                ownerUserId: ownerId,
            }, request);
        }

        return queryOne(
            'SELECT id, name, camera_class, owner_user_id, billing_status FROM cameras WHERE id = ?',
            [cameraId]
        );
    }

    // ------------------------------------------------------------------
    // Charging engine
    // ------------------------------------------------------------------

    /**
     * Did this camera work at all on the billing day?
     *
     * Answered from camera_runtime_state.last_online_at, which is stamped only while the camera is
     * actually up. Deliberately NOT from `is_online`: the daily charge runs at one arbitrary
     * moment, so a snapshot would give a free day to a camera that was up for 23 hours and blinked
     * at the wrong second, and bill one that has been dead since morning but answered once just now.
     *
     * A camera with no record at all has never been seen online, and never delivered the service —
     * so it counts as not working, not as working-by-default.
     */
    _bekerjaHariIni(cameraId, today) {
        let row;
        try {
            row = queryOne(
                'SELECT last_online_at FROM camera_runtime_state WHERE camera_id = ?',
                [cameraId]
            );
        } catch {
            /*
             * No health table or column at all (a fresh DB, or migrations not yet run). Then
             * "did this camera work today" is not merely false, it is UNKNOWABLE — and answering
             * "it did not" would make every subscription free for as long as the schema stayed
             * behind, silently. Unknown therefore falls back to charging, which an operator
             * notices and can refund; the opposite failure hides itself.
             */
            return true;
        }
        if (!row?.last_online_at) return false;
        // Both sides are compared as local calendar days, the same unit last_charged_date uses.
        return localDateString(new Date(row.last_online_at)) === today;
    }

    /** Charge `subscription` for `today` if unbilled, then sync subscription + camera to the outcome. */
    _chargeAndSync(subscription, today) {
        const daily = dailyCostOf(subscription.monthly_price);

        if (subscription.last_charged_date === today && subscription.status === 'active') {
            return { status: 'active', charged: false };
        }

        // Trial gate: while the owner's trial is running, the day is free; once it
        // has expired the subscription suspends until the user picks a paid plan
        // (plan switch reprices and resumes through this same path).
        const trial = this._getOwnerTrialState(subscription.user_id);
        if (trial.onTrialPlan) {
            if (trial.active) {
                this._markActiveWithoutCharge(subscription, today);
                return { status: 'active', charged: false };
            }
            this._suspend(subscription);
            return { status: 'suspended', charged: false, reason: 'trial_expired' };
        }

        // Zero-priced paid subscriptions (admin freebies) stay active without wallet ops.
        if (daily <= 0) {
            this._markActiveWithoutCharge(subscription, today);
            return { status: 'active', charged: false };
        }

        /*
         * A camera that never came up today delivered nothing, so the day is not charged. The
         * subscription stays ACTIVE — the outage is usually the customer's internet, not a reason
         * to suspend them — it simply costs nothing.
         *
         * Switchable from the panel because it is a commercial choice, not a technical one: some
         * operators sell availability (you pay for the slot being reserved) rather than delivery.
         * The default is not to charge, because billing for a service that produced no video is
         * exactly what a customer would call being cheated.
         */
        if (settingsService.getBillingSkipOfflineDays() && !this._bekerjaHariIni(subscription.camera_id, today)) {
            this._markActiveWithoutCharge(subscription, today);
            return { status: 'active', charged: false, reason: 'kamera_offline_seharian' };
        }

        try {
            const result = walletService.chargeOnce({
                userId: subscription.user_id,
                amount: daily,
                reference: chargeReference(subscription.id, today),
                note: `Biaya harian kamera #${subscription.camera_id}`,
            });

            execute(
                `UPDATE camera_subscriptions
                 SET status = 'active', last_charged_date = ?, suspended_at = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [today, subscription.id]
            );
            execute(
                "UPDATE cameras SET billing_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [subscription.camera_id]
            );
            cameraService.invalidateCameraCache();
            return { status: 'active', charged: !result.alreadyCharged };
        } catch (error) {
            if (error.statusCode === 402) {
                this._suspend(subscription);
                return { status: 'suspended', charged: false };
            }
            throw error;
        }
    }

    _markActiveWithoutCharge(subscription, today) {
        execute(
            `UPDATE camera_subscriptions
             SET status = 'active', last_charged_date = ?, suspended_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [today, subscription.id]
        );
        execute(
            "UPDATE cameras SET billing_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [subscription.camera_id]
        );
        cameraService.invalidateCameraCache();
    }

    _suspend(subscription) {
        if (subscription.status !== 'suspended') {
            execute(
                `UPDATE camera_subscriptions
                 SET status = 'suspended', suspended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [subscription.id]
            );
        }
        execute(
            "UPDATE cameras SET billing_status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [subscription.camera_id]
        );
        cameraService.invalidateCameraCache();
    }

    /** Owner trial snapshot, read fresh per charge decision. Lookup failure (old DB) = not on trial. */
    _getOwnerTrialState(userId) {
        try {
            const row = queryOne(
                `SELECT u.trial_ends_at, COALESCE(bp.is_trial, 0) AS is_trial
                 FROM users u
                 LEFT JOIN billing_plans bp ON bp.id = u.plan_id
                 WHERE u.id = ?`,
                [userId]
            );
            if (!row || row.is_trial !== 1) {
                return { onTrialPlan: false, active: false };
            }
            const active = !!row.trial_ends_at && new Date(row.trial_ends_at).getTime() > Date.now();
            return { onTrialPlan: true, active };
        } catch {
            return { onTrialPlan: false, active: false };
        }
    }

    /** Hourly tick (idempotent per local day). Cheap when all charged: one SELECT, zero writes. */
    runDailyCharges(now = new Date()) {
        const today = localDateString(now);
        const due = query(
            `SELECT cs.* FROM camera_subscriptions cs
             WHERE cs.status IN ('active', 'suspended')
               AND (cs.last_charged_date IS NULL OR cs.last_charged_date < ?)`,
            [today]
        );

        const summary = { date: today, processed: 0, charged: 0, suspended: 0, errors: 0 };
        for (const subscription of due) {
            summary.processed += 1;
            try {
                const outcome = this._chargeAndSync(subscription, today);
                if (outcome.charged) summary.charged += 1;
                if (outcome.status === 'suspended') summary.suspended += 1;
            } catch (error) {
                summary.errors += 1;
                console.error(`[Billing] Charge failed for subscription ${subscription.id}:`, error.message);
            }
        }

        if (summary.processed > 0) {
            console.log(`[Billing] Daily charges ${today}: processed=${summary.processed} charged=${summary.charged} suspended=${summary.suspended} errors=${summary.errors}`);
        }
        return summary;
    }

    /** Called right after any wallet credit so a top-up resumes cameras before the next hourly tick. */
    tryResumeForUser(userId, now = new Date()) {
        const today = localDateString(now);
        const suspended = query(
            "SELECT * FROM camera_subscriptions WHERE user_id = ? AND status = 'suspended'",
            [userId]
        );
        const resumed = [];
        for (const subscription of suspended) {
            try {
                const outcome = this._chargeAndSync(subscription, today);
                if (outcome.status === 'active') {
                    resumed.push(subscription.camera_id);
                }
            } catch (error) {
                console.error(`[Billing] Resume failed for subscription ${subscription.id}:`, error.message);
            }
        }
        return { resumedCameraIds: resumed };
    }

    /**
     * Re-evaluate EVERY non-cancelled subscription of a user for `today` after a plan
     * change, forcing a fresh charge-or-suspend at the new price. Unlike tryResumeForUser
     * (which only touches suspended subs), this also re-bills currently-active subs — so
     * switching onto a paid plan cannot ride a trial/already-marked day for free: a
     * 0-balance account is suspended on the spot (stream → 402), not next tick.
     *
     * Idempotent per local day: chargeOnce keys on `charge:{subId}:{date}`, so a day
     * already genuinely paid is a no-op (the sub stays active, no double charge); only a
     * day that was free/unbilled (trial day) actually deducts on the switch to a paid plan.
     */
    applyPlanChangeForUser(userId, now = new Date()) {
        const today = localDateString(now);
        const subscriptions = query(
            "SELECT * FROM camera_subscriptions WHERE user_id = ? AND status != 'cancelled'",
            [userId]
        );
        const outcomes = [];
        for (const subscription of subscriptions) {
            try {
                // Null last_charged_date so _chargeAndSync re-evaluates today at the NEW
                // price instead of short-circuiting on the trial/already-marked day.
                const outcome = this._chargeAndSync({ ...subscription, last_charged_date: null }, today);
                outcomes.push({ cameraId: subscription.camera_id, status: outcome.status });
            } catch (error) {
                console.error(`[Billing] Plan-change recharge failed for subscription ${subscription.id}:`, error.message);
            }
        }
        return outcomes;
    }

    /**
     * A rental stuck at class 'community' is a live leak, because that branch of the public filter
     * ignores is_public entirely. Only rows that PROVE they are a rental are touched — a
     * non-cancelled subscription row, or an owner_user_id, neither of which a genuine community
     * camera ever carries (setCameraClass nulls the owner whenever it sets 'community').
     */
    healMisclassedSubscriberCameras() {
        const BUKTI = `camera_class = 'community' AND (owner_user_id IS NOT NULL
            OR id IN (SELECT camera_id FROM camera_subscriptions WHERE status != 'cancelled'))`;
        const cameraIds = query(`SELECT id FROM cameras WHERE ${BUKTI}`).map((c) => c.id);
        if (cameraIds.length === 0) return { healed: 0, cameraIds };
        execute(`UPDATE cameras SET camera_class = 'subscriber', is_public = 0,
                 owner_user_id = COALESCE(owner_user_id, (SELECT user_id FROM camera_subscriptions
                     WHERE camera_id = cameras.id AND status != 'cancelled' ORDER BY id DESC LIMIT 1)),
                 billing_status = COALESCE(billing_status, 'suspended'), updated_at = CURRENT_TIMESTAMP
                 WHERE ${BUKTI}`);
        cameraIds.forEach((id) => invalidateCameraAccessCache(id));
        cameraService.invalidateCameraCache();
        console.error(`[Billing][INTEGRITY] ${cameraIds.length} rental camera(s) were stuck as community → reclassed subscriber + unpublished: ${cameraIds.join(', ')}`);
        return { healed: cameraIds.length, cameraIds };
    }

    /**
     * Integrity self-heal: a subscriber camera whose owner_user_id no longer exists is an
     * ORPHAN (e.g. the customer row was removed out-of-band). Such a camera must never keep
     * streaming or showing publicly, so we unpublish + suspend it (non-destructive, reversible
     * if the owner is later restored) and log loudly for review. Runs on scheduler start and
     * is callable by an admin. Returns the cameras it healed — the misclass sweep first, so a
     * row that leaked AND lost its owner is caught by both in one pass.
     */
    healOrphanedSubscriberCameras() {
        const misclassed = this.healMisclassedSubscriberCameras();
        const orphans = query(`
            SELECT id, name, owner_user_id FROM cameras
            WHERE camera_class = 'subscriber'
              AND owner_user_id IS NOT NULL
              AND owner_user_id NOT IN (SELECT id FROM users)
        `);
        for (const cam of orphans) {
            execute(
                "UPDATE cameras SET is_public = 0, billing_status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [cam.id]
            );
            execute(
                "UPDATE camera_subscriptions SET status = 'suspended', suspended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE camera_id = ? AND status != 'cancelled'",
                [cam.id]
            );
            invalidateCameraAccessCache(cam.id);
            console.error(`[Billing][INTEGRITY] Orphaned subscriber camera ${cam.id} (${cam.name}) — owner ${cam.owner_user_id} missing → unpublished + suspended. RESTORE the owner or reassign the camera.`);
        }
        if (orphans.length > 0) {
            cameraService.invalidateCameraCache();
        }
        const cameraIds = [...new Set([...misclassed.cameraIds, ...orphans.map((c) => c.id)])];
        return { healed: cameraIds.length, cameraIds };
    }

    // ------------------------------------------------------------------
    // Read models
    // ------------------------------------------------------------------

    getSubscriptionById(id) {
        return queryOne(
            `SELECT cs.*, c.name AS camera_name, u.username AS customer_username
             FROM camera_subscriptions cs
             JOIN cameras c ON c.id = cs.camera_id
             JOIN users u ON u.id = cs.user_id
             WHERE cs.id = ?`,
            [id]
        );
    }

    listSubscriptions() {
        return query(
            `SELECT cs.*, c.name AS camera_name, c.billing_status AS camera_billing_status,
                    c.is_online AS camera_is_online, c.is_public AS camera_is_public, c.area_id,
                    a.name AS area_name,
                    u.username AS customer_username, w.balance AS wallet_balance
             FROM camera_subscriptions cs
             JOIN cameras c ON c.id = cs.camera_id
             LEFT JOIN areas a ON a.id = c.area_id
             JOIN users u ON u.id = cs.user_id
             LEFT JOIN wallets w ON w.user_id = cs.user_id
             ORDER BY a.name COLLATE NOCASE ASC, cs.id DESC`
        );
    }

    getCustomerBillingSummary(userId) {
        const wallet = walletService.getWallet(userId);
        const subscriptions = query(
            `SELECT cs.id, cs.camera_id, cs.monthly_price, cs.status, cs.last_charged_date,
                    c.name AS camera_name, c.billing_status
             FROM camera_subscriptions cs
             JOIN cameras c ON c.id = cs.camera_id
             WHERE cs.user_id = ? AND cs.status != 'cancelled'
             ORDER BY cs.id ASC`,
            [userId]
        );

        const dailyTotal = subscriptions
            .filter((s) => s.status !== 'cancelled')
            .reduce((sum, s) => sum + dailyCostOf(s.monthly_price), 0);
        const estimatedDaysLeft = dailyTotal > 0 ? Math.floor(wallet.balance / dailyTotal) : null;

        return {
            balance: wallet.balance,
            daily_cost: dailyTotal,
            estimated_days_left: estimatedDaysLeft,
            low_balance: estimatedDaysLeft !== null && estimatedDaysLeft < 3,
            subscriptions: subscriptions.map((s) => ({
                ...s,
                daily_cost: dailyCostOf(s.monthly_price),
            })),
        };
    }

    // ------------------------------------------------------------------
    // Scheduler
    // ------------------------------------------------------------------

    startBillingScheduler() {
        if (this._timer || this._initialTimer) {
            return;
        }
        // Integrity sweep on boot: orphaned subscriber cameras (owner removed) get
        // unpublished + suspended so a deleted customer's camera can never linger public.
        try {
            const healed = this.healOrphanedSubscriberCameras();
            if (healed.healed > 0) {
                console.warn(`[Billing] Startup integrity: healed ${healed.healed} orphaned subscriber camera(s): ${healed.cameraIds.join(', ')}`);
            }
        } catch (error) {
            console.error('[Billing] Startup orphan heal failed:', error.message);
        }
        this._initialTimer = setTimeout(() => {
            this._initialTimer = null;
            this._safeTick();
        }, INITIAL_TICK_DELAY_MS);
        this._timer = setInterval(() => this._safeTick(), HOURLY_TICK_MS);
        console.log('[Billing] Scheduler started (hourly tick, idempotent per local day)');
    }

    stopBillingScheduler() {
        if (this._initialTimer) {
            clearTimeout(this._initialTimer);
            this._initialTimer = null;
        }
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    _safeTick() {
        if (this._running) {
            return;
        }
        this._running = true;
        try {
            this.runDailyCharges();
        } catch (error) {
            console.error('[Billing] Scheduler tick failed:', error.message);
        } finally {
            this._running = false;
        }
    }
}

export default new BillingService();
