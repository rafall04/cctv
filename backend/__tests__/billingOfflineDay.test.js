/**
 * Purpose: A day on which the camera never came online must not be charged — and the switch that
 *          governs it must actually govern it.
 * Caller: backend test gate.
 * Deps: vitest, better-sqlite3 (in-memory), connectionPool + wallet/camera services mocked.
 * SideEffects: In-memory database only — never touches prod data.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The daily charge never looked at the camera at all: internet down for a week still cost seven
 * days. That is defensible as a business model but indefensible unstated, and the page already
 * tells customers "rekaman mengikuti koneksi di lokasi kamera".
 *
 * The signal matters as much as the rule. `cameras.last_online_check` is refreshed on EVERY health
 * probe (its `? = 1` guard is passed a literal 1), so it says when we last looked, not when the
 * camera last worked — billing on it would charge a dead camera forever. `is_online` is a snapshot
 * taken at whatever moment the charge happens to run. So this asserts against last_online_at, and
 * the cases below are exactly the ones those two wrong signals would get wrong.
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

const { chargeOnceMock } = vi.hoisted(() => ({ chargeOnceMock: vi.fn(() => ({ charged: true, alreadyCharged: false })) }));
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

const { default: billingService, localDateString } = await import('../services/billingService.js');

const HARI_INI = localDateString();
const kemarin = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
};

const langganan = () => db.prepare('SELECT * FROM camera_subscriptions WHERE camera_id = 10').get();
const setOnlineAt = (nilai) => db.prepare('UPDATE camera_runtime_state SET last_online_at = ? WHERE camera_id = 10')
    .run(nilai instanceof Date ? nilai.toISOString() : nilai);
const setSaklar = (aktif) => db.prepare("INSERT INTO settings (key, value) VALUES ('billing_skip_offline_days', ?) "
    + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(aktif ? 'true' : 'false');

beforeEach(() => {
    chargeOnceMock.mockClear();
    for (const t of ['users', 'cameras', 'camera_subscriptions', 'camera_runtime_state', 'settings', 'billing_plans']) {
        db.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, plan_id INTEGER,
                                 trial_ends_at TEXT, trial_used INTEGER DEFAULT 0)`);
    db.exec("CREATE TABLE billing_plans (id INTEGER PRIMARY KEY, key TEXT, name TEXT, is_trial INTEGER DEFAULT 0, trial_days INTEGER)");
    db.exec('CREATE TABLE cameras (id INTEGER PRIMARY KEY, name TEXT, billing_status TEXT, updated_at TEXT)');
    db.exec(`CREATE TABLE camera_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER,
             user_id INTEGER, monthly_price INTEGER, status TEXT, activated_at TEXT, suspended_at TEXT,
             last_charged_date TEXT, updated_at TEXT)`);
    db.exec('CREATE TABLE camera_runtime_state (camera_id INTEGER PRIMARY KEY, is_online INTEGER, last_online_at TEXT)');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');

    db.exec("INSERT INTO billing_plans (id, key, name, is_trial) VALUES (1, 'hemat', 'Hemat', 0)");
    db.exec("INSERT INTO users (id, username, role, plan_id) VALUES (1, 'budi', 'customer', 1)");
    db.exec("INSERT INTO cameras (id, name, billing_status) VALUES (10, 'Kamera Budi', 'active')");
    db.exec(`INSERT INTO camera_subscriptions (camera_id, user_id, monthly_price, status)
             VALUES (10, 1, 30000, 'active')`);
    db.exec('INSERT INTO camera_runtime_state (camera_id, is_online) VALUES (10, 0)');
});

describe('hari yang kameranya tidak pernah hidup tidak ditagih', () => {
    it('kamera hidup hari ini → tetap ditagih seperti biasa', () => {
        setOnlineAt(new Date());
        const hasil = billingService._chargeAndSync(langganan(), HARI_INI);

        expect(hasil.charged).toBe(true);
        expect(chargeOnceMock).toHaveBeenCalledTimes(1);
        expect(chargeOnceMock.mock.calls[0][0].amount).toBe(1000); // 30.000 / 30
    });

    it('kamera terakhir hidup kemarin → hari ini tidak ditagih, langganan TETAP aktif', () => {
        setOnlineAt(kemarin());
        const hasil = billingService._chargeAndSync(langganan(), HARI_INI);

        expect(chargeOnceMock).not.toHaveBeenCalled();
        expect(hasil.reason).toBe('kamera_offline_seharian');
        // Gangguan internet pelanggan bukan alasan menangguhkan langganannya.
        expect(hasil.status).toBe('active');
        expect(langganan().status).toBe('active');
    });

    it('kamera belum pernah hidup sama sekali → tidak ditagih, bukan dianggap bekerja', () => {
        setOnlineAt(null);
        billingService._chargeAndSync(langganan(), HARI_INI);
        expect(chargeOnceMock).not.toHaveBeenCalled();
    });

    it('hari yang dilewati tetap ditandai, supaya tidak dicoba ulang tiap menit', () => {
        setOnlineAt(kemarin());
        billingService._chargeAndSync(langganan(), HARI_INI);
        expect(langganan().last_charged_date).toBe(HARI_INI);
    });

    it('kamera yang hidup sebentar lalu mati tetap membayar hari itu', () => {
        // Sinyalnya "pernah hidup hari ini", bukan "sedang hidup sekarang" — kamera yang bekerja
        // 23 jam lalu mati lima menit sebelum penagihan tidak boleh dapat hari gratis.
        const tadiPagi = new Date();
        tadiPagi.setHours(1, 0, 0, 0);
        setOnlineAt(tadiPagi);
        db.prepare('UPDATE camera_runtime_state SET is_online = 0 WHERE camera_id = 10').run();

        const hasil = billingService._chargeAndSync(langganan(), HARI_INI);
        expect(hasil.charged).toBe(true);
    });

    it('saklar dimatikan → kembali menagih walau kamera mati seharian', () => {
        setSaklar(false);
        setOnlineAt(kemarin());

        const hasil = billingService._chargeAndSync(langganan(), HARI_INI);
        expect(hasil.charged).toBe(true);
        expect(chargeOnceMock).toHaveBeenCalledTimes(1);
    });

    it('tanpa baris setelan sama sekali → bawaannya melewati, bukan menagih', () => {
        db.exec('DELETE FROM settings');
        setOnlineAt(kemarin());

        billingService._chargeAndSync(langganan(), HARI_INI);
        expect(chargeOnceMock).not.toHaveBeenCalled();
    });

    it('tanpa tabel kesehatan sama sekali → tetap menagih, tidak menggratiskan diam-diam', () => {
        // "Tidak diketahui" berbeda dari "tidak bekerja". Skema yang tertinggal tidak boleh
        // membuat semua langganan gratis tanpa ada yang menyadarinya; kelebihan tagih bisa
        // dikembalikan, kekurangan tagih yang senyap tidak pernah ketahuan.
        db.exec('DROP TABLE camera_runtime_state');

        const hasil = billingService._chargeAndSync(langganan(), HARI_INI);
        expect(hasil.charged).toBe(true);
        expect(chargeOnceMock).toHaveBeenCalledTimes(1);
    });
});
