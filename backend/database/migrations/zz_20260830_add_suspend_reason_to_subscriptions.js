/*
Purpose: Bedakan tahanan operator ('admin') dari suspend habis-saldo ('balance') pada langganan.
Caller: run-all-migrations (urutan nama berkas).
Deps: better-sqlite3 terhadap backend/data/cctv.db.
SideEffects: ALTER TABLE camera_subscriptions (1 kolom). Idempoten. Tanpa backfill.

KENAPA KOLOM INI ADA
--------------------
Sebelumnya `status='suspended'` berarti dua hal yang bertolak belakang:

  · Saldo habis  -> HARUS pulih sendiri begitu pelanggan isi saldo (top-up / tick harian).
  · Ditahan admin -> HARUS tetap tersuspend sampai admin mengaktifkannya kembali (mis. sengketa,
    penyalahgunaan). Operator menekan tombol Suspend, lalu satu jam kemudian tick harian
    MEMBATALKANNYA dan malah MENAGIH pelanggan yang sedang ditahan. Tombolnya efektif tidak
    berfungsi untuk pelanggan yang saldonya masih ada.

Karena keduanya berbagi satu status, tidak ada cara membedakannya. Kolom ini menyimpan ALASAN-nya:
  · 'admin'   -> hanya diangkat oleh re-aktivasi admin eksplisit; tick/top-up/ganti-paket melewatinya.
  · 'balance' -> pulih sendiri seperti dulu.
  · NULL      -> baris lama/tidak diketahui = diperlakukan sebagai 'balance' (pulih sendiri), jadi
                 semua langganan tersuspend yang sudah ada tetap berperilaku persis seperti sebelumnya.

Tanpa backfill DENGAN sengaja: satu-satunya suspend yang benar-benar ada di produksi hari ini adalah
habis-saldo (tombol admin toh tidak pernah "menempel"), jadi NULL->balance sudah tepat.
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
    if (!adaTabel('camera_subscriptions')) {
        console.log('Tabel camera_subscriptions belum ada - tidak ada yang diubah');
    } else {
        const kolom = new Set(db.prepare('PRAGMA table_info(camera_subscriptions)').all().map((r) => r.name));
        if (kolom.has('suspend_reason')) {
            console.log('Kolom camera_subscriptions.suspend_reason sudah ada');
        } else {
            db.exec('ALTER TABLE camera_subscriptions ADD COLUMN suspend_reason TEXT');
            console.log('Kolom camera_subscriptions.suspend_reason ditambahkan');
        }
    }
} catch (error) {
    console.error('Migrasi suspend_reason gagal:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
