/**
 * Purpose: A scheduler down across one or more midnights must bill EVERY missed day on its next run,
 *          not just today — bounded, idempotent, and still honoring the offline-day courtesy for the
 *          dark tail of a gap. Regression for the "multi-day downtime is free" undercharge.
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

// Wallet remembers which charge references it has seen so idempotency is real across catch-up days.
const seen = new Set();
const { chargeOnceMock } = vi.hoisted(() => ({ chargeOnceMock: vi.fn() }));
vi.mock('../services/walletService.js', () => ({
    default: {
        chargeOnce: chargeOnceMock, ensureWallet: vi.fn(),
        getBalance: vi.fn(() => 100000), debit: vi.fn(), credit: vi.fn(),
    },
}));
vi.mock('../services/cameraService.js', () => ({ default: { invalidateCameraCache: vi.fn() } }));
vi.mock('../services/cameraAccessService.js', () => ({ invalidateCameraAccessCache: vi.fn() }));
vi.mock('../services/timezoneService.js', () => ({ getTimezone: () => 'Asia/Jakarta' }));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: vi.fn() }));

const { default: billingService, localDateString, billableDaysThrough } = await import('../services/billingService.js');

const HARI_INI = localDateString();
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDateString(d); };
const sub = () => db.prepare('SELECT * FROM camera_subscriptions WHERE id = 1').get();

beforeEach(() => {
    seen.clear();
    chargeOnceMock.mockReset();
    chargeOnceMock.mockImplementation(({ reference }) => {
        const already = seen.has(reference);
        seen.add(reference);
        return { charged: !already, alreadyCharged: already };
    });
    for (const t of ['users', 'cameras', 'camera_subscriptions', 'camera_runtime_state', 'settings', 'billing_plans']) {
        db.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, plan_id INTEGER, trial_ends_at TEXT, trial_used INTEGER DEFAULT 0)");
    db.exec("CREATE TABLE billing_plans (id INTEGER PRIMARY KEY, key TEXT, name TEXT, is_trial INTEGER DEFAULT 0)");
    db.exec("CREATE TABLE cameras (id INTEGER PRIMARY KEY, name TEXT, billing_status TEXT, updated_at TEXT)");
    db.exec(`CREATE TABLE camera_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER,
             user_id INTEGER, monthly_price INTEGER, status TEXT, suspend_reason TEXT, activated_at TEXT,
             suspended_at TEXT, last_charged_date TEXT, updated_at TEXT)`);
    db.exec('CREATE TABLE camera_runtime_state (camera_id INTEGER PRIMARY KEY, is_online INTEGER, last_online_at TEXT)');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');

    db.exec("INSERT INTO billing_plans (id, key, name, is_trial) VALUES (1, 'hemat', 'Hemat', 0)");
    db.exec("INSERT INTO users (id, username, role, plan_id) VALUES (1, 'budi', 'customer', 1)");
    db.exec("INSERT INTO cameras (id, name, billing_status) VALUES (10, 'Kamera Budi', 'active')");
    db.exec("INSERT INTO settings (key, value) VALUES ('billing_skip_offline_days', 'true')");
    // Camera online today → online on/after every gap day, so the whole gap is billable.
    db.exec(`INSERT INTO camera_runtime_state (camera_id, is_online, last_online_at) VALUES (10, 1, '${HARI_INI} 08:00:00')`);
    db.exec(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status, last_charged_date)
             VALUES (10, 1, 30000, 'active', '${daysAgo(3)}')`); // last charged 3 days ago → 3 missed days
});

describe('billableDaysThrough (pure)', () => {
    it('enumerasi hari SESUDAH lastCharged sampai today (inklusif)', () => {
        expect(billableDaysThrough('2026-08-27', '2026-08-30')).toEqual(['2026-08-28', '2026-08-29', '2026-08-30']);
    });
    it('lastCharged null / >= today → hanya [today]', () => {
        expect(billableDaysThrough(null, '2026-08-30')).toEqual(['2026-08-30']);
        expect(billableDaysThrough('2026-08-30', '2026-08-30')).toEqual(['2026-08-30']);
        expect(billableDaysThrough('2026-09-01', '2026-08-30')).toEqual(['2026-08-30']);
    });
    it('dibatasi cap hari terakhir (anti shock-bill setelah outage panjang)', () => {
        const hasil = billableDaysThrough('2020-01-01', '2026-08-30', 31);
        expect(hasil.length).toBe(31);
        expect(hasil[hasil.length - 1]).toBe('2026-08-30');
    });
});

describe('runDailyCharges menagih hari yang terlewat', () => {
    it('kamera online → 3 hari gap ditagih semua, last_charged_date maju ke hari ini', () => {
        const ringkasan = billingService.runDailyCharges();

        expect(ringkasan.charged).toBe(3);   // daysAgo(2), daysAgo(1), today
        expect(ringkasan.caughtUp).toBe(1);
        expect(chargeOnceMock).toHaveBeenCalledTimes(3);
        expect(sub().last_charged_date).toBe(HARI_INI);
    });

    it('idempoten: menjalankan lagi TIDAK menagih ulang', () => {
        billingService.runDailyCharges();
        chargeOnceMock.mockClear();
        const kedua = billingService.runDailyCharges();
        expect(kedua.processed).toBe(0); // last_charged_date == today → tak jatuh tempo lagi
        expect(chargeOnceMock).not.toHaveBeenCalled();
    });

    it('ekor gap yang GELAP dihormati offline-courtesy (kamera mati sebelum gap)', () => {
        // Kamera terakhir online 3 hari lalu (= lastCharged), tak pernah online sesudahnya.
        db.prepare(`UPDATE camera_runtime_state SET last_online_at = ? WHERE camera_id = 10`).run(`${daysAgo(3)} 08:00:00`);

        const ringkasan = billingService.runDailyCharges();

        // Semua hari gap SESUDAH lastCharged berada di atas last-online → dilewati (tak ditagih).
        expect(ringkasan.charged).toBe(0);
        expect(chargeOnceMock).not.toHaveBeenCalled();
        expect(sub().status).toBe('active');        // outage bukan alasan suspend
        expect(sub().last_charged_date).toBe(HARI_INI); // hari ditandai supaya tak dicoba tiap menit
    });
});
