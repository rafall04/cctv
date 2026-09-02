/*
Purpose: Pin TZ penagihan terpisah dari TZ tampilan — seed 'billing_timezone' = 'timezone' saat ini.
Caller: run-all-migrations (urutan nama berkas).
Deps: better-sqlite3 terhadap backend/data/cctv.db.
SideEffects: INSERT 1 baris system_settings bila belum ada. Idempoten. Tak menimpa nilai yang ada.

KENAPA PIN INI ADA
------------------
Label hari penagihan berasal dari localDateString → getBillingTimezone(). Dulu ia membaca TZ TAMPILAN
(setting 'timezone') yang bisa diubah admin (WIB↔WITA↔WIT). Mengganti TZ dekat tengah malam menggeser
batas "hari ini" (mis. 22:30 WIB → 00:30 WIT tanggal berikutnya): langganan yang SUDAH ditagih untuk
label lama tampak jatuh tempo lagi untuk label baru → tertagih dua kali dalam hitungan menit.

Seed 'billing_timezone' = nilai 'timezone' SAAT INI supaya hari penagihan yang sudah tercatat
(last_charged_date) tetap konsisten, lalu getBillingTimezone berhenti mengikuti toggle tampilan.
Tanpa menimpa: kalau billing_timezone sudah pernah di-set (mis. re-run), biarkan.
*/

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolveDbPath());

function adaTabel(nama) {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(nama));
}

try {
    if (!adaTabel('system_settings')) {
        console.log('Tabel system_settings belum ada - tidak ada yang diubah');
    } else {
        const sudah = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key='billing_timezone'").get();
        if (sudah) {
            console.log(`billing_timezone sudah di-set (${sudah.setting_value}) - dibiarkan`);
        } else {
            const tz = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key='timezone'").get();
            const nilai = tz?.setting_value || 'Asia/Jakarta';
            db.prepare(
                "INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES ('billing_timezone', ?, CURRENT_TIMESTAMP)"
            ).run(nilai);
            console.log(`billing_timezone di-seed = ${nilai} (dari TZ tampilan saat ini)`);
        }
    }
} catch (error) {
    console.error('Migrasi billing_timezone gagal:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
