/**
 * Purpose: Read/write per-camera vehicle-counting configuration (counting lines, model, thresholds).
 * Caller: controllers/vehicleCountAdminController.js, services/vehicleCountService.js.
 * Deps: fs, path, config, database/connectionPool (camera lookup).
 * MainFuncs: daftarConfig, bacaConfig, simpanConfig, hapusConfig, kameraAktif.
 * SideEffects: writes JSON config files that the counter processes read; never runs anything.
 *
 * Bentuknya meniru rondaConfigService yang sudah terbukti: satu berkas JSON per kamera, dibaca
 * oleh proses penghitung. Alasannya praktis — proses penghitung ditulis dengan Python dan tidak
 * perlu tahu apa-apa soal SQLite atau autentikasi untuk sekadar membaca setelannya.
 *
 * Koordinat garis disimpan sebagai PROPORSI 0-1 terhadap lebar/tinggi frame, bukan piksel.
 * Dengan begitu setelan yang digambar admin tetap benar walau sumbernya berganti resolusi,
 * dan editor di panel bisa menggambar di ukuran tampilan berapa pun.
 */

import fs from 'fs';
import path from 'path';

import config from '../config/config.js';
import { queryOne } from '../database/connectionPool.js';

const JENIS = ['motor', 'mobil', 'truk', 'bus'];

/** Batas yang sengaja ketat: nilai dari form admin tidak boleh membuat proses penghitung mustahil. */
const BATAS = {
    imgsz: [256, 960],
    conf: [0.02, 0.9],
    conf_gambar: [0.05, 0.95],
    fps: [1, 15],
    min_gerak: [5, 400],
    min_umur: [1, 30],
};

function direktori() {
    return (config.vehicleCount || {}).configDir || '';
}

function berkasUntuk(cameraId) {
    return path.join(direktori(), `cam${Number(cameraId)}.json`);
}

function gagal(pesan, statusCode) {
    const err = new Error(pesan);
    err.statusCode = statusCode;
    return err;
}

function angka(nilai, [min, maks], bawaan) {
    const n = Number(nilai);
    if (!Number.isFinite(n)) return bawaan;
    return Math.min(maks, Math.max(min, n));
}

/** Titik harus proporsi 0-1; apa pun di luar itu ditolak, bukan dijepit diam-diam. */
function titik(nilai) {
    if (!Array.isArray(nilai) || nilai.length !== 2) return null;
    const [x, y] = nilai.map(Number);
    if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
    return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
}

function bersihkanGaris(daftar) {
    if (!Array.isArray(daftar)) return [];
    const hasil = [];
    for (const g of daftar.slice(0, 6)) {          // 6 garis sudah lebih dari cukup satu simpang
        const a = titik(g?.a);
        const b = titik(g?.b);
        if (!a || !b) continue;
        // Ruas yang terlalu pendek tidak akan pernah dilintasi dengan andal; menyimpannya
        // hanya melahirkan garis yang "ada tapi tidak pernah menghitung".
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) continue;
        hasil.push({ a, b, nama: String(g?.nama || `Garis ${hasil.length + 1}`).slice(0, 24) });
    }
    return hasil;
}

export function bentukBawaan(cameraId, nama = '') {
    return {
        camera_id: Number(cameraId),
        aktif: false,
        label: String(nama || '').slice(0, 120),
        garis: [],
        // Arah arus dipakai untuk memutuskan sebuah perlintasan masuk arah "+" atau "-".
        arah_arus: [1, 0],
        nama_arah: { plus: 'Arah A', minus: 'Arah B' },
        model: 'yolo11m.pt',
        imgsz: 448,
        conf: 0.1,
        conf_gambar: 0.35,
        fps: 8,
        min_gerak: 45,
        min_umur: 3,
        diperbarui: null,
    };
}

