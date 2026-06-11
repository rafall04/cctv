/**
 * Purpose: Verify the billing engine against real SQLite — assignment, day-one charge,
 *          daily idempotency, suspend on empty wallet, auto-resume on top-up, cancel rules.
 * Caller: Backend focused test gate for billingService.
 * Deps: vitest, better-sqlite3 (in-memory), mocked connectionPool/cameraService/timezone/audit.
 * MainFuncs: billing lifecycle tests.
 * SideEffects: In-memory database only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, invalidateMock } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:'), invalidateMock: { fn: null } };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (callback) => db.transaction(callback),
}));

vi.mock('../services/cameraService.js', () => ({
    default: { invalidateCameraCache: vi.fn(() => invalidateMock.fn?.()) },
}));

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(),
}));

import billingService, { dailyCostOf, localDateString } from '../services/billingService.js';
import walletService from '../services/walletService.js';

const TODAY = localDateString();

function seedSchema() {
    db.exec(`
        DROP TABLE IF EXISTS wallets;
        DROP TABLE IF EXISTS wallet_transactions;
        DROP TABLE IF EXISTS camera_subscriptions;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS users;
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer'
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
        INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');
        INSERT INTO users (id, username, role) VALUES (42, 'budi', 'customer');
        INSERT INTO cameras (id, name) VALUES (7, 'Kamera Toko Budi');
        INSERT INTO cameras (id, name) VALUES (8, 'Kamera Gudang Budi');
    `);
}

function cameraRow(id) {
    return db.prepare('SELECT * FROM cameras WHERE id = ?').get(id);
}

function subscriptionRow(cameraId) {
    return db.prepare('SELECT * FROM camera_subscriptions WHERE camera_id = ?').get(cameraId);
}

describe('billingService', () => {
    beforeEach(() => {
        seedSchema();
    });

    it('dailyCostOf prorates a 21k monthly price to 700/day', () => {
        expect(dailyCostOf(21000)).toBe(700);
        expect(dailyCostOf(15000)).toBe(500);
        expect(dailyCostOf(25000)).toBe(833);
    });

    it('assignment makes the camera subscriber-class, charges day one, and activates', () => {
        walletService.credit({ userId: 42, amount: 10000 });

        const subscription = billingService.assignSubscription(
            { camera_id: 7, user_id: 42, monthly_price: 21000 }
        );

        expect(subscription.status).toBe('active');
        expect(subscription.last_charged_date).toBe(TODAY);

        const camera = cameraRow(7);
        expect(camera.camera_class).toBe('subscriber');
        expect(camera.owner_user_id).toBe(42);
        expect(camera.billing_status).toBe('active');

        expect(walletService.getBalance(42)).toBe(10000 - 700);
    });

    it('assignment with an empty wallet starts the camera suspended', () => {
        billingService.assignSubscription({ camera_id: 7, user_id: 42, monthly_price: 21000 });

        expect(subscriptionRow(7).status).toBe('suspended');
        expect(cameraRow(7).billing_status).toBe('suspended');
    });

    it('rejects assignment to non-customer users', () => {
        expect(() => billingService.assignSubscription({ camera_id: 7, user_id: 1, monthly_price: 21000 }))
            .toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('runDailyCharges charges each active subscription once per day (idempotent re-run)', () => {
        walletService.credit({ userId: 42, amount: 5000 });
        billingService.assignSubscription({ camera_id: 7, user_id: 42, monthly_price: 21000 });
        const balanceAfterAssign = walletService.getBalance(42);

        const first = billingService.runDailyCharges();
        const second = billingService.runDailyCharges();

        // Day-one charge already happened during assignment — the tick must not re-charge.
        expect(walletService.getBalance(42)).toBe(balanceAfterAssign);
        expect(first.charged).toBe(0);
        expect(second.processed).toBe(0);
    });

    it('suspends the subscription and camera when the wallet cannot cover the day', () => {
        walletService.credit({ userId: 42, amount: 700 }); // covers day one only
        billingService.assignSubscription({ camera_id: 7, user_id: 42, monthly_price: 21000 });
        expect(subscriptionRow(7).status).toBe('active');

        // Simulate the next local day.
        db.prepare("UPDATE camera_subscriptions SET last_charged_date = '2000-01-01' WHERE camera_id = 7").run();
        const summary = billingService.runDailyCharges();

        expect(summary.suspended).toBe(1);
        expect(subscriptionRow(7).status).toBe('suspended');
        expect(cameraRow(7).billing_status).toBe('suspended');
        // No partial charge happened.
        expect(walletService.getBalance(42)).toBe(0);
    });

    it('top-up resume reactivates suspended cameras and charges the day', () => {
        billingService.assignSubscription({ camera_id: 7, user_id: 42, monthly_price: 21000 });
        expect(subscriptionRow(7).status).toBe('suspended'); // empty wallet

        walletService.credit({ userId: 42, amount: 5000 });
        const result = billingService.tryResumeForUser(42);

        expect(result.resumedCameraIds).toEqual([7]);
        expect(subscriptionRow(7).status).toBe('active');
        expect(cameraRow(7).billing_status).toBe('active');
        expect(subscriptionRow(7).last_charged_date).toBe(TODAY);
        expect(walletService.getBalance(42)).toBe(5000 - 700);
    });

    it('cancelled subscriptions never auto-resume and keep the stream blocked', () => {
        walletService.credit({ userId: 42, amount: 10000 });
        billingService.assignSubscription({ camera_id: 7, user_id: 42, monthly_price: 21000 });
        billingService.updateSubscription(subscriptionRow(7).id, { status: 'cancelled' });

        expect(subscriptionRow(7).status).toBe('cancelled');
        expect(cameraRow(7).billing_status).toBe('suspended');

        const resume = billingService.tryResumeForUser(42);
        expect(resume.resumedCameraIds).toEqual([]);
        const tick = billingService.runDailyCharges();
        expect(tick.processed).toBe(0);
        expect(subscriptionRow(7).status).toBe('cancelled');
    });

    it('setCameraClass refuses while a non-cancelled subscription exists, then works after cancel', () => {
        walletService.credit({ userId: 42, amount: 10000 });
        billingService.assignSubscription({ camera_id: 7, user_id: 42, monthly_price: 21000 });

        expect(() => billingService.setCameraClass(7, { camera_class: 'community' }))
            .toThrowError(expect.objectContaining({ statusCode: 400 }));

        billingService.updateSubscription(subscriptionRow(7).id, { status: 'cancelled' });
        const camera = billingService.setCameraClass(7, { camera_class: 'community' });
        expect(camera.camera_class).toBe('community');
        expect(camera.owner_user_id).toBe(null);
        expect(camera.billing_status).toBe(null);
    });

    it('owner_private reclass requires and stores an owner', () => {
        expect(() => billingService.setCameraClass(8, { camera_class: 'owner_private' }))
            .toThrowError(expect.objectContaining({ statusCode: 400 }));

        const camera = billingService.setCameraClass(8, { camera_class: 'owner_private', owner_user_id: 42 });
        expect(camera.camera_class).toBe('owner_private');
        expect(camera.owner_user_id).toBe(42);
    });

    it('customer billing summary aggregates daily cost and estimates days left', () => {
        walletService.credit({ userId: 42, amount: 10000 });
        billingService.assignSubscription({ camera_id: 7, user_id: 42, monthly_price: 21000 });
        billingService.assignSubscription({ camera_id: 8, user_id: 42, monthly_price: 15000 });

        const summary = billingService.getCustomerBillingSummary(42);
        expect(summary.daily_cost).toBe(700 + 500);
        expect(summary.balance).toBe(10000 - 700 - 500);
        expect(summary.estimated_days_left).toBe(Math.floor((10000 - 1200) / 1200));
        expect(summary.subscriptions).toHaveLength(2);
    });
});
