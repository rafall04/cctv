/**
 * Purpose: Verify billing plans — CRUD validation, per-account plan state, self-switch rules
 *          (camera-count fit, trial once per account, repricing), trial daily-charge behavior,
 *          and customer self-registration (validations, phone uniqueness, trial setup).
 * Caller: Backend focused test gate for billingPlanService + billingService trial path.
 * Deps: vitest, better-sqlite3 (in-memory), mocked cameraService/timezone/audit.
 * MainFuncs: plan lifecycle and registration tests.
 * SideEffects: In-memory database only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (callback) => db.transaction(callback),
}));

vi.mock('../services/cameraService.js', () => ({
    default: { invalidateCameraCache: vi.fn() },
}));

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(),
    logSecurityEvent: vi.fn(),
    SECURITY_EVENTS: { ADMIN_ACTION: 'ADMIN_ACTION' },
}));

import billingPlanService from '../services/billingPlanService.js';
import billingService, { localDateString } from '../services/billingService.js';
import walletService from '../services/walletService.js';

const STRONG_PASSWORD = 'Kamera!Aman2026#Sekali';

function seedSchema() {
    db.exec(`
        DROP TABLE IF EXISTS settings;
        DROP TABLE IF EXISTS billing_plans;
        DROP TABLE IF EXISTS wallets;
        DROP TABLE IF EXISTS wallet_transactions;
        DROP TABLE IF EXISTS camera_subscriptions;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS users;
        DROP TABLE IF EXISTS audit_logs;
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'customer',
            phone TEXT,
            email TEXT,
            plan_id INTEGER,
            plan_started_at TEXT,
            trial_ends_at TEXT,
            trial_used INTEGER NOT NULL DEFAULT 0,
            account_status TEXT NOT NULL DEFAULT 'approved',
            password_changed_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE billing_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            price_per_camera INTEGER NOT NULL DEFAULT 0,
            max_cameras INTEGER NOT NULL DEFAULT 1,
            is_trial INTEGER NOT NULL DEFAULT 0,
            trial_days INTEGER,
            active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 100,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_user_id INTEGER,
            camera_class TEXT NOT NULL DEFAULT 'community',
            billing_status TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            balance INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            reference TEXT,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX idx_wallet_transactions_charge_ref
        ON wallet_transactions(reference)
        WHERE type = 'charge' AND reference IS NOT NULL;
        CREATE TABLE camera_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            monthly_price INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            activated_at TEXT,
            suspended_at TEXT,
            last_charged_date TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT,
            details TEXT,
            ip_address TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, username, role) VALUES (42, 'budi', 'customer');
        INSERT INTO billing_plans (id, key, name, price_per_camera, max_cameras, is_trial, trial_days, active, sort_order)
        VALUES (1, 'trial', 'Trial Gratis', 0, 1, 1, 3, 1, 1),
               (2, 'basic', 'Basic', 25000, 1, 0, NULL, 1, 2),
               (3, 'hemat', 'Hemat', 20000, 3, 0, NULL, 1, 3);
        INSERT INTO cameras (id, name) VALUES (7, 'Kamera A'), (8, 'Kamera B');
    `);
}

function user(id = 42) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

describe('billingPlanService', () => {
    beforeEach(() => {
        seedSchema();
    });

    describe('plan catalog', () => {
        it('creates a plan with validation and unique key', () => {
            const plan = billingPlanService.createPlan({
                key: 'PRO',
                name: 'Pro',
                price_per_camera: 18000,
                max_cameras: 5,
            });
            expect(plan.key).toBe('pro');
            expect(() => billingPlanService.createPlan({
                key: 'pro', name: 'Dup', price_per_camera: 1, max_cameras: 1,
            })).toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('refuses trial plans without a duration', () => {
            expect(() => billingPlanService.createPlan({
                key: 'freebie', name: 'Freebie', price_per_camera: 0, max_cameras: 1, is_trial: true,
            })).toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('updatePlan reprices live subscriptions of users on that plan', () => {
            db.prepare("UPDATE users SET plan_id = 3 WHERE id = 42").run();
            db.prepare(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status)
                        VALUES (7, 42, 20000, 'active')`).run();

            billingPlanService.updatePlan(3, { price_per_camera: 17000 });

            const sub = db.prepare('SELECT monthly_price FROM camera_subscriptions WHERE camera_id = 7').get();
            expect(sub.monthly_price).toBe(17000);
        });
    });

    describe('changeUserPlan', () => {
        it('blocks plans smaller than the current camera count', () => {
            db.prepare("UPDATE cameras SET owner_user_id = 42 WHERE id IN (7, 8)").run();
            expect(() => billingPlanService.changeUserPlan(42, 'basic'))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('allows the trial only once for self-service switches', () => {
            const first = billingPlanService.changeUserPlan(42, 'trial');
            expect(first.trial_active).toBe(true);
            expect(user().trial_used).toBe(1);

            billingPlanService.changeUserPlan(42, 'basic');
            expect(() => billingPlanService.changeUserPlan(42, 'trial'))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));

            // Admin override may re-grant it.
            const adminGrant = billingPlanService.changeUserPlan(42, 'trial', { byAdmin: true });
            expect(adminGrant.trial_active).toBe(true);
        });

        it('reprices subscriptions and resumes through the charge path on upgrade', () => {
            db.prepare("UPDATE cameras SET owner_user_id = 42, camera_class = 'subscriber', billing_status = 'suspended' WHERE id = 7").run();
            db.prepare(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status)
                        VALUES (7, 42, 0, 'suspended')`).run();
            walletService.credit({ userId: 42, amount: 10000 });

            const state = billingPlanService.changeUserPlan(42, 'hemat');

            expect(state.plan.key).toBe('hemat');
            const sub = db.prepare('SELECT * FROM camera_subscriptions WHERE camera_id = 7').get();
            expect(sub.monthly_price).toBe(20000);
            expect(sub.status).toBe('active');
            // Day charged at the NEW price (20000/30 ≈ 667).
            expect(walletService.getBalance(42)).toBe(10000 - 667);
        });

        // --- Regression: charge-on-switch closes the "0 balance still streams" leak ---
        // Before the fix, switching from a trial-marked (free) day to a paid plan left the
        // camera active until the NEXT daily tick, so a 0-balance account streamed free for
        // up to ~24h. changeUserPlan now re-bills today at the new price on the spot.

        it('suspends immediately when switching from an active trial day to a paid plan with zero balance', () => {
            const today = localDateString();
            const endsAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            db.prepare("UPDATE users SET plan_id = 1, trial_ends_at = ?, trial_used = 1 WHERE id = 42").run(endsAt);
            db.prepare("UPDATE cameras SET owner_user_id = 42, camera_class = 'subscriber', billing_status = 'active' WHERE id = 7").run();
            // Trial-free day: marked active for TODAY with no charge row, monthly_price 0.
            db.prepare(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status, last_charged_date)
                        VALUES (7, 42, 0, 'active', ?)`).run(today);
            expect(walletService.getBalance(42)).toBe(0);

            const state = billingPlanService.changeUserPlan(42, 'hemat');

            expect(state.plan.key).toBe('hemat');
            const sub = db.prepare('SELECT * FROM camera_subscriptions WHERE camera_id = 7').get();
            expect(sub.monthly_price).toBe(20000);
            expect(sub.status).toBe('suspended');                 // no free window
            expect(db.prepare('SELECT billing_status FROM cameras WHERE id = 7').get().billing_status).toBe('suspended');
            expect(walletService.getBalance(42)).toBe(0);         // suspended, never goes negative
        });

        it('charges today at the new price (stays active) when the wallet can cover the switch', () => {
            const today = localDateString();
            const endsAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            db.prepare("UPDATE users SET plan_id = 1, trial_ends_at = ?, trial_used = 1 WHERE id = 42").run(endsAt);
            db.prepare("UPDATE cameras SET owner_user_id = 42, camera_class = 'subscriber', billing_status = 'active' WHERE id = 7").run();
            db.prepare(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status, last_charged_date)
                        VALUES (7, 42, 0, 'active', ?)`).run(today);
            walletService.credit({ userId: 42, amount: 5000 });

            billingPlanService.changeUserPlan(42, 'hemat');

            const sub = db.prepare('SELECT * FROM camera_subscriptions WHERE camera_id = 7').get();
            expect(sub.status).toBe('active');
            expect(sub.last_charged_date).toBe(today);
            expect(walletService.getBalance(42)).toBe(5000 - 667); // 20000/30 ≈ 667
        });

        it('does not double-charge a day already genuinely paid when switching between paid plans', () => {
            const today = localDateString();
            db.prepare("UPDATE users SET plan_id = 2 WHERE id = 42").run(); // basic 25000
            db.prepare("UPDATE cameras SET owner_user_id = 42, camera_class = 'subscriber', billing_status = 'active' WHERE id = 7").run();
            db.prepare(`INSERT INTO camera_subscriptions (id, camera_id, user_id, monthly_price, status, last_charged_date)
                        VALUES (55, 7, 42, 25000, 'active', ?)`).run(today);
            walletService.credit({ userId: 42, amount: 10000 });
            // Today's real charge already taken at the old price (reference = charge:{subId}:{date}).
            walletService.chargeOnce({ userId: 42, amount: 833, reference: `charge:55:${today}`, note: 'old price' });
            expect(walletService.getBalance(42)).toBe(10000 - 833);

            billingPlanService.changeUserPlan(42, 'hemat'); // 20000

            const sub = db.prepare('SELECT * FROM camera_subscriptions WHERE camera_id = 7').get();
            expect(sub.status).toBe('active');
            expect(walletService.getBalance(42)).toBe(10000 - 833); // idempotent: no second deduction
        });
    });

    describe('trial behavior in daily charges', () => {
        function setupTrialUserWithCamera({ expired }) {
            const endsAt = new Date(Date.now() + (expired ? -1 : 1) * 24 * 3600 * 1000).toISOString();
            db.prepare("UPDATE users SET plan_id = 1, trial_ends_at = ?, trial_used = 1 WHERE id = 42").run(endsAt);
            db.prepare("UPDATE cameras SET owner_user_id = 42, camera_class = 'subscriber', billing_status = 'active' WHERE id = 7").run();
            db.prepare(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status, last_charged_date)
                        VALUES (7, 42, 0, 'active', '2000-01-01')`).run();
        }

        it('keeps active-trial cameras alive without touching the wallet', () => {
            setupTrialUserWithCamera({ expired: false });
            const summary = billingService.runDailyCharges();

            expect(summary.suspended).toBe(0);
            const sub = db.prepare('SELECT * FROM camera_subscriptions WHERE camera_id = 7').get();
            expect(sub.status).toBe('active');
            expect(db.prepare('SELECT COUNT(*) AS n FROM wallet_transactions').get().n).toBe(0);
        });

        it('suspends cameras when the trial has expired, even with wallet balance', () => {
            setupTrialUserWithCamera({ expired: true });
            walletService.credit({ userId: 42, amount: 50000 });

            const summary = billingService.runDailyCharges();

            expect(summary.suspended).toBe(1);
            const camera = db.prepare('SELECT billing_status FROM cameras WHERE id = 7').get();
            expect(camera.billing_status).toBe('suspended');
            // Balance untouched — expired trial requires a plan upgrade, not money.
            expect(walletService.getBalance(42)).toBe(50000);
        });
    });

    describe('registerCustomer', () => {
        it('registers with the default trial plan, wallet, and trial bookkeeping', async () => {
            const result = await billingPlanService.registerCustomer({
                username: 'warung_bu_sri',
                password: STRONG_PASSWORD,
                phone: '0812-3456-7890',
            });

            expect(result.role).toBe('customer');
            expect(result.status).toBe('pending');
            expect(result.plan.key).toBe('trial');
            const row = db.prepare('SELECT * FROM users WHERE username = ?').get('warung_bu_sri');
            expect(row.phone).toBe('081234567890');
            expect(row.account_status).toBe('pending');
            // Trial clock is NOT started at registration — it begins on admin approval.
            expect(row.trial_used).toBe(0);
            expect(row.trial_ends_at).toBe(null);
            expect(db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(row.id)).toBeTruthy();
        });

        it('rejects duplicate phone numbers (anti trial-farming)', async () => {
            await billingPlanService.registerCustomer({
                username: 'akun_satu', password: STRONG_PASSWORD, phone: '081234567890',
            });
            await expect(billingPlanService.registerCustomer({
                username: 'akun_dua', password: STRONG_PASSWORD, phone: '0812 3456 7890',
            })).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects invalid phone formats and duplicate usernames', async () => {
            await expect(billingPlanService.registerCustomer({
                username: 'tokoroti', password: STRONG_PASSWORD, phone: '12345',
            })).rejects.toMatchObject({ statusCode: 400 });
            await expect(billingPlanService.registerCustomer({
                username: 'budi', password: STRONG_PASSWORD, phone: '081234567891',
            })).rejects.toMatchObject({ statusCode: 400 });
        });

        it('honors the registration toggle', async () => {
            billingPlanService.updateRegistrationSettings({ enabled: false });
            await expect(billingPlanService.registerCustomer({
                username: 'telat_daftar', password: STRONG_PASSWORD, phone: '081234567892',
            })).rejects.toMatchObject({ statusCode: 403 });
        });

        it('uses the admin-configured default plan', async () => {
            billingPlanService.updateRegistrationSettings({ default_plan_key: 'basic' });
            const result = await billingPlanService.registerCustomer({
                username: 'langsung_bayar', password: STRONG_PASSWORD, phone: '081234567893',
            });
            expect(result.plan.key).toBe('basic');
            expect(result.plan.is_trial).toBe(false);
            const row = db.prepare('SELECT trial_ends_at, trial_used, account_status FROM users WHERE username = ?').get('langsung_bayar');
            expect(row.trial_ends_at).toBe(null);
            expect(row.trial_used).toBe(0);
            expect(row.account_status).toBe('pending');
        });
    });

    describe('registration approval', () => {
        async function registerPending(username = 'calon_pelanggan', phone = '081299990001') {
            const res = await billingPlanService.registerCustomer({ username, password: STRONG_PASSWORD, phone });
            return res.id;
        }

        it('lists only pending customer registrations', async () => {
            await registerPending('calon_a', '081299990001');
            await registerPending('calon_b', '081299990002');

            const pending = billingPlanService.listPendingRegistrations();
            expect(pending.map((p) => p.username).sort()).toEqual(['calon_a', 'calon_b']);
            expect(pending[0].plan_key).toBe('trial');
            expect(billingPlanService.countPendingRegistrations()).toBe(2);
        });

        it('approve starts the trial clock and flips status to approved', async () => {
            const id = await registerPending();
            const result = billingPlanService.approveCustomer(id);

            expect(result.account_status).toBe('approved');
            const row = db.prepare('SELECT account_status, trial_ends_at, trial_used, plan_started_at FROM users WHERE id = ?').get(id);
            expect(row.account_status).toBe('approved');
            expect(row.trial_used).toBe(1);
            expect(row.trial_ends_at).toBeTruthy();
            expect(row.plan_started_at).toBeTruthy();
            expect(billingPlanService.countPendingRegistrations()).toBe(0);
        });

        it('approve on a non-trial default plan does not set a trial window', async () => {
            billingPlanService.updateRegistrationSettings({ default_plan_key: 'basic' });
            const id = await registerPending('bayar_dulu', '081299990009');
            billingPlanService.approveCustomer(id);

            const row = db.prepare('SELECT account_status, trial_ends_at, trial_used FROM users WHERE id = ?').get(id);
            expect(row.account_status).toBe('approved');
            expect(row.trial_ends_at).toBe(null);
            expect(row.trial_used).toBe(0);
        });

        it('reject flips status to rejected and removes it from the pending list', async () => {
            const id = await registerPending();
            const result = billingPlanService.rejectCustomer(id);

            expect(result.account_status).toBe('rejected');
            expect(db.prepare('SELECT account_status FROM users WHERE id = ?').get(id).account_status).toBe('rejected');
            expect(billingPlanService.countPendingRegistrations()).toBe(0);
        });

        it('refuses to approve/reject an already-approved account', async () => {
            const id = await registerPending();
            billingPlanService.approveCustomer(id);
            expect(() => billingPlanService.approveCustomer(id)).toThrowError(expect.objectContaining({ statusCode: 400 }));
            expect(() => billingPlanService.rejectCustomer(id)).toThrowError(expect.objectContaining({ statusCode: 400 }));
        });

        it('refuses to approve a non-customer user', async () => {
            db.prepare("INSERT INTO users (id, username, role, account_status) VALUES (500, 'staff', 'admin', 'approved')").run();
            expect(() => billingPlanService.approveCustomer(500)).toThrowError(expect.objectContaining({ statusCode: 400 }));
        });
    });
});
