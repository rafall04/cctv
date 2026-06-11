/**
 * Purpose: Billing plans (paket pelanggan) — admin CRUD, per-account plan state (max cameras,
 *          trial window), self-service plan switching with repricing, and customer
 *          self-registration with the admin-configured default/trial plan.
 * Caller: billingAdminRoutes (plan CRUD/settings), customerRoutes (plan state/switch),
 *         authController.register, customerCameraService (limit checks).
 * Deps: connectionPool, walletService, billingService (resume after upgrade), passwordValidator,
 *       bcrypt, settings table (registration keys).
 * MainFuncs: listPlans, createPlan, updatePlan, getUserPlanState, changeUserPlan,
 *            getRegistrationSettings, updateRegistrationSettings, registerCustomer.
 * SideEffects: Writes billing_plans/users/camera_subscriptions/settings rows.
 *
 * Plan model: a plan sets price_per_camera (INTEGER rupiah/month) and max_cameras (cap for
 * SELF-service adds; admin assignment is never capped). Trial plans (is_trial=1) run for
 * trial_days from plan_started_at: daily charges are skipped while active and every
 * subscription suspends when the trial expires. trial_used blocks re-running a trial on the
 * same account; self-registration additionally requires a unique phone number to raise the
 * cost of trial farming.
 */

import bcrypt from 'bcrypt';
import { query, queryOne, execute } from '../database/connectionPool.js';
import walletService from './walletService.js';
import billingService from './billingService.js';
import { validatePassword, getPasswordRequirements } from './passwordValidator.js';
import { logAdminAction, logSecurityEvent, SECURITY_EVENTS } from './securityAuditLogger.js';

export const REGISTRATION_ENABLED_KEY = 'billing_registration_enabled';
export const DEFAULT_PLAN_KEY_SETTING = 'billing_default_plan_key';

function readSetting(key, fallback) {
    try {
        const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
        if (!row || row.value === null || row.value === undefined) {
            return fallback;
        }
        try {
            return JSON.parse(row.value);
        } catch {
            return row.value;
        }
    } catch {
        return fallback;
    }
}

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function notFound(message) {
    const err = new Error(message);
    err.statusCode = 404;
    return err;
}

function normalizePlanPayload(data, { partial = false } = {}) {
    const out = {};
    const has = (k) => data[k] !== undefined;

    if (has('name') || !partial) {
        if (!data.name || String(data.name).trim().length < 2) {
            throw badRequest('Nama paket minimal 2 karakter');
        }
        out.name = String(data.name).trim();
    }
    if (has('description')) {
        out.description = data.description ? String(data.description).trim() : null;
    }
    if (has('price_per_camera') || !partial) {
        const price = Number(data.price_per_camera);
        if (!Number.isInteger(price) || price < 0) {
            throw badRequest('Harga per kamera harus bilangan bulat >= 0 (rupiah)');
        }
        out.price_per_camera = price;
    }
    if (has('max_cameras') || !partial) {
        const max = Number(data.max_cameras);
        if (!Number.isInteger(max) || max < 1 || max > 100) {
            throw badRequest('Maksimal kamera harus 1-100');
        }
        out.max_cameras = max;
    }
    if (has('is_trial') || !partial) {
        out.is_trial = data.is_trial === true || data.is_trial === 1 ? 1 : 0;
    }
    if (has('trial_days')) {
        if (data.trial_days === null || data.trial_days === '') {
            out.trial_days = null;
        } else {
            const days = Number(data.trial_days);
            if (!Number.isInteger(days) || days < 1 || days > 90) {
                throw badRequest('Durasi trial harus 1-90 hari');
            }
            out.trial_days = days;
        }
    }
    if (has('active')) {
        out.active = data.active === false || data.active === 0 ? 0 : 1;
    }
    if (has('sort_order')) {
        const sort = Number(data.sort_order);
        out.sort_order = Number.isInteger(sort) ? sort : 100;
    }
    if ((out.is_trial === 1 || (partial && out.is_trial === undefined && data.is_trial === undefined)) && out.trial_days === undefined) {
        // trial_days stays as-is when not provided; creation of a trial plan without days is invalid.
        if (!partial && out.is_trial === 1) {
            throw badRequest('Paket trial wajib punya durasi (trial_days)');
        }
    }
    return out;
}

