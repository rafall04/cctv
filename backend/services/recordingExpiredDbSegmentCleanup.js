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
    holdHours = 0,
} = {}) {
    return async function cleanupExpiredDbSegments({ cameraId, retentionWindow, result, nowMs = Date.now() }) {
        const segments = repository.findExpiredSegments({
            cameraId,
            cutoffIso: retentionWindow.cutoffIso,
            limit: batchSize,
        });

        // Penahanan dihitung SEKALI per kamera: cleanup ini per-kamera, status 'sedang mengarsip'
        // sama untuk semua segmennya. holdCutoffIso dihitung langsung (tanpa grace/klamp) sebagai
        // ambang umur yang dibandingkan string dengan start_time (ISO-Z, format sama).
        let holdActive = false;
        let holdCutoffIso = null;
        if (archiveHold && holdHours > 0) {
            holdCutoffIso = new Date(nowMs - holdHours * 3600 * 1000).toISOString();
            const sinceUtc = toSqliteUtc(nowMs - holdHours * 3600 * 1000);
            holdActive = archiveHold.cameraArchivingActive(cameraId, sinceUtc);
        }

        for (const segment of segments) {
            if (isFileBeingProcessed(cameraId, segment.filename)) {
                result.processingSkipped++;
                continue;
            }

            // TAHAN: belum diputuskan uploader (tak ada baris arsip), kamera aktif mengarsip, dan
            // masih dalam jendela. Beri kesempatan terunggah alih-alih dihapus permanen saat outage.
            // Backstop disk darurat (jalur lain) tetap bisa menghapus kalau disk kritis.
            if (holdActive
                && segment.start_time >= holdCutoffIso
                && !archiveHold.hasArchiveVerdict(segment.id)) {
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