function bersihkan(masuk, cameraId, nama) {
    const dasar = bentukBawaan(cameraId, nama);
    const arah = Array.isArray(masuk?.arah_arus) && masuk.arah_arus.length === 2
        ? masuk.arah_arus.map(Number).filter((n) => Number.isFinite(n))
        : null;
    const panjang = arah ? Math.hypot(arah[0], arah[1]) : 0;
    return {
        ...dasar,
        aktif: Boolean(masuk?.aktif),
        label: String(masuk?.label ?? dasar.label).slice(0, 120),
        garis: bersihkanGaris(masuk?.garis),
        // dinormalkan supaya hasil kali titiknya benar-benar menandakan arah, bukan besaran
        arah_arus: panjang > 0 ? [arah[0] / panjang, arah[1] / panjang] : dasar.arah_arus,
        nama_arah: {
            plus: String(masuk?.nama_arah?.plus ?? dasar.nama_arah.plus).slice(0, 40),
            minus: String(masuk?.nama_arah?.minus ?? dasar.nama_arah.minus).slice(0, 40),
        },
        // Nama berkas model dibatasi keras: nilai ini ikut menjadi argumen proses, jadi
        // tidak boleh mengandung path atau apa pun yang bisa keluar dari direktorinya.
        model: /^[A-Za-z0-9._-]{3,60}\.pt$/.test(String(masuk?.model || ''))
            ? String(masuk.model)
            : dasar.model,
        imgsz: Math.round(angka(masuk?.imgsz, BATAS.imgsz, dasar.imgsz) / 32) * 32,
        conf: angka(masuk?.conf, BATAS.conf, dasar.conf),
        conf_gambar: angka(masuk?.conf_gambar, BATAS.conf_gambar, dasar.conf_gambar),
        fps: Math.round(angka(masuk?.fps, BATAS.fps, dasar.fps)),
        min_gerak: Math.round(angka(masuk?.min_gerak, BATAS.min_gerak, dasar.min_gerak)),
        min_umur: Math.round(angka(masuk?.min_umur, BATAS.min_umur, dasar.min_umur)),
        diperbarui: new Date().toISOString(),
    };
}

function kamera(cameraId) {
    const row = queryOne(
        `SELECT id, name, camera_class, enabled FROM cameras WHERE id = ?`,
        [Number(cameraId)]
    );
    if (!row) throw gagal('Kamera tidak ditemukan', 404);
    return row;
}

export function bacaConfig(cameraId) {
    const dir = direktori();
    if (!dir) return null;
    try {
        return JSON.parse(fs.readFileSync(berkasUntuk(cameraId), 'utf8'));
    } catch {
        return null;
    }
}

export function daftarConfig() {
    const dir = direktori();
    if (!dir) return [];
    let berkas = [];
    try {
        berkas = fs.readdirSync(dir).filter((f) => /^cam\d+\.json$/.test(f));
    } catch {
        return [];
    }
    return berkas
        .map((f) => {
            try {
                return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.camera_id) - Number(b.camera_id));
}

export function simpanConfig(cameraId, masuk) {
    const dir = direktori();
    if (!dir) throw gagal('Penghitungan kendaraan belum disiapkan di server ini', 503);
    const cam = kamera(cameraId);
    const isi = bersihkan(masuk, cam.id, masuk?.label || cam.name);

    // Menyalakan tanpa garis hanya akan menghasilkan penghitung yang berjalan tanpa pernah
    // menghitung apa pun - ditolak di sini supaya kekeliruannya terlihat saat menyimpan.
    if (isi.aktif && isi.garis.length === 0) {
        throw gagal('Gambar dulu minimal satu garis hitung sebelum menyalakan', 400);
    }

    fs.mkdirSync(dir, { recursive: true });
    const tujuan = berkasUntuk(cam.id);
    const sementara = `${tujuan}.tmp`;
    fs.writeFileSync(sementara, JSON.stringify(isi, null, 2));
    // rename atomik: proses penghitung memantau berkas ini dan tidak boleh pernah
    // membaca JSON yang tertulis separuh
    fs.renameSync(sementara, tujuan);
    return isi;
}

export function hapusConfig(cameraId) {
    try {
        fs.unlinkSync(berkasUntuk(cameraId));
        return true;
    } catch {
        return false;
    }
}

/** Kamera ini sedang dihitung? Dipakai read-model publik untuk memutuskan panel muncul atau tidak. */
export function kameraAktif(cameraId) {
    const c = bacaConfig(cameraId);
    return Boolean(c && c.aktif && Array.isArray(c.garis) && c.garis.length > 0);
}

export const JENIS_KENDARAAN = JENIS;

export default {
    bacaConfig, daftarConfig, simpanConfig, hapusConfig, kameraAktif, bentukBawaan,
};
