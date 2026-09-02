/*
Purpose: Simpan kredensial ONVIF opsional per kamera, dan keadaan jam terakhir tiap kamera.
Caller: run-all-migrations (urutan nama berkas).
Deps: better-sqlite3 terhadap backend/data/cctv.db.
SideEffects: ALTER TABLE cameras (2 kolom) + CREATE TABLE camera_time_status. Idempoten.

KENAPA KREDENSIAL ONVIF TERPISAH, DAN KENAPA BOLEH KOSONG
---------------------------------------------------------
Penyelaras waktu memakai kredensial dari `private_rtsp_url` — dan itu benar untuk hampir semua
kamera, karena akun yang sama dipakai RTSP maupun ONVIF. Jadi kolom ini KOSONG secara default
dan tidak menuntut operator melakukan apa pun.

Ia ada untuk keadaan darurat yang memang terjadi: sebagian firmware memisahkan akun ONVIF dari
akun utama, atau operator sengaja membuat akun RTSP read-only yang tidak boleh mengubah setelan
perangkat. Tanpa jalan keluar ini, satu kamera semacam itu akan gagal diselaraskan selamanya
tanpa cara memperbaikinya dari panel admin.

NULL berarti "pakai kredensial RTSP", BUKAN "kosong". Karena itu tidak ada DEFAULT '': string
kosong dan NULL akan berarti dua hal berbeda dan mustahil dibedakan setahun dari sekarang.

CATATAN KEAMANAN, DITULIS APA ADANYA
------------------------------------
Sandi ini disimpan tanpa enkripsi, sama seperti sandi RTSP yang sudah lama tersimpan di dalam
`private_rtsp_url`. Itu bukan pembenaran, itu keterangan: menyandikan yang satu sementara yang
lain telanjang hanya memberi rasa aman palsu. Keduanya tidak pernah dikirim ke permukaan publik
(lihat invarian "jangan pernah mengekspos URL RTSP ke frontend"), dan kolom sandi TIDAK IKUT
dikirim ke halaman admin — yang dikirim hanya penanda apakah ia terisi.

KENAPA STATUS PUNYA TABELNYA SENDIRI
------------------------------------
Keadaan jam adalah pengamatan yang berubah tiap jam, bukan sifat kamera. Menempelkannya ke tabel
`cameras` akan membuat setiap pemeriksaan menulis ke baris yang dibaca oleh hampir semua kueri
lain di sistem ini — termasuk permukaan publik — dan mengotori cache-nya tanpa alasan.
Satu baris per kamera, ditimpa tiap siklus: yang dibutuhkan operator adalah keadaan SEKARANG,
bukan riwayat.
*/

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolveDbPath();
const db = new Database(dbPath);

const KOLOM_KAMERA = [
    ['onvif_username', 'TEXT'],
    ['onvif_password', 'TEXT'],
];

function kolomYangAda(tabel) {
    return new Set(db.prepare(`PRAGMA table_info(${tabel})`).all().map((row) => row.name));
}

try {
    const adaTabelKamera = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cameras'")
        .get();

    if (!adaTabelKamera) {
        console.log('Tabel cameras belum ada — tidak ada yang diubah');
    } else {
        const ada = kolomYangAda('cameras');
        const kurang = KOLOM_KAMERA.filter(([nama]) => !ada.has(nama));

        if (kurang.length === 0) {
            console.log('Kolom kredensial ONVIF sudah ada');
        } else {
            db.exec('BEGIN');
            for (const [nama, tipe] of kurang) {
                db.exec(`ALTER TABLE cameras ADD COLUMN ${nama} ${tipe}`);
            }
            db.exec('COMMIT');
            console.log(`Kolom ditambahkan ke cameras: ${kurang.map(([n]) => n).join(', ')}`);
        }
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS camera_time_status (
            camera_id INTEGER PRIMARY KEY,
            checked_at TEXT NOT NULL,
            reachable INTEGER NOT NULL DEFAULT 0,
            mode TEXT,
            drift_seconds INTEGER,
            method TEXT,
            healthy INTEGER NOT NULL DEFAULT 0,
            note TEXT,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_camera_time_checked ON camera_time_status(checked_at)');
    console.log('Tabel camera_time_status siap');
} catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* tidak ada transaksi terbuka */ }
    console.error('Migrasi gagal:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
