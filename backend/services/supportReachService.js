/**
 * Purpose: Angka jangkauan yang boleh ditunjukkan ke calon pendukung — dan HANYA angka.
 * Caller: controllers/supportReachController.js.
 * Deps: database/connectionPool.
 * MainFuncs: getPublicReach.
 * SideEffects: Tiga SELECT agregat. Tidak menulis apa pun.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Halaman /dukungan menjual satu hal: berapa banyak orang yang benar-benar melihat permukaan ini.
 * Angka semacam itu SELALU basi kalau ditulis di dalam halaman - "605 pengunjung sebulan" yang
 * benar hari ini akan berbohong tiga bulan lagi, dan tidak ada yang akan menyadarinya karena tidak
 * ada yang memeriksa teks statis. Aturan kejujuran permukaan publik di docs/frontend-guide.md ada
 * persis untuk bentuk ini. Jadi halaman itu tidak menyimpan satu angka pun; ia menanyakannya.
 *
 * YANG SENGAJA TIDAK DIKELUARKAN
 * ------------------------------
 * Rasio klik afiliasi (CTR) TIDAK ada di sini walaupun ia angka penjualan terkuat yang dimiliki.
 * Itu angka NEGOSIASI: ia masuk ke proposal yang dikirim ke satu distributor, bukan ke halaman
 * yang bisa dibaca pesaingnya dan calon pemasang iklan berikutnya sekaligus. Menerbitkannya
 * menghapus satu-satunya keunggulan tawar yang ada.
 *
 * Tidak ada nama kamera, tidak ada nama area, tidak ada alamat IP, tidak ada apa pun per-orang.
 * Yang keluar hanya tiga bilangan bulat.
 */

import { queryOne } from '../database/connectionPool.js';

/** Jendela yang dilaporkan. 30 hari: cukup panjang untuk stabil, cukup pendek untuk relevan. */
export const REACH_WINDOW_DAYS = 30;

/*
 * Sesi dihitung HANYA untuk kamera community.
 *
 * viewer_session_history memuat baris untuk kamera privat dan langganan juga - itu tontonan
 * pemiliknya sendiri atas kamera rumahnya. Memasukkannya ke angka publik akan menjual jangkauan
 * yang tidak pernah dimiliki permukaan publik, dan itu bentuk kebohongan yang paling mudah
 * dilakukan tanpa sengaja: kueri yang benar secara teknis atas populasi yang salah.
 */
const SESSIONS_SQL = `
    SELECT COUNT(*) AS n
    FROM viewer_session_history v
    JOIN cameras c ON c.id = v.camera_id
    WHERE c.camera_class = 'community'
      AND v.started_at >= datetime('now', ?)
`;

const CAMERAS_SQL = `
    SELECT COUNT(*) AS n FROM cameras
    WHERE camera_class = 'community' AND enabled = 1
`;

/* Area yang benar-benar punya kamera community terbit - bukan setiap baris di tabel areas. */
const AREAS_SQL = `
    SELECT COUNT(DISTINCT c.area_id) AS n FROM cameras c
    WHERE c.camera_class = 'community' AND c.enabled = 1 AND c.area_id IS NOT NULL
`;

function hitung(sql, params = []) {
    const row = queryOne(sql, params);
    return Number(row?.n || 0);
}

/**
 * Tiga bilangan bulat, tidak lebih.
 *
 * @returns {{window_days: number, sessions: number, cameras: number, areas: number}}
 */
export function getPublicReach() {
    return {
        window_days: REACH_WINDOW_DAYS,
        sessions: hitung(SESSIONS_SQL, [`-${REACH_WINDOW_DAYS} day`]),
        cameras: hitung(CAMERAS_SQL),
        areas: hitung(AREAS_SQL),
    };
}

export default { getPublicReach, REACH_WINDOW_DAYS };
