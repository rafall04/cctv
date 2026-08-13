/**
 * Purpose: Start/stop the per-camera vehicle-counting process when an admin flips it on or off.
 * Caller: controllers/vehicleCountAdminController.js.
 * Deps: node:child_process (execFile).
 * MainFuncs: nyalakan, matikan.
 * SideEffects: runs `systemctl` on the host for the yolo-counter@<id> template unit.
 *
 * SECURITY: setiap panggilan systemctl memakai execFile dengan ARRAY argv — tidak pernah string
 * shell — dan satu-satunya nilai yang masuk adalah camera id yang sudah dipastikan bilangan
 * bulat positif. Kombinasi itulah yang menjaga sebuah form admin tidak berubah menjadi
 * eksekusi perintah. Pola dan alasannya sama persis dengan rondaDetectorService.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const jalankan = promisify(execFile);

/** Aktifkan lewat env: server yang tidak memakai systemd cukup membiarkannya kosong. */
function unitUntuk(cameraId) {
    const pola = process.env.VEHICLE_COUNT_UNIT || '';
    const id = Number(cameraId);
    if (!pola || !Number.isInteger(id) || id <= 0) return '';
    return pola.replace('%i', String(id));
}

async function systemctl(args) {
    try {
        await jalankan('systemctl', args, { timeout: 30000 });
        return true;
    } catch (error) {
        // Kegagalan menyalakan TIDAK boleh menggagalkan penyimpanan setelan: setelannya sudah
        // sah dan tersimpan, yang gagal hanya menjalankannya. Admin melihat status "aktif,
        // belum jalan" di daftar — jauh lebih jujur daripada menolak simpan dan kehilangan
        // garis yang baru saja digambar.
        console.error('systemctl gagal:', args.join(' '), (error.stderr || error.message || '').split('\n')[0]);
        return false;
    }
}

/**
 * `start`, BUKAN `restart` — dan ini bukan detail sepele.
 *
 * systemd `restart` juga membunuh proses yang sedang sehat, jadi setiap kali admin menyimpan
 * setelan, penghitung akan dimulai ulang dan stream beranotasi mati beberapa detik: penonton
 * di halaman publik melihat kotak dan garisnya lenyap. Terbukti saat verifikasi 2026-08-13,
 * PID berubah setiap penyimpanan.
 *
 * `start` bersifat idempoten: proses yang sudah jalan dibiarkan, dan perubahan setelan diambil
 * sendiri oleh penghitung yang memantau berkas config-nya. Yang dinyalakan hanya yang memang
 * sedang mati. Proses yang MENGGANTUNG bukan urusan sini — itu tugas timer pengawas.
 */
export async function nyalakan(cameraId) {
    const unit = unitUntuk(cameraId);
    if (!unit) return false;
    return systemctl(['start', unit]);
}

export async function matikan(cameraId) {
    const unit = unitUntuk(cameraId);
    if (!unit) return false;
    return systemctl(['stop', unit]);
}

export default { nyalakan, matikan };
