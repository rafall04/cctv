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

export async function nyalakan(cameraId) {
    const unit = unitUntuk(cameraId);
    if (!unit) return false;
    return systemctl(['restart', unit]);
}

export async function matikan(cameraId) {
    const unit = unitUntuk(cameraId);
    if (!unit) return false;
    return systemctl(['stop', unit]);
}

export default { nyalakan, matikan };