class BillingPlanService {
    // ------------------------------------------------------------------
    // Plan catalog (admin)
    // ------------------------------------------------------------------

    listPlans({ activeOnly = false } = {}) {
        return query(
            `SELECT * FROM billing_plans ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order ASC, id ASC`
        );
    }

    getPlanById(id) {
        return queryOne('SELECT * FROM billing_plans WHERE id = ?', [id]);
    }

    getPlanByKey(key) {
        return queryOne('SELECT * FROM billing_plans WHERE key = ?', [key]);
    }

    createPlan(data, request = null) {
        const payload = normalizePlanPayload(data);
        const key = String(data.key || '').trim().toLowerCase();
        if (!/^[a-z0-9_-]{2,40}$/.test(key)) {
            throw badRequest('Key paket harus 2-40 karakter huruf kecil/angka/-/_');
        }
        if (this.getPlanByKey(key)) {
            throw badRequest('Key paket sudah dipakai');
        }
        if (payload.is_trial === 1 && !payload.trial_days) {
            throw badRequest('Paket trial wajib punya durasi (trial_days)');
        }

        const result = execute(
            `INSERT INTO billing_plans (key, name, description, price_per_camera, max_cameras, is_trial, trial_days, active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                key,
                payload.name,
                payload.description ?? null,
                payload.price_per_camera,
                payload.max_cameras,
                payload.is_trial,
                payload.trial_days ?? null,
                payload.active ?? 1,
                payload.sort_order ?? 100,
            ]
        );

        if (request) {
            logAdminAction({ action: 'billing_plan_created', planKey: key, ...payload }, request);
        }
        return this.getPlanById(result.lastInsertRowid);
    }

    updatePlan(id, data, request = null) {
        const plan = this.getPlanById(id);
        if (!plan) {
            throw notFound('Paket tidak ditemukan');
        }
        const payload = normalizePlanPayload(data, { partial: true });
        const willBeTrial = payload.is_trial !== undefined ? payload.is_trial === 1 : plan.is_trial === 1;
        const willHaveDays = payload.trial_days !== undefined ? payload.trial_days : plan.trial_days;
        if (willBeTrial && !willHaveDays) {
            throw badRequest('Paket trial wajib punya durasi (trial_days)');
        }

        const updates = [];
        const values = [];
        for (const [column, value] of Object.entries(payload)) {
            updates.push(`${column} = ?`);
            values.push(value);
        }
        if (updates.length === 0) {
            throw badRequest('Tidak ada field yang diubah');
        }
        values.push(id);
        execute(`UPDATE billing_plans SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);

        // Repricing existing subscriptions on price change keeps "paket = harga"
        // truthful for every customer already on this plan.
        if (payload.price_per_camera !== undefined && payload.price_per_camera !== plan.price_per_camera) {
            execute(
                `UPDATE camera_subscriptions
                 SET monthly_price = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE status != 'cancelled'
                   AND user_id IN (SELECT id FROM users WHERE plan_id = ?)`,
                [payload.price_per_camera, id]
            );
        }

        if (request) {
            logAdminAction({ action: 'billing_plan_updated', planId: Number(id), changes: payload }, request);
        }
        return this.getPlanById(id);
    }

    // ------------------------------------------------------------------
    // Per-account plan state
    // ------------------------------------------------------------------

