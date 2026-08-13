/**
 * Purpose: Expose automatic vehicle-count telemetry for one showcase camera as a sanitized public read model.
 * Caller: backend/controllers/vehicleCountController.js.
 * Deps: fs, config, database/connectionPool (community gate).
 * MainFuncs: getPublicVehicleCount, isVehicleCountCamera.
 * SideEffects: Reads the counter's JSON state file; never writes.
 */

import fs from 'fs';

import config from '../config/config.js';
import { queryOne } from '../database/connectionPool.js';

const JENIS = ['motor', 'mobil', 'truk', 'bus'];

/** Menit terakhir yang dikirim untuk grafik mini; cukup untuk melihat pola, bukan arsip. */
const MAX_MENIT = 30;

function toInt(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function ringkasJenis(source) {
    const out = {};
    for (const jenis of JENIS) out[jenis] = toInt(source?.[jenis]);
    return out;
}

/**
 * Apakah kamera ini yang dipasangi penghitung? Dipakai frontend agar panel hanya muncul
 * di kamera yang benar-benar punya data — bukan di semua kamera.
 */
export function isVehicleCountCamera(cameraId) {
    const configured = config.vehicleCount.cameraId;
    return Boolean(configured) && Number(cameraId) === configured;
}

function requireCommunityCamera(cameraId) {
    // Invarian proyek: permukaan publik hanya untuk camera_class='community'.
    // Penghitung boleh saja diarahkan ke kamera mana pun; endpoint publik tetap menolak
    // apa pun yang bukan komunitas.
    const camera = queryOne(
        `SELECT id, name, location FROM cameras
          WHERE id = ? AND camera_class = 'community' AND enabled = 1`,
        [cameraId]
    );
    if (!camera) {
        const err = new Error('Kamera tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }
    return camera;
}

function bacaBerkasStatistik(statsPath) {
    let raw;
    let mtimeMs;
    try {
        mtimeMs = fs.statSync(statsPath).mtimeMs;
        raw = fs.readFileSync(statsPath, 'utf8');
    } catch {
        // Penghitung belum pernah jalan, atau berkasnya terhapus.
        return null;
    }
    try {
        return { data: JSON.parse(raw), mtimeMs };
    } catch {
        // Tulisan setengah jalan. Penulisnya memakai rename atomik, jadi ini seharusnya
        // tidak terjadi — kalau terjadi, lebih baik diam daripada menyajikan angka rusak.
        return null;
    }
}

/**
 * Read model publik untuk panel "hitung kendaraan otomatis".
 *
 * Sengaja TIDAK meneruskan detail internal penghitung (nama model, imgsz, jalur berkas,
 * jumlah frame): itu jargon operasional yang tidak boleh bocor ke permukaan publik.
 * Yang dikirim hanya angka yang bisa dipertanggungjawabkan ke pengunjung.
 */
export function getPublicVehicleCount(cameraId) {
    const id = toInt(cameraId);
    if (!id) {
        const err = new Error('Kamera tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }

    const { statsPath, staleAfterMs } = config.vehicleCount;
    if (!statsPath || !isVehicleCountCamera(id)) {
        // Fitur mati untuk kamera ini. Bukan error — panel publik cukup tidak muncul.
        return { cameraId: id, tersedia: false };
    }

    const camera = requireCommunityCamera(id);
    const berkas = bacaBerkasStatistik(statsPath);
    if (!berkas) return { cameraId: id, tersedia: false };

    const { data, mtimeMs } = berkas;
    const umurMs = Math.max(0, Date.now() - mtimeMs);
    const arah = data?.arah && typeof data.arah === 'object' ? data.arah : {};

    return {
        cameraId: id,
        namaKamera: camera.name,
        tersedia: true,
        // Berhenti = penghitung tidak lagi memperbarui. Frontend WAJIB menandainya,
        // bukan menampilkan angka basi seolah masih berjalan.
        berhenti: umurMs > staleAfterMs,
        umurDetik: Math.round(umurMs / 1000),
        diperbaruiPada: new Date(mtimeMs).toISOString(),
        mulaiTeks: typeof data?.mulai === 'string' ? data.mulai : '',
        total: toInt(data?.total),
        perJenis: ringkasJenis(data?.total_jenis),
        // Total sesi bisa berumur belasan jam, jadi pengunjung tidak punya cara memeriksanya.
        // Angka 10 menit terakhir bisa dicocokkan sendiri sambil menonton videonya — itulah
        // yang membuat panel ini dapat dipercaya, bukan sekadar dipamerkan.
        total10m: toInt(data?.total_10_menit),
        perJenis10m: ringkasJenis(data?.per_jenis_10_menit),
        perArah: Object.entries(arah)
            .map(([label, nilai]) => ({
                label,
                perJenis: ringkasJenis(nilai),
                total: JENIS.reduce((sum, jenis) => sum + toInt(nilai?.[jenis]), 0),
            }))
            .sort((a, b) => b.total - a.total),
        perMenit: Array.isArray(data?.per_menit)
            ? data.per_menit.slice(-MAX_MENIT).map((baris) => ({
                menit: String(baris?.menit || ''),
                total: toInt(baris?.ke_barat) + toInt(baris?.ke_timur),
            }))
            : [],
    };
}

export default { getPublicVehicleCount, isVehicleCountCamera };
