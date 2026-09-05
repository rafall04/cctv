/**
 * Purpose: Pin the PUBLIC surface of sponsorService — the one function an anonymous visitor can
 *          reach — against the two Critical Invariants it used to break.
 * Caller: Vitest backend suite.
 * Deps: an in-memory SQLite database standing in for connectionPool.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `GET /api/sponsors/cameras` is unauthenticated (routes/sponsorRoutes.js), and the handler sent
 * whatever the service returned straight to the caller with no projection in between. The service
 * ran `SELECT * FROM cameras WHERE sponsor_name IS NOT NULL AND enabled = 1`, so the first camera
 * ever given a sponsor would have published:
 *
 *   * its `private_rtsp_url` — "Never expose RTSP URLs to the frontend" — and its `stream_key`;
 *   * itself, whatever its `camera_class`, so a sponsored owner_private or subscriber camera
 *     would have landed on a public surface outright.
 *
 * Nothing leaked in production only because no camera has a sponsor assigned yet. That is a fact
 * about today's data, not a control, and assigning a sponsor is an ordinary supported admin
 * action — so it was one click from live.
 *
 * The route carried a comment claiming the opposite ("they cannot leak admin-only metadata, they
 * filter to enabled cameras only"). `enabled` was never the dangerous axis. That is the shape of
 * bug this file exists to catch: the fixture below therefore carries the DANGEROUS columns and a
 * non-community row, because a fixture that omits them cannot fail.
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

const { getCamerasWithSponsors, getActiveSponsors } = await import('../services/sponsorService.js');

/* The columns that must never reach an anonymous caller, named so the assertions can be blunt. */
const SECRET_COLUMNS = ['private_rtsp_url', 'stream_key'];

