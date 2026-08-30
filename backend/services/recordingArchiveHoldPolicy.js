// Purpose: Jawab "bolehkah segmen KADALUARSA ini dihapus, atau masih menunggu diarsipkan ke Telegram?"
// Caller: recordingExpiredDbSegmentCleanup (jalur retensi normal — BUKAN pembersihan darurat disk).
// Deps: connectionPool.query terhadap telegram_archive_uploads (ditulis sidecar, dibaca di sini).
// MainFuncs: createArchiveHoldPolicy.
// SideEffects: Hanya membaca. Tidak pernah menghapus.
//
// KENAPA MODUL INI ADA
// --------------------
// Retensi disk per kamera ~5 jam, tapi MAX_LATE_HOURS uploader 12 jam. Selama outage jaringan di
// antara keduanya, pemangkas retensi dulu MENGHAPUS segmen yang belum sempat terunggah — permanen,
// senyap. Toleransi 12 jam uploader jadi semu karena berkasnya sudah lenyap di 5 jam. Diminta
// diperbaiki 2026-08-28: "agar tidak ada rekaman yang hilang".
//
// SINYAL YANG DIPAKAI, DAN KENAPA TEPAT
// Uploader MENAHAN POSISI saat outage (5xx/timeout) dan TIDAK menulis baris terminal apa pun ke
// telegram_archive_uploads — perilaku yang sudah ada sejak perbaikan watermark 2026-08-16. Jadi:
//   · segmen TANPA baris arsip = uploader belum sampai pada keputusan = MASIH menunggu → TAHAN;
//   · segmen DENGAN baris apa pun (ok / no_route / before_cutoff / stale_salvage) = uploader sudah
//     memutuskan → aman dihapus di retensi.
// Ditambah dua batas supaya penahanan tidak pernah bisa memenuhi disk:
//   · hanya untuk kamera yang BENAR-BENAR sedang mengarsip (punya baris status='ok' baru) —
//     kamera no_route selamanya (mis. 1443) tidak pernah ditahan;
//   · hanya dalam jendela penahanan (default 12 jam, selaras MAX_LATE_HOURS) — di luar itu uploader
//     sendiri pun sudah menyerah, jadi dilepas.
// Backstop terakhir tetap pembersihan darurat disk (jalur TERPISAH, retention-bypass): kalau disk
// kritis, segmen tertua dihapus apa pun status arsipnya. Menahan tidak pernah mengalahkan disk.

import { query as defaultQuery } from '../database/connectionPool.js';

/** Format UTC 'YYYY-MM-DD HH:MM:SS' — sama persis dengan datetime('now') yang menulis uploaded_at. */
export function toSqliteUtc(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// Baca DB di sini BERPACU dengan sidecar yang menulis tabel yang sama. "Tabel tak ada" (instalasi
// tanpa fitur arsip) = tak ada yang diarsip → retensi normal boleh jalan. TAPI error TRANSIEN
// (SQLITE_BUSY / 'database is locked' / IO saat sidecar menulis) BUKAN itu, dan WAJIB gagal ke arah
// MENAHAN — jangan pernah menghapus footage yang tak bisa kita buktikan sudah terarsip.
function isMissingTable(err) {
    return /no such table/i.test(err?.message || '');
}

// Verdict TERMINAL yang benar-benar berarti "aman, salinan lokal tak lagi diperlukan": 'ok' (terunggah,
// punya file_id yang dipakai read-back), 'no_route' (kamera tak punya tujuan Telegram), 'before_cutoff'
// (sebelum fitur arsip), 'stale_salvage' (sudah direkonsiliasi). 'failed'/'too_big'/'missing' berarti
// kita SUDAH mencoba dan segmen TIDAK ada di Telegram — menghapus atas dasar itu adalah bug kehilangan
// permanen yang justru modul ini cegah, jadi status itu TIDAK dihitung sebagai verdict aman di sini.
const SAFE_VERDICT_CLAUSE =
    "((status = 'ok' AND file_id IS NOT NULL) OR status IN ('no_route', 'before_cutoff', 'stale_salvage'))";

export function createArchiveHoldPolicy({ query = defaultQuery } = {}) {
    return {
        /**
         * Apakah kamera ini SEDANG berhasil mengarsip (ada unggahan 'ok' sejak sinceUtc)?
         * Kalau tidak, segmennya tidak ditahan — entah arsipnya mati, entah kamera ini memang
         * tak punya tujuan (no_route), keduanya berarti menahan hanya membuang ruang disk.
         */
        cameraArchivingActive(cameraId, sinceUtc) {
            try {
                const rows = query(
                    "SELECT 1 FROM telegram_archive_uploads WHERE camera_id = ? AND status = 'ok' AND uploaded_at >= ? LIMIT 1",
                    [cameraId, sinceUtc],
                );
                return rows.length > 0;
            } catch (err) {
                // Tabel belum ada = tak ada arsip = jangan tahan. Error transien = fail-CLOSED: tahan
                // satu siklus, jangan berhenti mengarsip lalu menghapus hanya karena baca gagal sesaat.
                return isMissingTable(err) ? false : true;
            }
        },

        /**
         * Apakah uploader SUDAH mencapai keputusan untuk segmen ini (baris apa pun sudah ada)?
         * Ada baris = aman dihapus. Tidak ada baris = masih menunggu = tahan (dalam jendela).
         */
        hasArchiveVerdict(segmentId) {
            try {
                const rows = query(
                    `SELECT 1 FROM telegram_archive_uploads WHERE segment_id = ? AND ${SAFE_VERDICT_CLAUSE} LIMIT 1`,
                    [segmentId],
                );
                return rows.length > 0;
            } catch (err) {
                // Tabel belum ada = tak ada arsip = aman dihapus normal. Error transien = fail-CLOSED:
                // anggap BELUM ada verdict aman → tahan (jangan hapus footage yang mungkin belum terarsip).
                return isMissingTable(err) ? true : false;
            }
        },
    };
}

export default { createArchiveHoldPolicy, toSqliteUtc };
