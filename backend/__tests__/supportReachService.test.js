/**
 * Purpose: Kunci bahwa angka yang dijual ke calon pendukung hanya menghitung permukaan PUBLIK.
 * Caller: Backend test gate (vitest, node env).
 * Deps: better-sqlite3 in-memory dengan skema sungguhan.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Ada satu cara sangat mudah membohongi calon sponsor tanpa berniat: menghitung SEMUA sesi
 * tontonan. viewer_session_history memuat baris untuk kamera owner_private dan subscriber juga -
 * itu pemilik yang menonton kamera rumahnya sendiri. Kueri yang benar secara teknis, atas
 * populasi yang salah, menjual jangkauan yang tidak pernah dimiliki permukaan publik.
 *
 * Kesalahan yang sama pernah terjadi di repo ini dalam bentuk lain: tujuh kebocoran permukaan
 * publik, semuanya satu bentuk - handler anonim yang menyaring satu hal lalu membiarkan sisanya
 * menumpang.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => {
    const Db = require('better-sqlite3');
    return { db: new Db(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (fn) => db.transaction(fn),
}));

const { getPublicReach, REACH_WINDOW_DAYS } = await import('../services/supportReachService.js');

function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS viewer_session_history;
        DROP TABLE IF EXISTS cameras;
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY, name TEXT, area_id INTEGER,
            enabled INTEGER NOT NULL DEFAULT 1,
            camera_class TEXT NOT NULL DEFAULT 'community'
        );
        CREATE TABLE viewer_session_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER, started_at TEXT
        );

        INSERT INTO cameras (id, name, area_id, enabled, camera_class) VALUES
            (11, 'CCTV LAPANGAN DANDER',  2, 1, 'community'),
            (12, 'CCTV BALAI TANJUNG',    3, 1, 'community'),
            (13, 'CCTV DIMATIKAN',        2, 0, 'community'),
            (14, 'CCTV TANPA AREA',    NULL, 1, 'community'),
            (77, 'Rumah Pak Budi',        2, 1, 'owner_private'),
            (78, 'Gudang Pelanggan',      3, 1, 'subscriber');
    `);
}

/** Satu sesi tontonan `hariLalu` hari yang lalu. */
function sesi(cameraId, hariLalu) {
    db.prepare(
        "INSERT INTO viewer_session_history (camera_id, started_at) VALUES (?, datetime('now', ?))"
    ).run(cameraId, `-${hariLalu} day`);
}

beforeEach(resetSchema);

describe('sesi: hanya permukaan publik, hanya jendelanya', () => {
    it('menghitung sesi kamera community di dalam jendela', () => {
        sesi(11, 1);
        sesi(12, 10);
        sesi(11, REACH_WINDOW_DAYS - 1);

        expect(getPublicReach().sessions).toBe(3);
    });

    it('TIDAK menghitung tontonan kamera privat pemiliknya sendiri', () => {
        sesi(11, 1);
        sesi(77, 1);
        sesi(77, 2);

        expect(getPublicReach().sessions, 'kamera rumah ikut dijual sebagai jangkauan publik').toBe(1);
    });

    it('TIDAK menghitung tontonan kamera langganan', () => {
        sesi(11, 1);
        sesi(78, 1);

        expect(getPublicReach().sessions).toBe(1);
    });

    it('membuang sesi yang lebih tua dari jendelanya', () => {
        sesi(11, 1);
        sesi(11, REACH_WINDOW_DAYS + 5);
        sesi(11, 400);

        expect(getPublicReach().sessions).toBe(1);
    });

    it('sesi kamera yang sudah dihapus tidak dihitung', () => {
        // JOIN, bukan sub-select opsional: baris yatim tidak boleh menambah angka penjualan.
        sesi(999, 1);

        expect(getPublicReach().sessions).toBe(0);
    });
});

describe('kamera dan area: yang benar-benar terbit', () => {
    it('menghitung kamera community yang aktif saja', () => {
        // 11, 12, 14 -> tiga. 13 dimatikan; 77 dan 78 bukan community.
        expect(getPublicReach().cameras).toBe(3);
    });

    it('menghitung area yang PUNYA kamera community aktif, bukan setiap baris area', () => {
        // Area 2 (kamera 11) dan area 3 (kamera 12) -> dua. Kamera 14 tanpa area tidak menambah,
        // dan area kamera 13 yang dimatikan tidak dihitung.
        expect(getPublicReach().areas).toBe(2);
    });

    it('area kamera privat tidak menambah hitungan area', () => {
        db.prepare("UPDATE cameras SET area_id = 9 WHERE id = 77").run();

        expect(getPublicReach().areas).toBe(2);
    });
});

describe('bentuk muatannya', () => {
    it('PERSIS empat bilangan bulat, tidak lebih', () => {
        const hasil = getPublicReach();

        expect(Object.keys(hasil).sort()).toEqual(['areas', 'cameras', 'sessions', 'window_days']);
        for (const [k, v] of Object.entries(hasil)) {
            expect(Number.isInteger(v), `${k} bukan bilangan bulat`).toBe(true);
        }
    });

    it('tidak membocorkan rasio klik afiliasi - itu angka negosiasi', () => {
        // Ia keunggulan tawar terkuat yang ada; menerbitkannya ke halaman publik menghapusnya.
        expect(JSON.stringify(getPublicReach())).not.toMatch(/ctr|click|klik/i);
    });

    it('menyebutkan jendelanya sendiri, supaya halaman tidak perlu menebaknya', () => {
        expect(getPublicReach().window_days).toBe(REACH_WINDOW_DAYS);
    });
});
