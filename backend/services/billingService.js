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
import { getTimezone } from './timezoneService.js';
import { logAdminAction } from './securityAuditLogger.js';

const HOURLY_TICK_MS = 60 * 60 * 1000;
const INITIAL_TICK_DELAY_MS = 20 * 1000;

export function dailyCostOf(monthlyPrice) {
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
    // Admin: assignment & lifecycle
    // ------------------------------------------------------------------

    assignSubscription({ camera_id, user_id, monthly_price }, request = null) {
        const cameraId = Number(camera_id);
        const userId = Number(user_id);
        const price = Number(monthly_price);

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
        if (!Number.isInteger(price) || price <= 0) {
            const err = new Error('monthly_price must be a positive integer (rupiah)');
            err.statusCode = 400;
            throw err;
        }

        const camera = queryOne('SELECT id, name FROM cameras WHERE id = ?', [cameraId]);
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

        execute(
            `UPDATE cameras
             SET owner_user_id = ?, camera_class = 'subscriber', billing_status = 'active',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [userId, cameraId]
        );
        walletService.ensureWallet(userId);
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
     * Charge `subscription` for `today` if not yet charged, then sync the
     * subscription + camera state to the outcome. Shared by the hourly tick,
     * assignment day-one billing, manual reactivation, and topup resume.
     */
    _chargeAndSync(subscription, today) {
        const daily = dailyCostOf(subscription.monthly_price);

        if (subscription.last_charged_date === today && subscription.status === 'active') {
            return { status: 'active', charged: false };
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
                return { status: 'suspended', charged: false };
            }
            throw error;
        }
    }

    /**
     * Hourly tick (idempotent per local day). Cheap when everything is already
     * charged: one SELECT, zero writes.
     */
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

    /**
     * Called right after any wallet credit so a top-up reactivates the
     * customer's cameras without waiting for the next hourly tick.
     */
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
                    u.username AS customer_username, w.balance AS wallet_balance
             FROM camera_subscriptions cs
             JOIN cameras c ON c.id = cs.camera_id
             JOIN users u ON u.id = cs.user_id
             LEFT JOIN wallets w ON w.user_id = cs.user_id
             ORDER BY cs.id DESC`
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
