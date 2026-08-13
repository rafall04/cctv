/**
 * Purpose: Expose automatic vehicle-count telemetry for one showcase camera as a sanitized public read model.
 * Caller: backend/controllers/vehicleCountController.js.
 * Deps: fs, config, database/connectionPool (community gate).
 * MainFuncs: getPublicVehicleCount, isVehicleCountCamera.
 * SideEffects: Reads the counter's JSON state file; never writes.
 */

import fs from 'fs';
import path from 'path';

import config from '../config/config.js';
import { queryOne } from '../database/connectionPool.js';
import { kameraAktif } from './vehicleCountConfigService.js';

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
/**
 * Kamera ini sedang dihitung?
 *
 * Sumbernya berkas config per kamera, bukan satu id yang dipatok di env — itulah yang membuat
 * penghitungan bisa dinyalakan dari panel admin di kamera mana pun. Nilai env lama masih
 * dihormati agar pemasangan yang belum dipindahkan tidak mendadak kehilangan panelnya.
 */
export function isVehicleCountCamera(cameraId) {
    const vc = config.vehicleCount || {};
    if (vc.configDir) return kameraAktif(cameraId);
    return Boolean(vc.cameraId) && Number(cameraId) === vc.cameraId;
}

/** Jalur berkas statistik milik kamera ini (per kamera bila stateDir dipakai). */
function jalurStatistik(cameraId) {
    const vc = config.vehicleCount || {};
    if (vc.stateDir) return path.join(vc.stateDir, `cam${Number(cameraId)}.json`);
    return vc.statsPath || '';
}

/** Direktori HLS beranotasi milik kamera ini. */
function dirHls(cameraId) {
    const vc = config.vehicleCount || {};
    if (!vc.hlsDir) return '';
    return vc.stateDir ? path.join(vc.hlsDir, String(Number(cameraId))) : vc.hlsDir;
}

/** Jalur publik playlist beranotasi milik kamera ini. */
function jalurHls(cameraId) {
    const vc = config.vehicleCount || {};
    if (!vc.hlsPath) return '';
    return vc.stateDir
        ? `${vc.hlsPath.replace(/\/live\.m3u8$/, '')}/${Number(cameraId)}/live.m3u8`
        : vc.hlsPath;
}

/**
 * Jalur HLS BERANOTASI (kotak, label, garis hitung) untuk kamera pameran — atau null.
 *
 * Dipakai read-model stream supaya pengunjung menonton GAMBAR YANG SAMA dengan yang
 * dihitung, bukan dua umpan yang berselisih beberapa detik.
 *
 * Null dikembalikan begitu playlist berhenti diperbarui, dan itu disengaja: angka basi masih
 * berguna kalau ditandai "berhenti", tapi playlist basi berarti pemutar video MATI di halaman
 * publik. Jadi ambangnya jauh lebih ketat, dan pemanggilnya kembali ke umpan kamera asli.
 */
