/**
 * Purpose: An operator "Suspend" is a HOLD — it must survive the hourly tick, a top-up, and a plan
 *          switch, and only lift on an explicit admin re-activation. Balance-out suspends still
 *          auto-resume as before. Regression for the bug where the hourly tick reversed an admin
 *          suspend within the hour and charged the held customer.
 * Caller: backend test gate.
 * Deps: vitest, better-sqlite3 (in-memory), connectionPool + wallet/camera services mocked.
 * SideEffects: In-memory database only — never touches prod data.
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
    transaction: (fn) => fn(),
}));

// Wallet: funded by default (charge succeeds). Flip `broke` to simulate an empty wallet (402).
const state = { broke: false };
const { chargeOnceMock } = vi.hoisted(() => ({ chargeOnceMock: vi.fn() }));
vi.mock('../services/walletService.js', () => ({
    default: {
        chargeOnce: chargeOnceMock, ensureWallet: vi.fn(),
        getBalance: vi.fn(() => (state.broke ? 0 : 100000)), debit: vi.fn(), credit: vi.fn(),
    },
}));
vi.mock('../services/cameraService.js', () => ({ default: { invalidateCameraCache: vi.fn() } }));
vi.mock('../services/cameraAccessService.js', () => ({ invalidateCameraAccessCache: vi.fn() }));
vi.mock('../services/timezoneService.js', () => ({ getTimezone: () => 'Asia/Jakarta' }));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: vi.fn() }));

const { default: billingService, localDateString } = await import('../services/billingService.js');

const HARI_INI = localDateString();
const sub = () => db.prepare('SELECT * FROM camera_subscriptions WHERE id = 1').get();
const kamera = () => db.prepare('SELECT * FROM cameras WHERE id = 10').get();

beforeEach(() => {
    state.broke = false;
    chargeOnceMock.mockReset();
    chargeOnceMock.mockImplementation(() => {
        if (state.broke) { const e = new Error('Insufficient balance'); e.statusCode = 402; throw e; }
        return { charged: true, alreadyCharged: false };
    });
    for (const t of ['users', 'cameras', 'camera_subscriptions', 'camera_runtime_state', 'settings', 'billing_plans']) {
        db.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, plan_id INTEGER, trial_ends_at TEXT, trial_used INTEGER DEFAULT 0)");
    db.exec("CREATE TABLE billing_plans (id INTEGER PRIMARY KEY, key TEXT, name TEXT, is_trial INTEGER DEFAULT 0, price_per_camera INTEGER, recording_price_per_camera INTEGER DEFAULT 0)");
    db.exec("CREATE TABLE cameras (id INTEGER PRIMARY KEY, name TEXT, billing_status TEXT, camera_class TEXT, owner_user_id INTEGER, enable_recording INTEGER DEFAULT 0, updated_at TEXT)");
    db.exec(`CREATE TABLE camera_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER,
             user_id INTEGER, monthly_price INTEGER, status TEXT, suspend_reason TEXT, activated_at TEXT,
             suspended_at TEXT, last_charged_date TEXT, updated_at TEXT)`);
    db.exec('CREATE TABLE camera_runtime_state (camera_id INTEGER PRIMARY KEY, is_online INTEGER, last_online_at TEXT)');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');

    db.exec("INSERT INTO billing_plans (id, key, name, is_trial, price_per_camera) VALUES (1, 'hemat', 'Hemat', 0, 30000)");
    db.exec("INSERT INTO users (id, username, role, plan_id) VALUES (1, 'budi', 'customer', 1)");
    db.exec("INSERT INTO cameras (id, name, billing_status, camera_class, owner_user_id) VALUES (10, 'Kamera Budi', 'active', 'subscriber', 1)");
    // Camera online today so the offline-skip path never masks a charge decision.
    db.exec(`INSERT INTO camera_runtime_state (camera_id, is_online, last_online_at) VALUES (10, 1, '${HARI_INI} 08:00:00')`);
    db.exec("INSERT INTO settings (key, value) VALUES ('billing_skip_offline_days', 'false')");
    db.exec(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status, last_charged_date)
             VALUES (10, 1, 30000, 'active', '${HARI_INI}')`);
});

describe('admin hold (suspend_reason)', () => {
    it('admin Suspend menandai reason=admin dan menahan kamera', () => {
        billingService.updateSubscription(1, { status: 'suspended' });
        expect(sub().status).toBe('suspended');
        expect(sub().suspend_reason).toBe('admin');
        expect(kamera().billing_status).toBe('suspended');
    });

    it('tick harian TIDAK membatalkan admin-hold dan TIDAK menagih pelanggan yang ditahan', () => {
        billingService.updateSubscription(1, { status: 'suspended' }); // funded + online, tapi ditahan admin
        chargeOnceMock.mockClear();
        // Hari berganti (last_charged_date kemarin) supaya sub "jatuh tempo" andai tak ditahan.
        db.prepare("UPDATE camera_subscriptions SET last_charged_date = '2020-01-01' WHERE id = 1").run();

        const ringkasan = billingService.runDailyCharges();

        expect(chargeOnceMock).not.toHaveBeenCalled();
        expect(sub().status).toBe('suspended');
        expect(sub().suspend_reason).toBe('admin');
        expect(ringkasan.processed).toBe(0); // baris admin-hold bahkan tak diambil kueri
    });

    it('top-up TIDAK memulihkan langganan yang ditahan admin', () => {
        billingService.updateSubscription(1, { status: 'suspended' });
        chargeOnceMock.mockClear();

        const hasil = billingService.tryResumeForUser(1);

        expect(hasil.resumedCameraIds).toEqual([]);
        expect(chargeOnceMock).not.toHaveBeenCalled();
        expect(sub().status).toBe('suspended');
    });

    it('re-aktivasi admin eksplisit MEMULIHKAN + menagih dan menghapus reason', () => {
        billingService.updateSubscription(1, { status: 'suspended' });
        chargeOnceMock.mockClear();
        db.prepare("UPDATE camera_subscriptions SET last_charged_date = '2020-01-01' WHERE id = 1").run();

        billingService.updateSubscription(1, { status: 'active' });

        expect(sub().status).toBe('active');
        expect(sub().suspend_reason).toBeNull();
        expect(kamera().billing_status).toBe('active');
        expect(chargeOnceMock).toHaveBeenCalledTimes(1);
    });

    it('suspend HABIS-SALDO tetap auto-pulih saat top-up (jalur baik tak rusak)', () => {
        // Saldo habis → tick men-suspend dengan reason=balance.
        state.broke = true;
        db.prepare("UPDATE camera_subscriptions SET last_charged_date = '2020-01-01' WHERE id = 1").run();
        billingService.runDailyCharges();
        expect(sub().status).toBe('suspended');
        expect(sub().suspend_reason).toBe('balance');

        // Pelanggan isi saldo → tryResumeForUser memulihkan (reason 'balance' TIDAK dikecualikan).
        state.broke = false;
        chargeOnceMock.mockClear();
        const hasil = billingService.tryResumeForUser(1);

        expect(hasil.resumedCameraIds).toEqual([10]);
        expect(sub().status).toBe('active');
        expect(sub().suspend_reason).toBeNull();
        expect(chargeOnceMock).toHaveBeenCalledTimes(1);
    });
});
