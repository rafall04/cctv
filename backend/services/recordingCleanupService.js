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
} = {}) {
    const inFlightCameraIds = new Set();
    const lastRunAtByCamera = new Map();
    const isFileBeingProcessed = (cameraId, filename) =>
        recoveryService?.isFileOwned?.(cameraId, filename) === true;

    const cleanupExpiredDbSegments = createExpiredDbSegmentCleanup({
        repository, fs, safeDelete, isFileBeingProcessed,
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

            await cleanupExpiredDbSegments({ cameraId, retentionWindow, result });
            await cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result });
            await cleanupPendingPartials({ cameraId, retentionWindow, nowMs, result });

            logger.log?.(`[Cleanup] Camera ${cameraId} summary: ${JSON.stringify(result)}`);
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
