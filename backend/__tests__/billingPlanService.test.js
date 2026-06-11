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
import billingService from '../services/billingService.js';
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
            password_changed_at TEXT
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
            expect(result.plan.key).toBe('trial');
            const row = db.prepare('SELECT * FROM users WHERE username = ?').get('warung_bu_sri');
            expect(row.phone).toBe('081234567890');
            expect(row.trial_used).toBe(1);
            expect(row.trial_ends_at).toBeTruthy();
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
            const row = db.prepare('SELECT trial_ends_at, trial_used FROM users WHERE username = ?').get('langsung_bayar');
            expect(row.trial_ends_at).toBe(null);
            expect(row.trial_used).toBe(0);
        });
    });
});
