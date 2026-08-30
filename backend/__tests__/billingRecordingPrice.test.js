/**
 * Purpose: Lock the recording surcharge into the money path — one price per subscription, derived
 *          from the plan and the camera's own recording flag, and never silently lost.
 * Caller: backend test gate.
 * Deps: vitest, better-sqlite3 (in-memory), connectionPool mocked onto the billing services.
 * SideEffects: In-memory database only — never touches prod data.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Plans could advertise "+Rp 10.000 bila kamera merekam" while the charging engine billed
 * price_per_camera alone, so the surcharge was sold and never collected. Wiring it in exposed a
 * second, worse bug in the existing repricing: editing ANY plan price ran
 *
 *     UPDATE camera_subscriptions SET monthly_price = <price_per_camera> WHERE ...
 *
 * which flattens every subscription onto the base price and erases the surcharge — silently, since
 * the catalog still shows it. The last test here is that exact scenario, and it fails without the
 * per-camera recompute.
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

vi.mock('../services/cameraService.js', () => ({
    default: { invalidateCameraCache: vi.fn(), getCameraById: vi.fn() },
}));
vi.mock('../services/walletService.js', () => ({
    default: {
        getBalance: vi.fn(() => 0), debit: vi.fn(), credit: vi.fn(),
        ensureWallet: vi.fn(), getWallet: vi.fn(() => ({ balance: 0 })),
        // Assignment charges the first day immediately; this file is about the PRICE, so the
        // wallet just reports success and the assertions read monthly_price.
        chargeOnce: vi.fn(() => ({ charged: true, balance: 100000 })),
    },
}));
vi.mock('../services/cameraAccessService.js', () => ({ invalidateCameraAccessCache: vi.fn() }));
vi.mock('../services/timezoneService.js', () => ({ getTimezone: () => 'Asia/Jakarta', getBillingTimezone: () => 'Asia/Jakarta' }));
vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(), logSecurityEvent: vi.fn(), SECURITY_EVENTS: {},
}));

const { default: billingService } = await import('../services/billingService.js');
const { default: billingPlanService } = await import('../services/billingPlanService.js');

const hargaLangganan = (cameraId) =>
    db.prepare('SELECT monthly_price FROM camera_subscriptions WHERE camera_id = ?').get(cameraId).monthly_price;

beforeEach(() => {
    for (const t of ['billing_plans', 'users', 'cameras', 'camera_subscriptions']) {
        db.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    db.exec(`CREATE TABLE billing_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, name TEXT, description TEXT,
        price_per_camera INTEGER NOT NULL DEFAULT 0,
        recording_price_per_camera INTEGER NOT NULL DEFAULT 0,
        recording_retention_days INTEGER NOT NULL DEFAULT 0,
        max_cameras INTEGER DEFAULT 1, is_trial INTEGER DEFAULT 0, trial_days INTEGER,
        active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 100,
        created_at TEXT, updated_at TEXT
    )`);
    db.exec(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, plan_id INTEGER
    )`);
    db.exec(`CREATE TABLE cameras (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, enable_recording INTEGER DEFAULT 0,
        owner_user_id INTEGER, camera_class TEXT, billing_status TEXT,
        is_public INTEGER NOT NULL DEFAULT 0, updated_at TEXT
    )`);
    db.exec(`CREATE TABLE camera_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, user_id INTEGER,
        monthly_price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', suspend_reason TEXT,
        activated_at TEXT, suspended_at TEXT, last_charged_date TEXT,
        created_at TEXT, updated_at TEXT
    )`);

    // Satu paket: tonton 15.000, rekam +10.000. Dua pelanggan di paket yang sama —
    // satu kameranya merekam, satu tidak.
    db.exec(`INSERT INTO billing_plans (id, key, name, price_per_camera, recording_price_per_camera, max_cameras)
             VALUES (1, 'basic', 'Basic', 15000, 10000, 5)`);
    db.exec(`INSERT INTO users (id, username, role, plan_id) VALUES
             (1, 'budi', 'customer', 1), (2, 'siti', 'customer', 1)`);
    db.exec(`INSERT INTO cameras (id, name, enable_recording, owner_user_id, camera_class) VALUES
             (10, 'Kamera Merekam', 1, 1, 'subscriber'),
             (11, 'Kamera Tonton',  0, 2, 'subscriber')`);
    db.exec(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status) VALUES
             (10, 1, 25000, 'active'), (11, 2, 15000, 'active')`);
});

describe('harga bulanan = tonton + rekam (bila kamera merekam)', () => {
    it('kamera yang merekam dihargai tonton + tambahan', () => {
        expect(billingService.monthlyPriceFor(10)).toBe(25000);
    });

    it('kamera yang hanya ditonton tidak kena tambahan', () => {
        expect(billingService.monthlyPriceFor(11)).toBe(15000);
    });

    it('kamera tanpa langganan tidak menghasilkan harga (bukan 0 yang menyesatkan)', () => {
        db.exec("INSERT INTO cameras (id, name, enable_recording) VALUES (12, 'Lepas', 1)");
        expect(billingService.monthlyPriceFor(12)).toBeNull();
    });

    it('mematikan rekaman menurunkan harga kamera itu saja', () => {
        db.exec('UPDATE cameras SET enable_recording = 0 WHERE id = 10');
        billingService.repriceSubscriptionForCamera(10);

        expect(hargaLangganan(10)).toBe(15000);
        expect(hargaLangganan(11)).toBe(15000); // tetangga tidak ikut berubah
    });

    it('menyalakan rekaman menaikkan harga kamera itu saja', () => {
        db.exec('UPDATE cameras SET enable_recording = 1 WHERE id = 11');
        billingService.repriceSubscriptionForCamera(11);

        expect(hargaLangganan(11)).toBe(25000);
        expect(hargaLangganan(10)).toBe(25000);
    });

    it('langganan yang sudah dibatalkan tidak ikut dihargai ulang', () => {
        db.exec("UPDATE camera_subscriptions SET status = 'cancelled', monthly_price = 99 WHERE camera_id = 10");
        billingService.repriceSubscriptionForCamera(10);
        expect(hargaLangganan(10)).toBe(99);
    });
});

describe('assign: harga diturunkan dari paket bila admin tidak menyebut angka', () => {
    beforeEach(() => {
        db.exec("INSERT INTO cameras (id, name, enable_recording) VALUES (20, 'Baru Merekam', 1), (21, 'Baru Tonton', 0)");
    });

    it('kamera merekam dapat harga tonton + tambahan', () => {
        billingService.assignSubscription({ camera_id: 20, user_id: 1 });
        expect(hargaLangganan(20)).toBe(25000);
    });

    it('kamera tonton-saja dapat harga tonton saja', () => {
        billingService.assignSubscription({ camera_id: 21, user_id: 1 });
        expect(hargaLangganan(21)).toBe(15000);
    });

    it('angka eksplisit dari admin tetap menang (mis. diskon yang dinegosiasikan)', () => {
        billingService.assignSubscription({ camera_id: 20, user_id: 1, monthly_price: 5000 });
        expect(hargaLangganan(20)).toBe(5000);
    });
});

describe('mengedit harga paket tidak boleh menghapus tambahan rekam', () => {
    it('menaikkan harga tonton: kamera perekam tetap membawa tambahannya', () => {
        // Inilah bug yang ditutup file ini. Repricing lama menulis 20000 rata ke semua
        // langganan, jadi kamera perekam diam-diam berhenti membayar tambahan rekamnya.
        billingPlanService.updatePlan(1, { price_per_camera: 20000 });

        expect(hargaLangganan(10)).toBe(30000); // 20.000 + 10.000
        expect(hargaLangganan(11)).toBe(20000); // tonton saja
    });

    it('mengubah HANYA tambahan rekam tetap memicu penghargaan ulang', () => {
        // Repricing lama hanya melihat price_per_camera, jadi perubahan tarif rekam
        // tidak pernah sampai ke pelanggan yang sudah berlangganan.
        billingPlanService.updatePlan(1, { recording_price_per_camera: 4000 });

        expect(hargaLangganan(10)).toBe(19000); // 15.000 + 4.000
        expect(hargaLangganan(11)).toBe(15000);
    });

    it('menurunkan tambahan rekam ke 0 menyisakan harga tonton saja', () => {
        billingPlanService.updatePlan(1, { recording_price_per_camera: 0 });
        expect(hargaLangganan(10)).toBe(15000);
    });

    it('mengubah field non-harga tidak menyentuh harga langganan sama sekali', () => {
        db.exec('UPDATE camera_subscriptions SET monthly_price = 12345 WHERE camera_id = 10');
        billingPlanService.updatePlan(1, { name: 'Basic Baru' });
        expect(hargaLangganan(10)).toBe(12345);
    });

    it('pelanggan di paket lain tidak ikut terpengaruh', () => {
        db.exec(`INSERT INTO billing_plans (id, key, name, price_per_camera, recording_price_per_camera, max_cameras)
                 VALUES (2, 'hemat', 'Hemat', 9000, 3000, 5)`);
        db.exec("INSERT INTO users (id, username, role, plan_id) VALUES (3, 'tono', 'customer', 2)");
        db.exec("INSERT INTO cameras (id, name, enable_recording, owner_user_id) VALUES (13, 'Lain', 1, 3)");
        db.exec("INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status) VALUES (13, 3, 12000, 'active')");

        billingPlanService.updatePlan(1, { price_per_camera: 20000 });

        expect(hargaLangganan(13)).toBe(12000); // paket lain, tidak disentuh
    });
});
