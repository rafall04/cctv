// Purpose: Orchestrate low-disk recording cleanup without coupling it to the recording facade.
// Caller: recordingMaintenanceService and recordingService compatibility method.
// Deps: recording cleanup service, disk space service, retention policy, segment file policy, file operations.
// MainFuncs: createRecordingEmergencyDiskService, runEmergencyCheck.
// SideEffects: May delete safe temp files, queue final orphan recovery, and delete DB-registered segments through cleanupService.

import { join } from 'path';
import { canDeleteRecordingFile, computeRetentionWindow } from './recordingRetentionPolicy.js';
import { isFinalSegmentFilename } from './recordingSegmentFilePolicy.js';

export const EMERGENCY_DISK_THRESHOLD_BYTES = 1 * 1024 * 1024 * 1024;
export const EMERGENCY_DISK_TARGET_BYTES = 2 * 1024 * 1024 * 1024;

export function createRecordingEmergencyDiskService({
    recordingsBasePath,
    cleanupService,
    diskSpaceService,
    fs,
    safeDelete,
    getCameraRetentionHours,
    onRecoverOrphan,
    logger = console,
    now = Date.now,
} = {}) {
    async function runEmergencyCheck() {
        const freeBytes = await diskSpaceService.getFreeBytes(recordingsBasePath);
        if (!Number.isFinite(freeBytes)) {
            return { status: 'skipped_unknown_disk', deleted: 0, deletedBytes: 0 };
        }

        const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
        logger.log?.(`[DiskCheck] Free disk space: ${freeGB}GB`);

        if (freeBytes > EMERGENCY_DISK_THRESHOLD_BYTES) {
            return { status: 'skipped_enough_space', freeBytes, deleted: 0, deletedBytes: 0 };
        }

        logger.warn?.(`[DiskCheck] LOW DISK SPACE: ${freeGB}GB free. Starting emergency cleanup...`);
        const primaryResult = await cleanupService.emergencyCleanup({
            freeBytes,
            targetFreeBytes: EMERGENCY_DISK_TARGET_BYTES,
            batchLimit: 200,
            allowRetentionBypass: true,
            getCameraRetentionHours,
        });

        let deleted = primaryResult.deleted || 0;
        let deletedBytes = primaryResult.deletedBytes || 0;

        if ((freeBytes + deletedBytes) < EMERGENCY_DISK_TARGET_BYTES) {
            const fallbackResult = await cleanupFilesystemFallback({ freeBytes, deletedBytes });
            deleted += fallbackResult.deleted;
            deletedBytes += fallbackResult.deletedBytes;
        }

        if (deleted > 0) {
            logger.warn?.(`[DiskCheck] Emergency cleanup: deleted ${deleted} files, freed ${(deletedBytes / 1024 / 1024).toFixed(2)}MB`);
        }

        return { status: 'ok', freeBytes, deleted, deletedBytes };
    }

    async function cleanupFilesystemFallback({ freeBytes, deletedBytes }) {
        const result = { deleted: 0, deletedBytes: 0 };
        try {
            await fs.access(recordingsBasePath);
        } catch {
            return result;
        }

        const cameraDirs = await fs.readdir(recordingsBasePath);
        for (const dir of cameraDirs) {
            if ((freeBytes + deletedBytes + result.deletedBytes) > EMERGENCY_DISK_TARGET_BYTES) break;
            const cameraIdMatch = String(dir).match(/^camera(\d+)$/);
            if (!cameraIdMatch) continue;

            const cameraId = Number.parseInt(cameraIdMatch[1], 10);
            const fullDirPath = join(recordingsBasePath, dir);
            let stats;
            try {
                stats = await fs.stat(fullDirPath);
            } catch {
                continue;
            }
            if (!stats.isDirectory()) continue;

            const files = await listDeletionCandidates({ cameraId, fullDirPath });
            for (const file of files) {
                if ((freeBytes + deletedBytes + result.deletedBytes) > EMERGENCY_DISK_TARGET_BYTES) break;
                if (isFinalSegmentFilename(file.name)) {
                    await onRecoverOrphan({
                        cameraId,
                        filename: file.name,
                        filePath: file.path,
                        sourceType: 'final_orphan',
                    });
                    continue;
                }

                const deleteResult = await safeDelete({
                    cameraId,
                    filename: file.name,
                    filePath: file.path,
                    reason: 'emergency_filesystem_cleanup',
                });
                if (deleteResult.success) {
                    result.deleted++;
                    result.deletedBytes += deleteResult.size || 0;
                }
            }
        }

        return result;
    }

    async function listDeletionCandidates({ cameraId, fullDirPath }) {
        const allFiles = await fs.readdir(fullDirPath);
        const nowMs = now();
        const retentionWindow = computeRetentionWindow({
            retentionHours: getCameraRetentionHours(cameraId),
            nowMs,
        });
        const files = [];

        for (const filename of allFiles) {
            if (!/^\d{8}_\d{6}\.mp4$/.test(filename) && !filename.includes('.remux.mp4') && !filename.includes('.temp.mp4')) {
                continue;
            }

            const filePath = join(fullDirPath, filename);
            try {
                const stats = await fs.stat(filePath);
                const deletePolicy = canDeleteRecordingFile({
                    filename,
                    fileMtimeMs: stats.mtimeMs,
                    retentionWindow,
                    nowMs,
                });
                if (deletePolicy.allowed) {
                    files.push({ name: filename, path: filePath, mtime: stats.mtimeMs, size: stats.size });
                }
            } catch {
                logger.error?.(`[DiskCheck] Failed reading emergency candidate ${filePath}`);
            }
        }

        return files.sort((a, b) => a.mtime - b.mtime);
    }

    return { runEmergencyCheck };
}