    getUserPlanState(userId) {
        const user = queryOne(
            'SELECT id, username, role, plan_id, plan_started_at, trial_ends_at, trial_used FROM users WHERE id = ?',
            [userId]
        );
        if (!user) {
            throw notFound('User tidak ditemukan');
        }
        const plan = user.plan_id ? this.getPlanById(user.plan_id) : null;
        const ownedCameras = queryOne(
            'SELECT COUNT(*) AS n FROM cameras WHERE owner_user_id = ?',
            [userId]
        ).n;

        const trialActive = !!(plan?.is_trial && user.trial_ends_at
            && new Date(user.trial_ends_at).getTime() > Date.now());
        const trialExpired = !!(plan?.is_trial && user.trial_ends_at
            && new Date(user.trial_ends_at).getTime() <= Date.now());

        return {
            plan,
            plan_started_at: user.plan_started_at,
            trial_ends_at: user.trial_ends_at,
            trial_active: trialActive,
            trial_expired: trialExpired,
            trial_used: user.trial_used === 1,
            used_cameras: ownedCameras,
            max_cameras: plan ? plan.max_cameras : 0,
            can_add_camera: !!plan && !trialExpired && ownedCameras < plan.max_cameras,
        };
    }

    /**
     * Switch a user's plan. Self-service rules: target must be active, must fit the
     * current camera count, and trial plans can only be (re)entered by an admin or a
     * user who never consumed a trial. Repricing applies to all non-cancelled
     * subscriptions; upgrades from an expired trial resume via the normal charge path.
     */
    changeUserPlan(userId, planKeyOrId, { byAdmin = false, request = null } = {}) {
        const user = queryOne(
            'SELECT id, role, plan_id, trial_used FROM users WHERE id = ?',
            [userId]
        );
        if (!user) {
            throw notFound('User tidak ditemukan');
        }
        if (user.role !== 'customer') {
            throw badRequest('Hanya akun pelanggan yang punya paket');
        }

        const plan = typeof planKeyOrId === 'number' || /^\d+$/.test(String(planKeyOrId))
            ? this.getPlanById(Number(planKeyOrId))
            : this.getPlanByKey(String(planKeyOrId));
        if (!plan) {
            throw notFound('Paket tidak ditemukan');
        }
        if (!plan.active && !byAdmin) {
            throw badRequest('Paket tidak tersedia');
        }
        if (plan.id === user.plan_id && !plan.is_trial) {
            throw badRequest('Sudah berada di paket ini');
        }

        const ownedCameras = queryOne('SELECT COUNT(*) AS n FROM cameras WHERE owner_user_id = ?', [userId]).n;
        if (ownedCameras > plan.max_cameras) {
            throw badRequest(`Paket ini maksimal ${plan.max_cameras} kamera — hapus ${ownedCameras - plan.max_cameras} kamera dulu atau pilih paket lebih besar`);
        }

        let trialEndsAt = null;
        if (plan.is_trial) {
            if (!byAdmin && user.trial_used === 1) {
                throw badRequest('Trial hanya bisa dipakai satu kali per akun');
            }
            trialEndsAt = new Date(Date.now() + plan.trial_days * 24 * 3600 * 1000).toISOString();
        }

        execute(
            `UPDATE users
             SET plan_id = ?, plan_started_at = CURRENT_TIMESTAMP, trial_ends_at = ?,
                 trial_used = CASE WHEN ? = 1 THEN 1 ELSE trial_used END
             WHERE id = ?`,
            [plan.id, trialEndsAt, plan.is_trial ? 1 : 0, userId]
        );

        // Reprice every live subscription to the new plan's per-camera price.
        execute(
            `UPDATE camera_subscriptions
             SET monthly_price = ?, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND status != 'cancelled'`,
            [plan.price_per_camera, userId]
        );

        // Run the resume/charge path so "active" still means "paid for today":
        // paid switches charge at the new price, trial switches resume charge-free.
        billingService.tryResumeForUser(userId);

        if (request) {
            logAdminAction({
                action: byAdmin ? 'billing_plan_assigned_by_admin' : 'billing_plan_self_switched',
                customerId: Number(userId),
                planKey: plan.key,
            }, request);
        }
        return this.getUserPlanState(userId);
    }

    // ------------------------------------------------------------------
    // Self-registration
    // ------------------------------------------------------------------

    getRegistrationSettings() {
        const enabledRaw = readSetting(REGISTRATION_ENABLED_KEY, 'true');
        const enabled = enabledRaw === true || enabledRaw === 'true' || enabledRaw === 1 || enabledRaw === '1';
        const defaultPlanKey = String(readSetting(DEFAULT_PLAN_KEY_SETTING, 'trial'));
        const defaultPlan = this.getPlanByKey(defaultPlanKey);
        return { enabled, default_plan_key: defaultPlanKey, default_plan: defaultPlan || null };
    }