export function getAnnotatedStreamPath(cameraId) {
    // Sengaja bertahan terhadap config yang tidak lengkap: fungsi ini dipanggil dari jalur
    // stream PUBLIK, jadi bagian config yang hilang harus berarti "fitur mati", bukan
    // melempar galat dan merobohkan pemutaran semua kamera.
    const { hlsStaleMs } = config.vehicleCount || {};
    const dir = dirHls(cameraId);
    const jalur = jalurHls(cameraId);
    if (!dir || !jalur || !isVehicleCountCamera(cameraId)) return null;
    try {
        const { mtimeMs } = fs.statSync(path.join(dir, 'live.m3u8'));
        if (Date.now() - mtimeMs > hlsStaleMs) return null;
        return jalur;
    } catch {
        return null;
    }
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

/**
 * Jam nyata dari TEPI SIARAN — segmen terbaru yang ada di playlist.
 *
 * Dipakai frontend untuk menghitung frame yang sedang ditonton berasal dari detik keberapa:
 * `ditonton = tepiSiaran − (buffered.end − currentTime)`. Tanpa ini panel hanya bisa
 * menampilkan angka "sekarang", yang selalu beberapa detik lebih maju daripada gambar yang
 * dilihat orang — sumber keluhan "data bawah tidak sinkron dengan live".
 *
 * Dibaca dari `#EXT-X-PROGRAM-DATE-TIME` + durasi segmen sesudahnya, jadi angkanya berasal
 * dari playlist yang sama yang diputar pemutar, bukan dari tebakan tetap.
 */
function bacaTepiSiaran(hlsDir) {
    try {
        const teks = fs.readFileSync(path.join(hlsDir, 'live.m3u8'), 'utf8');
        const baris = teks.split('\n');
        let mulai = null;
        let durasi = 0;
        for (const b of baris) {
            const pdt = b.match(/^#EXT-X-PROGRAM-DATE-TIME:(.+)$/);
            if (pdt) {
                mulai = Date.parse(pdt[1].trim());
                durasi = 0;
                continue;
            }
            const inf = b.match(/^#EXTINF:([\d.]+)/);
            if (inf && mulai !== null) durasi += parseFloat(inf[1]) || 0;
        }
        if (mulai === null || Number.isNaN(mulai)) return null;
        return new Date(mulai + durasi * 1000).toISOString();
    } catch {
        return null;
    }
}

/** Cuplikan riwayat pada atau tepat sebelum `pada`; null bila di luar jangkauan riwayat. */
function cuplikanPada(riwayat, pada) {
    if (!Array.isArray(riwayat) || !riwayat.length) return null;
    const target = Date.parse(pada);
    if (Number.isNaN(target)) return null;
    let hasil = null;
    for (const r of riwayat) {
        const t = Date.parse(r?.t);
        if (Number.isNaN(t) || t > target) continue;
        if (!hasil || t > Date.parse(hasil.t)) hasil = r;
    }
    return hasil;
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
export function getPublicVehicleCount(cameraId, { pada = '' } = {}) {
    const id = toInt(cameraId);
    if (!id) {
        const err = new Error('Kamera tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }

    const { staleAfterMs } = config.vehicleCount || {};
    const statsPath = jalurStatistik(id);
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

    // Angka pada DETIK YANG SEDANG DITONTON, bila penonton menyebutkannya. Yang bergeser
    // hanya total & rincian jenis; sisanya (per arah, per menit, kejadian) tetap terkini
    // karena bukan angka yang dicocokkan orang ke gambar.
    const cuplikan = pada ? cuplikanPada(data?.riwayat, pada) : null;

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
        // Jam tepi siaran: bahan hitung frontend untuk tahu frame yang tampil dari detik mana.
        tepiSiaran: bacaTepiSiaran(dirHls(id)),
        // true = angka di bawah ini sudah digeser ke detik yang ditonton, bukan detik ini
        selarasVideo: Boolean(cuplikan),
        total: toInt(cuplikan ? cuplikan.total : data?.total),
        perJenis: ringkasJenis(cuplikan ? cuplikan.jenis : data?.total_jenis),
        // Total sesi bisa berumur belasan jam, jadi pengunjung tidak punya cara memeriksanya.
        // Angka 10 menit terakhir bisa dicocokkan sendiri sambil menonton videonya — itulah
        // yang membuat panel ini dapat dipercaya, bukan sekadar dipamerkan.
        total10m: toInt(data?.total_10_menit),
        perJenis10m: ringkasJenis(data?.per_jenis_10_menit),
        // Baris arah ikut digeser ke detik yang sama. Kalau hanya kartu jenis yang digeser,
        // kartu berjumlah 102 sementara baris arah berjumlah 105 — dua angka benar yang
        // terbaca sebagai saling bertentangan.
        perArah: Object.entries(arah)
            .map(([label, nilai]) => ({
                label,
                perJenis: ringkasJenis(nilai),
                total: cuplikan && cuplikan.arah && label in cuplikan.arah
                    ? toInt(cuplikan.arah[label])
                    : JENIS.reduce((sum, jenis) => sum + toInt(nilai?.[jenis]), 0),
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

export default { getPublicVehicleCount, isVehicleCountCamera, getAnnotatedStreamPath };
