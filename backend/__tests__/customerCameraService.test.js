/**
 * Purpose: Verify customer camera self-service — RTSP URL policy (SSRF guard that still
 *          allows ISP-private camera ranges), plan max-camera enforcement, ownership checks,
 *          and clean billing unlink on delete.
 * Caller: Backend focused test gate for customerCameraService + rtspUrlPolicy.
 * Deps: vitest, better-sqlite3 (in-memory), mocked cameraService/timezone/audit.
 * MainFuncs: self-service camera CRUD tests.
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

const { createCameraMock, updateCameraMock, deleteCameraMock } = vi.hoisted(() => ({
    createCameraMock: vi.fn(),
    updateCameraMock: vi.fn(),
    deleteCameraMock: vi.fn(),
}));

vi.mock('../services/cameraService.js', () => ({
    default: {
        invalidateCameraCache: vi.fn(),
        createCamera: createCameraMock,
        updateCamera: updateCameraMock,
        deleteCamera: deleteCameraMock,
    },
}));

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(),
    logSecurityEvent: vi.fn(),
    SECURITY_EVENTS: { ADMIN_ACTION: 'ADMIN_ACTION' },
}));

import customerCameraService from '../services/customerCameraService.js';
import { validateCustomerRtspUrl } from '../utils/rtspUrlPolicy.js';

const CUSTOMER = { id: 42, username: 'budi', role: 'customer' };

function seedSchema() {
    db.exec(`
        DROP TABLE IF EXISTS settings;
        DROP TABLE IF EXISTS billing_plans;
        DROP TABLE IF EXISTS wallets;
        DROP TABLE IF EXISTS wallet_transactions;
        DROP TABLE IF EXISTS camera_subscriptions;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS users;
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, updated_at TEXT);
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer',
            phone TEXT, email TEXT,
            plan_id INTEGER, plan_started_at TEXT, trial_ends_at TEXT,
            trial_used INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE billing_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
            price_per_camera INTEGER NOT NULL DEFAULT 0,
            max_cameras INTEGER NOT NULL DEFAULT 1,
            is_trial INTEGER NOT NULL DEFAULT 0, trial_days INTEGER,
            active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 100,
            created_at TEXT, updated_at TEXT
        );
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            location TEXT,
            owner_user_id INTEGER,
            camera_class TEXT NOT NULL DEFAULT 'community',
            billing_status TEXT,
            updated_at TEXT
        );
        CREATE TABLE wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            balance INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL, type TEXT NOT NULL,
            amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
            reference TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX idx_wallet_transactions_charge_ref
        ON wallet_transactions(reference) WHERE type = 'charge' AND reference IS NOT NULL;
        CREATE TABLE camera_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            monthly_price INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            activated_at TEXT, suspended_at TEXT, last_charged_date TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, username, role, plan_id, trial_used) VALUES (42, 'budi', 'customer', 2, 0);
        INSERT INTO billing_plans (id, key, name, price_per_camera, max_cameras, is_trial, trial_days)
        VALUES (1, 'trial', 'Trial', 0, 1, 1, 3),
               (2, 'hemat', 'Hemat', 20000, 2, 0, NULL);
        INSERT INTO wallets (user_id, balance) VALUES (42, 100000);
    `);
}

describe('rtspUrlPolicy.validateCustomerRtspUrl', () => {
    it('accepts public and ISP-private rtsp URLs (RFC1918 stays allowed)', () => {
        expect(validateCustomerRtspUrl('rtsp://36.66.1.2:554/stream').ok).toBe(true);
        expect(validateCustomerRtspUrl('rtsp://admin:pass@192.168.1.10:554/ch1').ok).toBe(true);
        expect(validateCustomerRtspUrl('rtsp://10.5.5.5/live').ok).toBe(true);
        expect(validateCustomerRtspUrl('rtsps://cam.example.com/stream').ok).toBe(true);
    });

    it('rejects non-rtsp schemes and malformed URLs', () => {
        expect(validateCustomerRtspUrl('http://192.168.1.10/stream').ok).toBe(false);
        expect(validateCustomerRtspUrl('file:///etc/passwd').ok).toBe(false);
        expect(validateCustomerRtspUrl('bukan url').ok).toBe(false);
        expect(validateCustomerRtspUrl('').ok).toBe(false);
    });

    it('rejects loopback, link-local, unspecified, and multicast literals', () => {
        expect(validateCustomerRtspUrl('rtsp://127.0.0.1:9997/api').ok).toBe(false);
        expect(validateCustomerRtspUrl('rtsp://0.0.0.0/x').ok).toBe(false);
        expect(validateCustomerRtspUrl('rtsp://169.254.1.1/x').ok).toBe(false);
        expect(validateCustomerRtspUrl('rtsp://224.0.0.1/x').ok).toBe(false);
        expect(validateCustomerRtspUrl('rtsp://[::1]:554/x').ok).toBe(false);
        expect(validateCustomerRtspUrl('rtsp://localhost/x').ok).toBe(false); // default env blocklist
    });

    it('honors the env blocklist (exact host and IPv4 prefix)', () => {
        process.env.BILLING_RTSP_BLOCKED_HOSTS = 'localhost,172.17.11.,vps.internal';
        try {
            expect(validateCustomerRtspUrl('rtsp://172.17.11.12:554/x').ok).toBe(false);
            expect(validateCustomerRtspUrl('rtsp://vps.internal/x').ok).toBe(false);
            expect(validateCustomerRtspUrl('rtsp://172.17.99.1/x').ok).toBe(true);
        } finally {
            delete process.env.BILLING_RTSP_BLOCKED_HOSTS;
        }
    });
});

describe('customerCameraService', () => {
    beforeEach(() => {
        seedSchema();
        createCameraMock.mockReset();
        updateCameraMock.mockReset();
        deleteCameraMock.mockReset();
        createCameraMock.mockImplementation(async (data) => {
            const result = db.prepare('INSERT INTO cameras (name) VALUES (?)').run(data.name);
            return { id: result.lastInsertRowid, name: data.name, stream_key: 'k' };
        });
        updateCameraMock.mockResolvedValue({});
        deleteCameraMock.mockImplementation(async (id) => {
            db.prepare('DELETE FROM cameras WHERE id = ?').run(id);
        });
    });

    it('creates an own camera wired as subscriber-class with a plan-priced subscription', async () => {
        const created = await customerCameraService.createOwnCamera(CUSTOMER, {
            name: 'Kamera Toko',
            private_rtsp_url: 'rtsp://192.168.1.10:554/ch1',
            location: 'Depan toko',
        }, { user: CUSTOMER, ip: '1.1.1.1' });

        const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(created.id);
        expect(camera.camera_class).toBe('subscriber');
        expect(camera.owner_user_id).toBe(42);
        const sub = db.prepare('SELECT * FROM camera_subscriptions WHERE camera_id = ?').get(created.id);
        expect(sub.monthly_price).toBe(20000);
        expect(sub.status).toBe('active');
    });

    it('enforces the plan camera limit', async () => {
        db.prepare("INSERT INTO cameras (name, owner_user_id, camera_class) VALUES ('A', 42, 'subscriber'), ('B', 42, 'subscriber')").run();

        await expect(customerCameraService.createOwnCamera(CUSTOMER, {
            name: 'Kamera Ketiga',
            private_rtsp_url: 'rtsp://192.168.1.11/ch1',
        }, { user: CUSTOMER })).rejects.toMatchObject({ statusCode: 400 });
        expect(createCameraMock).not.toHaveBeenCalled();
    });

    it('blocks self-add without a plan or after trial expiry', async () => {
        db.prepare('UPDATE users SET plan_id = NULL WHERE id = 42').run();
        await expect(customerCameraService.createOwnCamera(CUSTOMER, {
            name: 'X', private_rtsp_url: 'rtsp://192.168.1.11/ch1',
        }, { user: CUSTOMER })).rejects.toMatchObject({ statusCode: 400 });

        const past = new Date(Date.now() - 1000).toISOString();
        db.prepare('UPDATE users SET plan_id = 1, trial_ends_at = ? WHERE id = 42').run(past);
        await expect(customerCameraService.createOwnCamera(CUSTOMER, {
            name: 'X', private_rtsp_url: 'rtsp://192.168.1.11/ch1',
        }, { user: CUSTOMER })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects policy-violating RTSP URLs before touching cameraService', async () => {
        await expect(customerCameraService.createOwnCamera(CUSTOMER, {
            name: 'Jahat', private_rtsp_url: 'rtsp://127.0.0.1:9997/api',
        }, { user: CUSTOMER })).rejects.toMatchObject({ statusCode: 400 });
        expect(createCameraMock).not.toHaveBeenCalled();
    });

    it('updates only own cameras with the restricted field set', async () => {
        db.prepare("INSERT INTO cameras (id, name, owner_user_id, camera_class) VALUES (50, 'Punya Budi', 42, 'subscriber')").run();
        db.prepare("INSERT INTO cameras (id, name, owner_user_id, camera_class) VALUES (51, 'Punya Orang', 99, 'subscriber')").run();

        await customerCameraService.updateOwnCamera(CUSTOMER, 50, {
            name: 'Nama Baru', private_rtsp_url: 'rtsp://192.168.1.20/ch2',
        }, { user: CUSTOMER });
        expect(updateCameraMock).toHaveBeenCalledWith(50, {
            name: 'Nama Baru',
            private_rtsp_url: 'rtsp://192.168.1.20/ch2',
        }, expect.anything());

        await expect(customerCameraService.updateOwnCamera(CUSTOMER, 51, { name: 'Hack' }, { user: CUSTOMER }))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('delete removes the subscription link first and only for own cameras', async () => {
        db.prepare("INSERT INTO cameras (id, name, owner_user_id, camera_class) VALUES (60, 'Hapus Saya', 42, 'subscriber')").run();
        db.prepare("INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status) VALUES (60, 42, 20000, 'active')").run();

        await customerCameraService.deleteOwnCamera(CUSTOMER, 60, { user: CUSTOMER });
        expect(db.prepare('SELECT COUNT(*) AS n FROM camera_subscriptions WHERE camera_id = 60').get().n).toBe(0);
        expect(deleteCameraMock).toHaveBeenCalled();

        await expect(customerCameraService.deleteOwnCamera(CUSTOMER, 999, { user: CUSTOMER }))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});
