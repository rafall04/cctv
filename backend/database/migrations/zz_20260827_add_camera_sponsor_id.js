/*
Purpose: Tautkan kamera ke sponsor lewat KUNCI, bukan lewat kecocokan nama.
Caller: run-all-migrations (urutan nama berkas).
Deps: better-sqlite3 terhadap backend/data/cctv.db.
SideEffects: ALTER TABLE cameras (1 kolom) + 1 indeks + isi ulang dari sponsor_name. Idempoten.

KENAPA NAMA TIDAK CUKUP
-----------------------
Kamera membawa salinan sponsor_name/logo/url/package, dan SATU-SATUNYA yang menghubungkannya ke
baris sponsors adalah kecocokan `WHERE name = ?`. Tiga bentuk kegagalan yang sudah menunggu:

  · Sponsor ganti nama -> tautan ke SEMUA kameranya putus seketika, tanpa galat, tanpa jejak.
    Hitungan kamera di panel admin jatuh ke nol, batas kamera berhenti berlaku, dan tidak ada
    yang tahu sampai ada yang menghitung manual.
  · Dua sponsor bernama sama -> kamera keduanya menyatu jadi satu, dan batas kamera salah satunya
    dipakai untuk keduanya.
  · Sponsor dihapus -> kameranya menyimpan nama, logo, dan URL sponsor yang sudah tidak ada, dan
    tetap MENAMPILKANNYA di permukaan publik.

Sekarang harganya nol: nol baris sponsors dan nol kamera bertautan di produksi. Setahun lagi,
sesudah selusin sponsor tanda tangan, memperbaikinya berarti menebak-nebak nama mana milik siapa.

KENAPA KOLOM SALINAN TETAP DIPERTAHANKAN
----------------------------------------
sponsor_name/logo/url/package TIDAK dibuang. Ia tetap jadi yang dirender, sehingga tidak ada
kueri publik yang harus di-JOIN ulang dalam migrasi ini - perubahan sekecil mungkin, satu hal
saja. Yang berubah: sponsor_id-lah yang menjadi kebenaran untuk MENGHITUNG, MEMBATASI, dan
MEMBERSIHKAN, dan salinannya diperbarui dari baris sponsors setiap kali sponsornya berubah.
*/

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '..', '..', 'data', 'cctv.db'));

function adaTabel(nama) {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(nama));
}

try {
    if (!adaTabel('cameras')) {
        console.log('Tabel cameras belum ada - tidak ada yang diubah');
    } else {
        const kolom = new Set(db.prepare('PRAGMA table_info(cameras)').all().map((r) => r.name));

        if (kolom.has('sponsor_id')) {
            console.log('Kolom cameras.sponsor_id sudah ada');
            /*
             * Indeksnya TETAP dipastikan di sini. Versi pertama migrasi ini menaruhnya di
             * dalam cabang "kolom baru", dan itu berarti basis data yang sudah menerima
             * kolomnya dari jalan lain - atau dari jalankan yang terputus di tengah - tidak
             * akan pernah mendapat indeksnya, selamanya, tanpa satu pun keluhan. Terbukti di
             * basis data pengembangan: kolomnya ada, indeksnya tidak.
             */
            db.exec('CREATE INDEX IF NOT EXISTS idx_cameras_sponsor_id ON cameras(sponsor_id)');
        } else if (!kolom.has('sponsor_name')) {
            console.log('Kolom sponsor_name belum ada - migrasi sponsor lama belum jalan, dilewati');
        } else {
            db.exec('BEGIN');
            /*
             * Tanpa REFERENCES: SQLite tidak bisa menambahkan batasan kunci asing lewat ALTER TABLE,
             * dan menulis ulang seluruh tabel `cameras` - tabel terpanas di sistem ini - hanya untuk
             * itu bukan pertukaran yang sepadan. Keutuhannya dijaga di sponsorService: menghapus
             * sponsor MEMBERSIHKAN tautannya di transaksi yang sama.
             */
            db.exec('ALTER TABLE cameras ADD COLUMN sponsor_id INTEGER');
            db.exec('CREATE INDEX IF NOT EXISTS idx_cameras_sponsor_id ON cameras(sponsor_id)');

            if (adaTabel('sponsors')) {
                /*
                 * Diisi HANYA ketika namanya cocok tepat satu baris. Nama ganda dibiarkan NULL
                 * dengan sengaja: menebak salah satunya akan menaruh kamera pada sponsor yang
                 * keliru secara permanen, dan NULL adalah satu-satunya jawaban yang jujur untuk
                 * pertanyaan yang datanya sendiri tidak bisa menjawabnya.
                 */
                const hasil = db.prepare(`
                    UPDATE cameras
                    SET sponsor_id = (SELECT s.id FROM sponsors s WHERE s.name = cameras.sponsor_name)
                    WHERE sponsor_name IS NOT NULL
                      AND (SELECT COUNT(*) FROM sponsors s WHERE s.name = cameras.sponsor_name) = 1
                `).run();
                console.log(`Tautan sponsor diisi ulang untuk ${hasil.changes} kamera`);

                const ambigu = db.prepare(`
                    SELECT COUNT(*) AS n FROM cameras
                    WHERE sponsor_name IS NOT NULL AND sponsor_id IS NULL
                `).get();
                if (ambigu.n > 0) {
                    console.warn(
                        `${ambigu.n} kamera membawa sponsor_name yang tidak cocok dengan tepat satu `
                        + 'baris sponsors - tautannya dibiarkan kosong dan harus dipilih ulang di panel admin'
                    );
                }
            }

            db.exec('COMMIT');
            console.log('Kolom cameras.sponsor_id ditambahkan');
        }
    }
} catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* tidak ada transaksi terbuka */ }
    console.error('Migrasi sponsor_id gagal:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
