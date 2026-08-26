/*
 * Purpose: Sajikan keadaan jam tiap kamera ke panel admin, dan ringkasnya untuk lencana navigasi.
 * Caller: cameraTimeRoutes (admin).
 * Deps: connectionPool.
 * MainFuncs: getCameraTimeStatus, getCameraTimeSummary.
 * SideEffects: Tidak ada — murni baca.
 *
 * KENAPA HANYA MEMBACA
 * --------------------
 * Penyelaras waktunya sendiri hidup di deployment/camera-time/ dan dijalankan systemd timer.
 * Logika itu harus berbicara ONVIF WS-Security, ISAPI Hikvision dengan HTTP digest, dan jalur
 * dorongan waktu untuk firmware tanpa klien NTP — semuanya sudah terbukti di empat merek di
 * lapangan. Menulis ulangnya ke Node hanya untuk "kerapian" berarti menukar sesuatu yang bekerja
 * dengan sesuatu yang belum pernah bertemu satu pun kamera sungguhan.
 *
 * Jadi pembagiannya jelas: timer yang MENYELARASKAN dan menulis hasilnya ke camera_time_status;
 * berkas ini yang MEMBACAKANNYA. Panel admin tidak pernah memicu perangkat keras, jadi tidak ada
 * jalan bagi satu klik untuk membanjiri 14 kamera dengan panggilan ONVIF.
 *
 * KENAPA STATUS BASI DILAPORKAN SEBAGAI BASI
 * ------------------------------------------
 * Kalau timer-nya mati — tidak terpasang, di-disable, atau gagal — tabel ini berhenti diperbarui
 * sementara isinya tetap terlihat hijau. Itu persis bentuk kebohongan yang seluruh fitur ini
 * dibuat untuk mengakhiri. Karena itu setiap baris membawa umur pemeriksaannya, dan apa pun yang
 * lebih tua dari STALE_AFTER_MINUTES dilaporkan sebagai tidak diketahui, bukan sebagai sehat.
 */

import { execute, query, queryOne } from '../database/connectionPool.js';

// Timer berjalan tiap jam; tiga jam berarti dua siklus terlewat — itu kegagalan, bukan jitter.
const STALE_AFTER_MINUTES = 180;

function umurMenit(checkedAt) {
    if (!checkedAt) return null;
    // Penyelaras menulis waktu UTC tanpa akhiran zona (isoformat), jadi 'Z' ditambahkan di sini
    // supaya Date tidak menafsirkannya sebagai waktu lokal dan menghasilkan umur negatif.
    const stamp = Date.parse(`${checkedAt.replace(' ', 'T')}Z`);
    if (Number.isNaN(stamp)) return null;
    return Math.round((Date.now() - stamp) / 60000);
}

class CameraTimeStatusService {
    /**
     * Satu baris per kamera internal, digabung dengan namanya.
     *
     * Kamera yang BELUM pernah diperiksa tetap muncul dengan status kosong — kalau tidak,
     * kamera yang tak pernah tersentuh penyelaras akan tak terlihat, dan tak terlihat itu
     * persis yang membuat lima kamera berhenti di tahun 1970 tanpa ada yang tahu.
     */
    getCameraTimeStatus() {
        const rows = query(`
            SELECT
                c.id,
                c.name,
                c.onvif_username IS NOT NULL AND c.onvif_username != '' AS has_onvif_credentials,
                s.checked_at,
                s.reachable,
                s.mode,
                s.drift_seconds,
                s.method,
                s.healthy,
                s.note
            FROM cameras c
            LEFT JOIN camera_time_status s ON s.camera_id = c.id
            WHERE c.enabled = 1
              AND c.private_rtsp_url LIKE 'rtsp://%@%'
            ORDER BY c.id
        `);

        return rows.map((row) => {
            const ageMinutes = umurMenit(row.checked_at);
            const stale = ageMinutes === null || ageMinutes > STALE_AFTER_MINUTES;
            return {
                id: row.id,
                name: row.name,
                hasOnvifCredentials: Boolean(row.has_onvif_credentials),
                checkedAt: row.checked_at || null,
                ageMinutes,
                stale,
                reachable: Boolean(row.reachable),
                mode: row.mode || null,
                driftSeconds: row.drift_seconds === null ? null : row.drift_seconds,
                method: row.method || null,
                // Sehat hanya bila BENAR-BENAR sehat DAN kabarnya masih baru. Status basi
                // bukan kabar baik, ia ketiadaan kabar.
                healthy: Boolean(row.healthy) && !stale,
                note: row.note || null,
            };
        });
    }

    /** Ringkasan untuk lencana: berapa yang sehat, bermasalah, dan belum/basi diperiksa. */
    getCameraTimeSummary() {
        const rows = this.getCameraTimeStatus();
        const summary = {
            total: rows.length,
            healthy: rows.filter((r) => r.healthy).length,
            unreachable: rows.filter((r) => !r.stale && !r.reachable).length,
            stale: rows.filter((r) => r.stale).length,
        };
        summary.problems = summary.total - summary.healthy;

        const terbaru = queryOne('SELECT MAX(checked_at) AS last FROM camera_time_status');
        summary.lastCheckedAt = terbaru?.last || null;
        summary.lastCheckAgeMinutes = umurMenit(terbaru?.last);
        // Penyelaras belum pernah jalan sama sekali: bedakan dari "jalan tapi menemukan masalah".
        summary.syncerEverRan = Boolean(terbaru?.last);
        return summary;
    }

    /**
     * Simpan (atau kosongkan) kredensial ONVIF khusus satu kamera.
     *
     * Kosong berarti "kembali ke default: pakai kredensial RTSP" — BUKAN "pakai nama pengguna
     * kosong". Karena itu string kosong dipetakan ke NULL; menyimpan '' akan membuat
     * penyelaras mencoba autentikasi dengan string kosong dan gagal selamanya, dengan
     * penyebab yang mustahil terlihat dari panel.
     *
     * Sandi tidak pernah dibaca kembali ke panel — hanya penandanya. Jadi mengosongkan kolom
     * harus benar-benar berarti mengosongkan, bukan efek samping dari form yang mengirim
     * ulang nilai yang tidak pernah ia terima.
     */
    setOnvifCredentials(cameraId, { username, password }) {
        const kamera = queryOne('SELECT id FROM cameras WHERE id = ?', [cameraId]);
        if (!kamera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }
        const bersih = (v) => {
            if (v === undefined || v === null) return null;
            const t = String(v).trim();
            return t === '' ? null : t;
        };
        execute(
            'UPDATE cameras SET onvif_username = ?, onvif_password = ? WHERE id = ?',
            [bersih(username), bersih(password), cameraId],
        );
        return { id: cameraId, hasOnvifCredentials: Boolean(bersih(username)) };
    }
}

export default new CameraTimeStatusService();
export { STALE_AFTER_MINUTES };
