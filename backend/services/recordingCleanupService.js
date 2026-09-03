// Purpose: Compose per-camera recording cleanup sub-routines + emergency cleanup behind one boundary.
//          Owns per-camera in-flight lock, rate-limit, and drain.
// Caller: recordingService maintenance coordinator, recordingEmergencyDiskService.
// Deps: recovery service ownership check, repository, fs, safeDelete, onRecoverOrphan,
//        + the 4 cleanup sub-modules.
// MainFuncs: createRecordingCleanupService, cleanupCamera, emergencyCleanup, drain.
// SideEffects: Deletes recording files through injected safeDelete and removes DB rows through repository.

import { promises as defaultFs } from 'fs';
import recordingRecoveryService from './recordingRecoveryService.js';
import { computeRetentionWindow } from './recordingRetentionPolicy.js';
import { RECORDING_CLEANUP_MIN_INTERVAL_MS } from './recordingIntervalsPolicy.js';
import { createEmptyResult } from './recordingCleanupShared.js';
import { createExpiredDbSegmentCleanup } from './recordingExpiredDbSegmentCleanup.js';
import { createArchiveHoldPolicy } from './recordingArchiveHoldPolicy.js';
import diskSpaceService from './recordingDiskSpaceService.js';
import { createStorageSettingsReader } from './recordingStorageSettings.js';
import { createFilesystemOrphanCleanup } from './recordingFilesystemOrphanCleanup.js';
import { createPendingPartialCleanup } from './recordingPendingPartialCleanup.js';
import { createEmergencyCleanup } from './recordingEmergencyCleanup.js';

export function createRecordingCleanupService({
    repository,
    fs = defaultFs,
    recordingsBasePath,
    safeDelete,
    recoveryService = recordingRecoveryService,
    onRecoverOrphan,
    minIntervalMs = RECORDING_CLEANUP_MIN_INTERVAL_MS,
    logger = console,
    diskSpace = diskSpaceService,
} = {}) {
    const inFlightCameraIds = new Set();
    const lastRunAtByCamera = new Map();
    const isFileBeingProcessed = (cameraId, filename) =>
        recoveryService?.isFileOwned?.(cameraId, filename) === true;

    /*
     * Penahanan arsip DIBATASI PENYIMPANAN, bukan waktu, dan setelannya dibaca dari tabel settings
     * (bisa diubah admin di UI: recording_max_storage_gb, recording_archive_hold_enabled). Dibaca
     * SEGAR tiap siklus lewat resolveHold(), jadi perubahan berlaku tanpa restart. Env tetap jadi
     * cadangan; lantai keamanan 5 GB & jendela 30 hari tetap env/advanced.
     */
    const resolveHold = createStorageSettingsReader();
    const cleanupExpiredDbSegments = createExpiredDbSegmentCleanup({
        repository, fs, safeDelete, isFileBeingProcessed,
        archiveHold: createArchiveHoldPolicy(),
        disk: {
            getFreeBytes: (basePath) => diskSpace.getFreeBytes(basePath),
            getUsedBytes: () => repository.totalStoredBytes(),
            recordingsBasePath,
        },
        resolveHold,
    });
    const cleanupFilesystemOrphans = createFilesystemOrphanCleanup({
        repository, fs, recordingsBasePath, safeDelete, isFileBeingProcessed, onRecoverOrphan, logger,
    });
    const cleanupPendingPartials = createPendingPartialCleanup({
        repository, fs, recordingsBasePath, safeDelete, isFileBeingProcessed, logger,
    });
    const runEmergencyCleanup = createEmergencyCleanup({
        repository, fs, safeDelete, isFileBeingProcessed, logger,
    });

    async function cleanupCamera({ cameraId, camera, nowMs = Date.now() }) {
        if (inFlightCameraIds.has(cameraId)) {
            return { ...createEmptyResult(), skippedReason: 'cleanup_in_flight' };
        }

        const lastRunAt = lastRunAtByCamera.get(cameraId) || 0;
        const timeSinceLastRun = nowMs - lastRunAt;
        if (timeSinceLastRun < minIntervalMs) {
            logger.log?.(`[Cleanup] Skipping cleanup for camera ${cameraId} (last cleanup ${Math.round(timeSinceLastRun / 1000)}s ago)`);
            return { ...createEmptyResult(), skippedReason: 'cleanup_throttled' };
        }

        inFlightCameraIds.add(cameraId);
        lastRunAtByCamera.set(cameraId, nowMs);
        const result = createEmptyResult();

        try {
            const retentionWindow = computeRetentionWindow({
                retentionHours: camera?.recording_duration_hours,
                nowMs,
            });

            await cleanupExpiredDbSegments({ cameraId, retentionWindow, result, nowMs });
            await cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result });
            await cleanupPendingPartials({ cameraId, retentionWindow, nowMs, result });

            // Only log when this camera actually did something. This loop runs for EVERY camera every
            // scheduled cycle (~5 min); logging an all-zeros summary per camera floods stdout
            // (~36 cams => ~10k no-op lines/day) and buries the lines that matter (AGENTS.md logging rules).
            const activity = Object.values(result).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
            if (activity > 0) {
                logger.log?.(`[Cleanup] Camera ${cameraId} summary: ${JSON.stringify(result)}`);
            }
            return result;
        } finally {
            inFlightCameraIds.delete(cameraId);
        }
    }

    async function emergencyCleanup(options = {}) {
        const result = createEmptyResult();
        await runEmergencyCleanup({ ...options, result });
        return result;
    }

    async function drain(timeoutMs = 30000) {
        const deadline = Date.now() + timeoutMs;
        while (inFlightCameraIds.size > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
            drained: inFlightCameraIds.size === 0,
            pending: inFlightCameraIds.size,
        };
    }

    return { cleanupCamera, emergencyCleanup, drain };
}
