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
            } catch {
                // Tabel belum ada (instalasi tanpa arsip) = tidak ada yang diarsipkan = jangan tahan.
                return false;
            }
        },

        /**
         * Apakah uploader SUDAH mencapai keputusan untuk segmen ini (baris apa pun sudah ada)?
         * Ada baris = aman dihapus. Tidak ada baris = masih menunggu = tahan (dalam jendela).
         */
        hasArchiveVerdict(segmentId) {
            try {
                const rows = query(
                    'SELECT 1 FROM telegram_archive_uploads WHERE segment_id = ? LIMIT 1',
                    [segmentId],
                );
                return rows.length > 0;
            } catch {
                // Tidak bisa membaca = jangan sampai menahan selamanya; anggap sudah diputuskan.
                return true;
            }
        },
    };
}

export default { createArchiveHoldPolicy, toSqliteUtc };
