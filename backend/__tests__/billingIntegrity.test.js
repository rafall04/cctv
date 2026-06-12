/**
 * Purpose: Verify healOrphanedSubscriberCameras — a subscriber camera whose owner_user_id no
 *          longer exists is unpublished + suspended (so a deleted customer's camera can never
 *          linger public/streamable), while valid subscriber and community cameras are untouched.
 * Caller: Backend focused test gate for billingService integrity sweep.
 * Deps: vitest, better-sqlite3 (in-memory); mocked cameraService/cameraAccessService/timezone/audit.
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
vi.mock('../services/cameraService.js', () => ({ default: { invalidateCameraCache: vi.fn() } }));
vi.mock('../services/cameraAccessService.js', () => ({ invalidateCameraAccessCache: vi.fn() }));
vi.mock('../services/timezoneService.js', () => ({ getTimezone: () => 'Asia/Jakarta' }));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: vi.fn() }));

import billingService from '../services/billingService.js';

beforeEach(() => {
    db.exec(`
        DROP TABLE IF EXISTS camera_subscriptions;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS users;
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
        CREATE TABLE cameras (id INTEGER PRIMARY KEY, name TEXT, owner_user_id INTEGER, camera_class TEXT, is_public INTEGER DEFAULT 0, billing_status TEXT, updated_at TEXT);
        CREATE TABLE camera_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, user_id INTEGER, monthly_price INTEGER, status TEXT, suspended_at TEXT, updated_at TEXT);
        INSERT INTO users (id, username) VALUES (42, 'budi');
        -- orphan: owner 999 does NOT exist, but published + active
        INSERT INTO cameras (id, name, owner_user_id, camera_class, is_public, billing_status) VALUES (10, 'Orphan', 999, 'subscriber', 1, 'active');
        INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status) VALUES (10, 999, 20000, 'active');
        -- valid subscriber camera (owner exists)
        INSERT INTO cameras (id, name, owner_user_id, camera_class, is_public, billing_status) VALUES (11, 'Valid', 42, 'subscriber', 1, 'active');
        INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status) VALUES (11, 42, 20000, 'active');
        -- community camera (owner NULL)
        INSERT INTO cameras (id, name, owner_user_id, camera_class, is_public, billing_status) VALUES (12, 'Comm', NULL, 'community', 0, NULL);
    `);
});

describe('billingService.healOrphanedSubscriberCameras', () => {
    it('unpublishes + suspends ONLY orphaned subscriber cameras', () => {
        const res = billingService.healOrphanedSubscriberCameras();
        expect(res).toMatchObject({ healed: 1, cameraIds: [10] });

        const orphan = db.prepare('SELECT is_public, billing_status FROM cameras WHERE id = 10').get();
        expect(orphan.is_public).toBe(0);            // dropped from public surfaces
        expect(orphan.billing_status).toBe('suspended'); // stream gate now denies it
        expect(db.prepare('SELECT status FROM camera_subscriptions WHERE camera_id = 10').get().status).toBe('suspended');

        // Valid subscriber camera is untouched.
        const valid = db.prepare('SELECT is_public, billing_status FROM cameras WHERE id = 11').get();
        expect(valid.is_public).toBe(1);
        expect(valid.billing_status).toBe('active');
        // Community camera untouched.
        expect(db.prepare('SELECT billing_status FROM cameras WHERE id = 12').get().billing_status).toBe(null);
    });

    it('is a no-op (healed 0) when there are no orphans', () => {
        db.prepare('DELETE FROM cameras WHERE id = 10').run();
        db.prepare('DELETE FROM camera_subscriptions WHERE camera_id = 10').run();
        expect(billingService.healOrphanedSubscriberCameras()).toMatchObject({ healed: 0, cameraIds: [] });
    });
});