    updateRegistrationSettings({ enabled, default_plan_key }, request = null) {
        if (enabled !== undefined) {
            const value = enabled === true || enabled === 'true' || enabled === 1 ? 'true' : 'false';
            execute(
                `INSERT INTO settings (key, value, description) VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
                [REGISTRATION_ENABLED_KEY, value, 'Izinkan pendaftaran pelanggan mandiri']
            );
        }
        if (default_plan_key !== undefined) {
            const plan = this.getPlanByKey(String(default_plan_key));
            if (!plan) {
                throw badRequest('Paket default tidak ditemukan');
            }
            execute(
                `INSERT INTO settings (key, value, description) VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
                [DEFAULT_PLAN_KEY_SETTING, plan.key, 'Paket default untuk pendaftar baru']
            );
        }
        if (request) {
            logAdminAction({
                action: 'billing_registration_settings_updated',
                enabled,
                defaultPlanKey: default_plan_key,
            }, request);
        }
        return this.getRegistrationSettings();
    }

    async registerCustomer({ username, password, phone, email }, request = null) {
        const settings = this.getRegistrationSettings();
        if (!settings.enabled) {
            const err = new Error('Pendaftaran mandiri sedang ditutup');
            err.statusCode = 403;
            throw err;
        }

        const cleanUsername = String(username || '').trim();
        if (!/^[a-zA-Z0-9_-]{3,50}$/.test(cleanUsername)) {
            throw badRequest('Username 3-50 karakter, hanya huruf/angka/-/_');
        }
        if (queryOne('SELECT id FROM users WHERE username = ?', [cleanUsername])) {
            throw badRequest('Username sudah dipakai');
        }

        const cleanPhone = String(phone || '').replace(/[\s-]/g, '');
        if (!/^(\+62|62|0)8\d{7,12}$/.test(cleanPhone)) {
            throw badRequest('Nomor HP tidak valid (contoh: 081234567890)');
        }
        // One phone = one account: the cheap anti-abuse lever for free trials.
        if (queryOne('SELECT id FROM users WHERE phone = ?', [cleanPhone])) {
            throw badRequest('Nomor HP sudah terdaftar — silakan login');
        }

        const passwordValidation = validatePassword(password, cleanUsername);
        if (!passwordValidation.valid) {
            const err = badRequest('Password belum memenuhi syarat keamanan');
            err.errors = passwordValidation.errors;
            err.requirements = getPasswordRequirements();
            throw err;
        }

        const plan = settings.default_plan;
        const passwordHash = await bcrypt.hash(password, 10);
        const trialEndsAt = plan?.is_trial
            ? new Date(Date.now() + plan.trial_days * 24 * 3600 * 1000).toISOString()
            : null;

        const result = execute(
            `INSERT INTO users (username, password_hash, role, phone, email, plan_id, plan_started_at, trial_ends_at, trial_used, password_changed_at)
             VALUES (?, ?, 'customer', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
            [
                cleanUsername,
                passwordHash,
                cleanPhone,
                email ? String(email).trim() : null,
                plan?.id ?? null,
                trialEndsAt,
                plan?.is_trial ? 1 : 0,
                new Date().toISOString(),
            ]
        );
        const userId = result.lastInsertRowid;
        walletService.ensureWallet(userId);

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'CUSTOMER_REGISTERED', `Self-registration: ${cleanUsername} (plan: ${plan?.key || 'none'})`, request?.ip || null]
        );
        logSecurityEvent(SECURITY_EVENTS.ADMIN_ACTION, {
            action: 'customer_self_registered',
            username: cleanUsername,
            planKey: plan?.key || null,
        }, request);

        return {
            id: userId,
            username: cleanUsername,
            role: 'customer',
            plan: plan ? { key: plan.key, name: plan.name, is_trial: plan.is_trial === 1, trial_ends_at: trialEndsAt } : null,
        };
    }
}

export default new BillingPlanService();
