/**
 * Purpose: Kunci bahwa tautan sponsor→kamera adalah KUNCI, bukan kecocokan nama.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Sampai hari ini satu-satunya yang menghubungkan sebuah kamera ke barisnya di tabel `sponsors`
 * adalah `WHERE name = ?`. Tiga bentuk kegagalan sudah menunggu di situ, dan ketiganya SENYAP —
 * tidak ada galat, tidak ada baris log, hanya angka yang salah di panel yang paling dipercaya
 * operator:
 *
 *   1. Sponsor mengganti namanya  -> tautan ke SEMUA kameranya putus. Hitungan jatuh ke nol dan
 *      batas kameranya berhenti berlaku, jadi ia bisa mengambil kamera tanpa batas.
 *   2. Dua sponsor bernama sama    -> kamera keduanya menyatu, dan jatah salah satunya dipakai
 *      untuk keduanya.
 *   3. Sponsor dihapus             -> kameranya tetap membawa nama, logo, dan URL-nya, dan tetap
 *      MENAMPILKANNYA di permukaan publik. Sponsor yang kontraknya sudah habis terus diiklankan.
 *
 * Ongkos memperbaikinya sekarang nol: nol baris sponsors dan nol kamera bertautan di produksi.
 * Tes ini yang membuatnya tetap nol.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const { db } = vi.hoisted(() => {
    const Db = require('better-sqlite3');
    return { db: new Db(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (fn) => db.transaction(fn)(),
}));

const {
    assignSponsorToCamera,
    removeSponsorFromCamera,
    countCamerasPerSponsor,
    deleteSponsor,
    updateSponsor,
} = await import('../services/sponsorService.js');

function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS sponsors;
        CREATE TABLE sponsors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT, logo TEXT, url TEXT, package TEXT, price INTEGER,
            active INTEGER DEFAULT 1, start_date TEXT, end_date TEXT,
            contact_name TEXT, contact_email TEXT, contact_phone TEXT,
            notes TEXT, camera_limit INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY, name TEXT, area_id INTEGER, enabled INTEGER,
            camera_class TEXT, private_rtsp_url TEXT, stream_key TEXT,
            sponsor_id INTEGER,
            sponsor_name TEXT, sponsor_logo TEXT, sponsor_url TEXT, sponsor_package TEXT,
            updated_at TEXT
        );

        INSERT INTO sponsors (id, name, logo, url, package, camera_limit)
        VALUES (1, 'CV Distributor Nusantara', '/logo/nusantara.png', 'https://nusantara.example', 'gold', 2);

        INSERT INTO cameras (id, name, area_id, enabled, camera_class)
        VALUES (11, 'CCTV LAPANGAN DANDER', 2, 1, 'community'),
               (12, 'CCTV BALAI TANJUNGHARJO', 3, 1, 'community'),
               (13, 'CCTV PASAR DANDER', 2, 1, 'community');
    `);
}

const kamera = (id) => db.prepare('SELECT * FROM cameras WHERE id = ?').get(id);

const PASANG = {
    sponsor_id: 1,
    sponsor_name: 'CV Distributor Nusantara',
    sponsor_logo: '/logo/nusantara.png',
    sponsor_url: 'https://nusantara.example',
    sponsor_package: 'gold',
};

beforeEach(resetSchema);

describe('tautannya kunci, bukan nama', () => {
    it('memasang sponsor menuliskan sponsor_id, bukan hanya namanya', () => {
        assignSponsorToCamera(11, PASANG);

        expect(kamera(11).sponsor_id).toBe(1);
        expect(kamera(11).sponsor_name).toBe('CV Distributor Nusantara');
    });

    it('SPONSOR GANTI NAMA: kameranya tidak lepas, dan hitungannya tetap benar', () => {
        assignSponsorToCamera(11, PASANG);
        assignSponsorToCamera(12, PASANG);

        updateSponsor(1, { name: 'PT Distributor Nusantara Jaya' });

        // Ini yang dulu jatuh ke nol dan membuat batas kamera berhenti berlaku sepenuhnya.
        expect(countCamerasPerSponsor()[1]).toBe(2);
        // Dan yang dirender ikut tersegarkan - bukan nama lama yang menggantung selamanya.
        expect(kamera(11).sponsor_name).toBe('PT Distributor Nusantara Jaya');
    });

    it('SPONSOR GANTI LOGO: kamera ikut memakai logo barunya', () => {
        assignSponsorToCamera(11, PASANG);

        updateSponsor(1, { logo: '/logo/nusantara-2027.png' });

        expect(kamera(11).sponsor_logo).toBe('/logo/nusantara-2027.png');
    });

    it('bidang non-tampilan tidak menyentuh kamera sama sekali', () => {
        assignSponsorToCamera(11, PASANG);
        const sebelum = kamera(11);

        updateSponsor(1, { contact_phone: '628999', notes: 'perpanjangan 2027' });

        expect(kamera(11).sponsor_name).toBe(sebelum.sponsor_name);
        expect(kamera(11).sponsor_logo).toBe(sebelum.sponsor_logo);
    });

    it('SPONSOR DIHAPUS: kameranya berhenti mengiklankannya', () => {
        assignSponsorToCamera(11, PASANG);
        assignSponsorToCamera(12, PASANG);

        deleteSponsor(1);

        for (const id of [11, 12]) {
            const c = kamera(id);
            expect(c.sponsor_id, `kamera ${id} masih tertaut`).toBeNull();
            expect(c.sponsor_name, `kamera ${id} masih memasang namanya`).toBeNull();
            expect(c.sponsor_logo, `kamera ${id} masih memasang logonya`).toBeNull();
            expect(c.sponsor_url, `kamera ${id} masih menautkan situsnya`).toBeNull();
        }
        expect(db.prepare('SELECT COUNT(*) AS n FROM sponsors').get().n).toBe(0);
    });

    it('melepas sponsor dari satu kamera juga melepas kuncinya', () => {
        assignSponsorToCamera(11, PASANG);

        removeSponsorFromCamera(11);

        expect(kamera(11).sponsor_id).toBeNull();
        expect(kamera(11).sponsor_name).toBeNull();
    });
});

describe('batas kamera dihitung lewat kunci', () => {
    it('menolak kamera ketiga saat batasnya dua', () => {
        assignSponsorToCamera(11, PASANG);
        assignSponsorToCamera(12, PASANG);

        expect(() => assignSponsorToCamera(13, PASANG)).toThrow(/batas 2 kamera/);
        expect(kamera(13).sponsor_id).toBeNull();
    });

    it('batasnya TETAP berlaku sesudah sponsor berganti nama', () => {
        // Bentuk kegagalan aslinya: hitungan lewat nama membaca 0 sesudah rename, jadi sponsor
        // berbatas dua bisa mengambil kamera tanpa batas hanya dengan mengganti namanya.
        assignSponsorToCamera(11, PASANG);
        assignSponsorToCamera(12, PASANG);
        updateSponsor(1, { name: 'Nama Yang Sudah Berbeda' });

        expect(() => assignSponsorToCamera(13, { ...PASANG, sponsor_name: 'Nama Yang Sudah Berbeda' }))
            .toThrow(/batas 2 kamera/);
    });

    it('memasang ulang sponsor yang sama ke kamera yang sama tetap boleh (idempoten)', () => {
        assignSponsorToCamera(11, PASANG);
        assignSponsorToCamera(12, PASANG);

        expect(() => assignSponsorToCamera(12, PASANG)).not.toThrow();
    });

    it('dua sponsor bernama sama dihitung TERPISAH', () => {
        // Dikelompokkan lewat nama, keduanya menyatu jadi satu angka - dan jatah batas kamera
        // salah satunya dipakai untuk keduanya.
        db.prepare("INSERT INTO sponsors (id, name, package, camera_limit) VALUES (2, 'CV Distributor Nusantara', 'silver', 5)").run();
        assignSponsorToCamera(11, { ...PASANG, sponsor_id: 1 });
        assignSponsorToCamera(12, { ...PASANG, sponsor_id: 2 });
        assignSponsorToCamera(13, { ...PASANG, sponsor_id: 2 });

        const hitung = countCamerasPerSponsor();

        expect(hitung[1]).toBe(1);
        expect(hitung[2]).toBe(2);
    });

    it('kamera warisan yang membawa NAMA tanpa kunci tidak dihitung untuk siapa pun', () => {
        // Bentuk yang ditinggalkan migrasi ketika sebuah nama cocok dengan lebih dari satu baris:
        // sengaja dibiarkan tanpa kunci, karena datanya sendiri tidak bisa menjawab milik siapa.
        // Menghitungnya lewat nama akan membebankannya ke sponsor yang belum tentu benar.
        db.prepare("UPDATE cameras SET sponsor_name = 'CV Distributor Nusantara' WHERE id = 13").run();
        assignSponsorToCamera(11, PASANG);

        expect(countCamerasPerSponsor()[1]).toBe(1);
    });

    it('kamera yang dimatikan tidak ikut dihitung', () => {
        assignSponsorToCamera(11, PASANG);
        db.prepare('UPDATE cameras SET enabled = 0 WHERE id = ?').run(11);

        expect(countCamerasPerSponsor()[1]).toBeUndefined();
    });
});

describe('nama ganda ditolak, tidak ditebak', () => {
    it('menolak memasang lewat nama yang dimiliki dua sponsor', () => {
        db.prepare("INSERT INTO sponsors (id, name, package, camera_limit) VALUES (2, 'CV Distributor Nusantara', 'silver', 5)").run();

        expect(() => assignSponsorToCamera(11, { ...PASANG, sponsor_id: undefined }))
            .toThrow(/Pilih sponsornya lewat id/);
        expect(kamera(11).sponsor_id, 'menebak salah satu dan menautkannya diam-diam').toBeNull();
    });

    it('id tetap bisa memilih salah satu dari dua nama kembar', () => {
        db.prepare("INSERT INTO sponsors (id, name, package, camera_limit) VALUES (2, 'CV Distributor Nusantara', 'silver', 5)").run();

        assignSponsorToCamera(11, { ...PASANG, sponsor_id: 2 });

        expect(kamera(11).sponsor_id).toBe(2);
    });

    it('id yang tidak ada ditolak 404, bukan ditulis sebagai tautan menggantung', () => {
        let dilempar = null;
        try { assignSponsorToCamera(11, { ...PASANG, sponsor_id: 999 }); } catch (e) { dilempar = e; }

        expect(dilempar?.statusCode).toBe(404);
        expect(kamera(11).sponsor_id).toBeNull();
    });
});

/*
 * Seam terakhir, dan yang paling mudah terlewat: panel admin hanya bisa mengelola tautan yang
 * benar-benar SAMPAI kepadanya.
 *
 * Sebelum ini proyeksi daftar kamera admin tidak menyebut satu pun kolom sponsor, sementara
 * SponsorManagement.jsx membaca `camera.sponsor_name` di tujuh tempat: mencentang kamera yang
 * sudah disponsori, memperingatkan override, memfilter pencarian. Semuanya membaca undefined.
 * Dengan nol sponsor di produksi, tidak ada satu pun yang pernah terlihat salah.
 *
 * Diuji dengan MENJALANKAN proyeksinya terhadap tabel sungguhan, bukan mencocokkan teks SQL-nya -
 * doktrin yang sama dengan publicSurfaceProjections.test.js. Perbedaannya: di sana yang dijaga
 * kolom yang tidak boleh IKUT, di sini kolom yang harus ADA.
 */
