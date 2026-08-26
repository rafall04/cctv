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

/*
 * CAKUPAN: kamera mana yang urusan penyelaras waktu.
 *
 * Hanya rentang privat RFC1918 — yang benar-benar ada di jaringan kita, bisa dijangkau, dan
 * boleh dikonfigurasi. Percobaan pertama saya memakai `LIKE 'rtsp://%@%'` dan halamannya
 * menampilkan 409 kamera padahal penyelaras hanya memeriksa 14: 394 feed pihak ketiga di IP
 * publik ikut terbawa, semuanya "belum diketahui", dan panelnya berteriak "396 perlu",
 * "perhatian" — 96% derau yang tidak bisa ditindak siapa pun.
 *
 * BUKAN dihardcode ke 192.168: pemasangan pelanggan bisa memakai 10.x atau 172.16-31.x.
 *
 * ⚠️ Definisi yang SAMA ada di deployment/camera-time/set_camera_ntp.py (SCOPE_SQL), karena
 * halaman ini HARUS menampilkan persis kamera yang diperiksa penyelaras. Kalau keduanya
 * berpisah, panelnya berbohong lagi — dan itu dijaga tes di __tests__/guardrails.test.js.
 */
const SCOPE_SQL = "enabled = 1 AND ("
    + "private_rtsp_url LIKE 'rtsp://%@10.%' OR "
    + "private_rtsp_url LIKE 'rtsp://%@192.168.%' OR "
    + "private_rtsp_url GLOB 'rtsp://*@172.1[6-9].*' OR "
    + "private_rtsp_url GLOB 'rtsp://*@172.2[0-9].*' OR "
    + "private_rtsp_url GLOB 'rtsp://*@172.3[01].*')";

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
        // Tanpa alias untuk `cameras`, supaya SCOPE_SQL bisa disisipkan APA ADANYA dan tetap
        // byte-identik dengan versi Python. Predikat yang harus dicocokkan dua bahasa tidak
        // boleh butuh transformasi di salah satu sisi — di situlah keduanya mulai berpisah.
        const rows = query(`
            SELECT
                cameras.id,
                cameras.name,
                cameras.onvif_username IS NOT NULL AND cameras.onvif_username != '' AS has_onvif_credentials,
                s.checked_at,
                s.reachable,
                s.mode,
                s.drift_seconds,
                s.method,
                s.healthy,
                s.note
            FROM cameras
            LEFT JOIN camera_time_status s ON s.camera_id = cameras.id
            WHERE ${SCOPE_SQL}
            ORDER BY cameras.id
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
