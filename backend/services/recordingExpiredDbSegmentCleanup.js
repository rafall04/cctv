// Purpose: Delete recording_segments rows + files whose start_time is older than the retention window.
// Caller: recordingCleanupService per-camera orchestrator.
// Deps: recordingIntervalsPolicy (batch size), safeDelete, repository, fs.access, isFileBeingProcessed.
// MainFuncs: createExpiredDbSegmentCleanup, cleanupExpiredDbSegments.
// SideEffects: Deletes files through safeDelete; deletes recording_segments rows through repository.

import { applyDeleteFailure } from './recordingCleanupShared.js';
import { RECORDING_CLEANUP_BATCH_SIZE } from './recordingIntervalsPolicy.js';
import { toSqliteUtc } from './recordingArchiveHoldPolicy.js';

export function createExpiredDbSegmentCleanup({
    repository,
    fs,
    safeDelete,
    isFileBeingProcessed,
    batchSize = RECORDING_CLEANUP_BATCH_SIZE,
    // Penjaga jangan-hapus-yang-belum-terarsip. Null = fitur mati (perilaku lama persis).
    archiveHold = null,
    // Akses disk (tetap) + pembaca setelan SEGAR. Dipisah supaya angka batas bisa diubah admin
    // di UI dan langsung berlaku siklus berikutnya tanpa restart.
    disk = null,   // { getFreeBytes, getUsedBytes, recordingsBasePath }
    resolveHold = null,   // () => { enabled, maxStorageBytes, safetyFloorBytes, activeWindowMs }
} = {}) {
    return async function cleanupExpiredDbSegments({ cameraId, retentionWindow, result, nowMs = Date.now() }) {
        const segments = repository.findExpiredSegments({
            cameraId,
            cutoffIso: retentionWindow.cutoffIso,
            limit: batchSize,
        });

        /*
         * Penahanan dibatasi PENYIMPANAN, bukan waktu. Tidak ada tenggat jam: segmen yang belum
         * terarsip ditahan selama disk masih muat, jadi outage sepanjang apa pun tidak kehilangan
         * rekaman selama masih ada ruang. Retensi per-kamera (waktu) tetap menghapus segmen yang
         * SUDAH terarsip seperti biasa.
         *
         * Dua gerbang, dihitung SEKALI per kamera:
         *   1. LANTAI KEAMANAN: kalau sisa disk turun di bawah safetyFloor, berhenti menahan -
         *      rekaman LIVE harus selalu bisa menulis. Ini invarian, bukan setelan yang boleh nol.
         *   2. BATAS PENYIMPANAN: kalau total rekaman sudah mencapai maxStorageBytes (setelan
         *      operator; 0 = tanpa batas), berhenti menahan.
         * Saat berhenti menahan, retensi normal menghapus yang tertua lebih dulu (findExpiredSegments
         * urut ASC), jadi ruang direbut dari rekaman paling lama - persis yang diinginkan.
         *
         * 'Kamera aktif mengarsip' dipakai jendela PANJANG (activeWindowMs, default 30 hari), BUKAN
         * jam: saat outage 3 hari, 'ok' terakhir kamera itu 3 hari lalu - jendela pendek akan salah
         * mengira kamera itu tak mengarsip lalu menghapus rekamannya. Justru lubang yang diperbaiki.
         */
        let holdCamera = false;
        const holdCfg = resolveHold ? resolveHold() : null;
        if (archiveHold && disk && holdCfg && holdCfg.enabled) {
            let storagePermits = true;
            if (holdCfg.safetyFloorBytes > 0) {
                // getFreeBytes bisa gagal (df tak ada / timeout); null = tak terukur -> jangan
                // memblokir penahanan atas dasar lantai yang tak bisa dibaca.
                let free = null;
                try { free = await disk.getFreeBytes(disk.recordingsBasePath); } catch { free = null; }
                if (Number.isFinite(free) && free < holdCfg.safetyFloorBytes) storagePermits = false;
            }
            if (storagePermits && holdCfg.maxStorageBytes > 0) {
                const used = disk.getUsedBytes();
                if (Number.isFinite(used) && used >= holdCfg.maxStorageBytes) storagePermits = false;
            }
            if (storagePermits) {
                const sinceUtc = toSqliteUtc(nowMs - holdCfg.activeWindowMs);
                holdCamera = archiveHold.cameraArchivingActive(cameraId, sinceUtc);
            }
        }

        for (const segment of segments) {
            if (isFileBeingProcessed(cameraId, segment.filename)) {
                result.processingSkipped++;
                continue;
            }

            // TAHAN: kamera ini aktif mengarsip, penyimpanan masih mengizinkan, dan uploader belum
            // memutuskan segmen ini (tak ada baris arsip = masih menunggu). Beri kesempatan terunggah
            // alih-alih dihapus permanen saat outage.
            if (holdCamera && !archiveHold.hasArchiveVerdict(segment.id)) {
                result.archiveHeld++;
                continue;
            }

            let fileExists = true;
            try {
                await fs.access(segment.file_path);
            } catch {
                fileExists = false;
            }

            if (!fileExists) {
                repository.deleteSegmentById(segment.id);
                result.missingRowsDeleted++;
                continue;
            }

            const deleteResult = await safeDelete({
                cameraId,
                filename: segment.filename,
                filePath: segment.file_path,
                reason: 'retention_expired',
            });

            if (!deleteResult.success) {
                applyDeleteFailure(deleteResult, result);
                continue;
            }

            repository.deleteSegmentById(segment.id);
            result.deleted++;
            result.deletedBytes += deleteResult.size || 0;
        }
    };
}