function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS cameras;
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY,
            name TEXT,
            area_id INTEGER,
            enabled INTEGER,
            camera_class TEXT,
            private_rtsp_url TEXT,
            stream_key TEXT,
            sponsor_name TEXT,
            sponsor_logo TEXT,
            sponsor_url TEXT,
            sponsor_package TEXT
        );

        INSERT INTO cameras
            (id, name, area_id, enabled, camera_class, private_rtsp_url, stream_key,
             sponsor_name, sponsor_logo, sponsor_url, sponsor_package)
        VALUES
            (11, 'CCTV LAPANGAN DANDER', 2, 1, 'community',
             'rtsp://admin:rahasia@10.0.0.11:554/stream1', 'sk_lapangan',
             'Toko Maju', '/logo/maju.png', 'https://maju.example', 'gold'),
            (12, 'CCTV BALAI TANJUNGHARJO', 3, 1, 'community',
             'rtsp://admin:rahasia@10.0.0.12:554/stream1', 'sk_balai',
             'Warung Sejahtera', '/logo/sejahtera.png', 'https://sejahtera.example', 'bronze'),
            (77, 'Rumah Pak Budi', 2, 1, 'owner_private',
             'rtsp://admin:rahasia@10.0.0.77:554/stream1', 'sk_rumah',
             'Toko Maju', '/logo/maju.png', 'https://maju.example', 'gold'),
            (78, 'Gudang Pelanggan', 3, 1, 'subscriber',
             'rtsp://admin:rahasia@10.0.0.78:554/stream1', 'sk_gudang',
             'Toko Maju', '/logo/maju.png', 'https://maju.example', 'silver'),
            (13, 'CCTV TANPA SPONSOR', 2, 1, 'community',
             'rtsp://admin:rahasia@10.0.0.13:554/stream1', 'sk_polos',
             NULL, NULL, NULL, NULL),
            (14, 'CCTV DIMATIKAN', 2, 0, 'community',
             'rtsp://admin:rahasia@10.0.0.14:554/stream1', 'sk_mati',
             'Toko Maju', '/logo/maju.png', 'https://maju.example', 'gold');
    `);
}

beforeEach(resetSchema);

describe('getCamerasWithSponsors — permukaan publik', () => {
    it('TIDAK PERNAH mengembalikan RTSP atau stream key', () => {
        const rows = getCamerasWithSponsors();

        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            for (const secret of SECRET_COLUMNS) {
                expect(row).not.toHaveProperty(secret);
            }
        }
    });

    /*
     * Asserted on the exact key set, not on "does not contain X". A negative list only catches the
     * leaks someone thought of; `SELECT *` leaks whatever the next migration adds, which is how a
     * column nobody was watching gets published.
     */
    it('mengembalikan PERSIS kolom yang dibutuhkan tampilan sponsor, tidak lebih', () => {
        const [row] = getCamerasWithSponsors();

        expect(Object.keys(row).sort()).toEqual([
            'area_id', 'id', 'name',
            'sponsor_logo', 'sponsor_name', 'sponsor_package', 'sponsor_url',
        ]);
    });

    it('melewati kamera owner_private dan subscriber walaupun disponsori', () => {
        const ids = getCamerasWithSponsors().map((row) => row.id);

        expect(ids).not.toContain(77);
        expect(ids).not.toContain(78);
    });

    it('tetap melayani kamera community yang disponsori — fiturnya utuh', () => {
        const ids = getCamerasWithSponsors().map((row) => row.id);

        expect(ids).toContain(11);
        expect(ids).toContain(12);
    });

    it('masih melewati kamera tanpa sponsor dan kamera yang dimatikan', () => {
        const ids = getCamerasWithSponsors().map((row) => row.id);

        expect(ids).not.toContain(13);
        expect(ids).not.toContain(14);
    });

    it('urutan paket tetap gold sebelum bronze', () => {
        expect(getCamerasWithSponsors().map((row) => row.id)).toEqual([11, 12]);
    });
});

describe('getActiveSponsors — batas end_date pakai tanggal LOKAL, bukan DATE(now) UTC', () => {
    beforeEach(() => {
        db.exec(`
            DROP TABLE IF EXISTS sponsors;
            DROP TABLE IF EXISTS sponsor_packages;
            CREATE TABLE sponsors (
                id INTEGER PRIMARY KEY, name TEXT, logo TEXT, url TEXT, package TEXT,
                active INTEGER, end_date TEXT, created_at TEXT
            );
            CREATE TABLE sponsor_packages (key TEXT, name TEXT, color TEXT, sort_order INTEGER);
            INSERT INTO sponsor_packages (key, name, color, sort_order) VALUES ('gold', 'Gold', '#f00', 1);
            INSERT INTO sponsors (id, name, package, active, end_date, created_at) VALUES
                (1, 'Berakhir hari ini', 'gold', 1, '2026-09-05', '2026-01-01'),
                (2, 'Kadaluarsa kemarin', 'gold', 1, '2026-09-04', '2026-01-01'),
                (3, 'Tanpa batas', 'gold', 1, NULL, '2026-01-01'),
                (4, 'Nonaktif', 'gold', 0, '2026-12-31', '2026-01-01');
        `);
    });

    it('menyertakan yang berakhir hari-lokal + tanpa batas, membuang yang kadaluarsa & nonaktif', () => {
        // Pukul 03:00 WIB 6 Sep = 20:00 UTC 5 Sep, jadi DATE('now') UTC masih '2026-09-05' dan sponsor
        // yang harusnya kadaluarsa akhir 5 Sep akan tetap tampil. getLocalDate() memberi '2026-09-06'.
        const ids = getActiveSponsors('2026-09-06').map((row) => row.id);
        expect(ids).not.toContain(1); // end_date 2026-09-05 < hari lokal 2026-09-06 → kadaluarsa, hilang
        expect(ids).not.toContain(2);
        expect(ids).not.toContain(4); // nonaktif
        expect(ids).toContain(3);     // end_date NULL → selalu tampil
    });

    it('masih menampilkan sponsor pada hari terakhirnya (batas inklusif)', () => {
        const ids = getActiveSponsors('2026-09-05').map((row) => row.id);
        expect(ids).toContain(1);     // end_date 2026-09-05 >= hari lokal 2026-09-05 → hari terakhir, tampil
        expect(ids).toContain(3);
        expect(ids).not.toContain(2);
    });
});