describe('panel admin benar-benar menerima tautannya', () => {
    const sumber = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'services', 'cameraService.js'),
        'utf8',
    );
    const cocok = sumber.match(/const ADMIN_CAMERA_LIST_PROJECTION = `([\s\S]*?)`;/);

    it('proyeksinya ditemukan (kalau tidak, tes ini sendiri yang rusak)', () => {
        expect(cocok, 'ADMIN_CAMERA_LIST_PROJECTION tidak ditemukan di cameraService.js').toBeTruthy();
    });

    it('mengembalikan sponsor_id dan sponsor_name untuk kamera yang disponsori', () => {
        assignSponsorToCamera(11, PASANG);

        /*
         * Kueri yang sama seperti getAdminCameraList, dikurangi JOIN runtime yang tidak ada
         * hubungannya dengan sponsor. Yang diuji: kolomnya memang dinamai proyeksi DAN memang
         * ada di skema - dua kegagalan berbeda yang keduanya menghasilkan undefined di panel.
         */
        const kolom = cocok[1]
            .split(',')
            .map((bagian) => bagian.trim())
            .filter((bagian) => /^c\.[a-z_]+$/.test(bagian));

        // (a) proyeksinya MENYEBUT keduanya...
        expect(kolom, 'proyeksi admin tidak menyebut kunci sponsornya').toContain('c.sponsor_id');
        expect(kolom, 'proyeksi admin tidak menyebut nama sponsornya').toContain('c.sponsor_name');

        // ...dan (b) keduanya benar-benar ADA di skema, yang hanya bisa dibuktikan dengan
        // menjalankannya. Kolom yang salah eja lolos pemeriksaan (a) tapi gagal di sini.
        const sponsorKolom = kolom.filter((k) => k.startsWith('c.sponsor_'));
        const baris = db.prepare(`SELECT ${sponsorKolom.join(', ')} FROM cameras c WHERE c.id = 11`).get();

        expect(baris.sponsor_id, 'panel tidak bisa tahu kamera ini milik sponsor mana').toBe(1);
        expect(baris.sponsor_name, 'panel tidak bisa menampilkan sponsor kamera ini').toBe(PASANG.sponsor_name);
    });

    it('TIDAK membawa kolom rahasia ke daftar admin lewat pintu ini', () => {
        // Penambahan kolom sponsor tidak boleh menjadi alasan proyeksi ini melar jadi SELECT *.
        expect(cocok[1]).not.toContain('private_rtsp_url');
        expect(cocok[1].trim().startsWith('*'), 'proyeksinya berubah jadi bintang').toBe(false);
    });
});
