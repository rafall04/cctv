// Purpose: Scan recording folders for pending partials, final orphans, and recoverable scanner work.
// Caller: recordingService startSegmentScanner facade.
// Deps: fs promises, connectionPool query helpers, segment file policy, file operation service, recovery service ownership checks.
// MainFuncs: createRecordingRecoveryScanner, scanOnce, start.
// SideEffects: Reads recording folders, deletes only finalized duplicate pending partials through safe delete, and calls injected recovery callbacks.

import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { query, queryOne } from '../database/connectionPool.js';
import recordingFileOperationService from './recordingFileOperationService.js';
import recordingRecoveryService from './recordingRecoveryService.js';
import {
    getPendingRecordingDir,
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';
import {
    RECORDING_RECOVERY_DUPLICATE_PARTIAL_MIN_AGE_MS as DUPLICATE_PARTIAL_MIN_AGE_MS,
    RECORDING_RECOVERY_MIN_AGE_MS as RECOVERY_MIN_AGE_MS,
    RECORDING_SEGMENT_SCAN_INTERVAL_MS as SCAN_INTERVAL_MS,
} from './recordingIntervalsPolicy.js';

function isDirectoryStat(stats) {
    return typeof stats?.isDirectory === 'function' && stats.isDirectory();
}

export function createRecordingRecoveryScanner({
    recordingsBasePath,
    fs = fsPromises,
    queryRows = query,
    querySingle = queryOne,
    fileOperations = recordingFileOperationService,
    recoveryService = recordingRecoveryService,
    // Cameras whose live recorder is CURRENTLY writing. Their newest partial is the open file and
    // must never be finalized/deleted by the scanner. Injected by the maintenance coordinator from
    // the recording process-manager singleton; defaults to none so a directly-constructed scanner
    // (tests) protects nothing and behaves exactly as before.
    getActiveRecordingCameraIds = () => [],
    onSegmentCreated,
    nowMs = () => Date.now(),
    logger = console,
} = {}) {
    if (!recordingsBasePath) {
        throw new Error('recordingsBasePath is required');
    }
    if (typeof onSegmentCreated !== 'function') {
        throw new Error('onSegmentCreated callback is required');
    }

    async function readPendingPartials(cameraId) {
        const pendingDir = getPendingRecordingDir(recordingsBasePath, cameraId);
        try {
            const files = await fs.readdir(pendingDir);
            return {
                pendingDir,
                files: files.filter(isPartialSegmentFilename),
            };
        } catch {
            return { pendingDir, files: [] };
        }
    }

    async function scanPendingPartials({ cameraId, existingFilesSet, result }) {
        const { pendingDir, files } = await readPendingPartials(cameraId);

        // Never touch the partial the live recorder is CURRENTLY writing. During a sustained
        // upstream stall an external ffmpeg (started with -reconnect) keeps its segment file OPEN
        // while the file's mtime goes stale — so the age gate below would misread the active
        // partial as an orphan, finalize a TRUNCATED copy, and unlink the inode ffmpeg still holds,
        // losing every frame written after the stall recovers. The open segment is the newest-named
        // partial (`%Y%m%d_%H%M%S`, lexicographically sortable), and only for a camera that is
        // actually recording; older partials are genuine rolled-past orphans that recovery salvages.
        let protectedPartial = null;
        if (files.length) {
            let activeIds = [];
            try { activeIds = getActiveRecordingCameraIds() || []; } catch { activeIds = []; }
            if (new Set(activeIds.map(Number)).has(Number(cameraId))) {
                protectedPartial = files.reduce((newest, f) => (f > newest ? f : newest));
            }
        }

        for (const filename of files) {
            if (filename === protectedPartial) {
                continue;
            }

            const finalFilename = toFinalSegmentFilename(filename);
            if (!finalFilename) {
                continue;
            }

            const filePath = join(pendingDir, filename);
            const stats = await fs.stat(filePath);
            const fileAge = nowMs() - stats.mtimeMs;

            if (existingFilesSet.has(finalFilename)) {
                if (fileAge > DUPLICATE_PARTIAL_MIN_AGE_MS) {
                    const deleteResult = await fileOperations.deleteFileSafely({
                        cameraId,
                        filename,
                        filePath,
                        reason: 'pending_partial_finalized_duplicate',
                    });
                    if (deleteResult.success) {
                        result.duplicatePartialsDeleted += 1;
                        logger.log?.(`[Scanner] Removed finalized pending partial: camera${cameraId}/${filename}`);
                    }
                }
                continue;
            }

            if (recoveryService.isFileOwned(cameraId, finalFilename)) {
                continue;
            }

            if (fileAge > RECOVERY_MIN_AGE_MS) {
                // An empty partial is an aborted segment: the camera opened the file
                // but delivered no frames (e.g. a stalled/hung stream). There is
                // nothing to recover, so delete it immediately instead of churning it
                // through the recovery queue — and inflating the diagnostics/health
                // backlog that drives false "pipeline" alerts — for hours.
                if (stats.size === 0) {
                    const emptyDelete = await fileOperations.deleteFileSafely({
                        cameraId,
                        filename,
                        filePath,
                        reason: 'empty_pending_partial',
                    });
                    if (emptyDelete.success) {
                        result.emptyPartialsDeleted += 1;
                        logger.log?.(`[Scanner] Deleted empty pending partial: camera${cameraId}/${filename}`);
                    }
                    continue;
                }

                const retryDecision = recoveryService.shouldRetryNow?.({
                    cameraId,
                    filename,
                    sourceType: 'partial',
                    nowMs: nowMs(),
                }) || { allowed: true };

                if (!retryDecision.allowed) {
                    result.retrySkipped += 1;
                    continue;
                }

                onSegmentCreated(cameraId, filename);
                result.queuedSegments += 1;
            }
        }
    }

    async function scanFinalFiles({ cameraId, cameraDir, finalFiles, existingFilesSet, result }) {
        for (const filename of finalFiles) {
            if (existingFilesSet.has(filename)) {
                continue;
            }

            const filePath = join(cameraDir, filename);
            const stats = await fs.stat(filePath);
            if (recoveryService.isFileOwned(cameraId, filename)) {
                continue;
            }

            const fileAge = nowMs() - stats.mtimeMs;
            if (fileAge > RECOVERY_MIN_AGE_MS) {
                const retryDecision = recoveryService.shouldRetryNow?.({
                    cameraId,
                    filename,
                    sourceType: 'final_orphan',
                    nowMs: nowMs(),
                }) || { allowed: true };

                if (!retryDecision.allowed) {
                    result.retrySkipped += 1;
                    continue;
                }

                onSegmentCreated(cameraId, filename);
                result.queuedSegments += 1;
            }
        }
    }

    async function scanCameraDir(dirName, result) {
        const cameraDir = join(recordingsBasePath, dirName);
        try {
            const stats = await fs.stat(cameraDir);
            if (!isDirectoryStat(stats)) {
                return;
            }
        } catch {
            return;
        }

        const cameraIdMatch = dirName.match(/camera(\d+)/);
        if (!cameraIdMatch) {
            return;
        }

        const cameraId = Number.parseInt(cameraIdMatch[1], 10);
        const camera = querySingle('SELECT id, enable_recording FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            return;
        }

        result.scannedCameras += 1;

        try {
            const allFiles = await fs.readdir(cameraDir);
            const finalFiles = allFiles.filter(isFinalSegmentFilename);
            const existingFilesSet = new Set(
                queryRows('SELECT filename FROM recording_segments WHERE camera_id = ?', [cameraId])
                    .map((row) => row.filename)
            );

            await scanPendingPartials({ cameraId, existingFilesSet, result });
            await scanFinalFiles({ cameraId, cameraDir, finalFiles, existingFilesSet, result });
        } catch (error) {
            logger.error?.(`[Scanner] Error scanning camera ${cameraId}:`, error);
        }
    }

    async function scanOnce() {
        const result = {
            scannedCameras: 0,
            queuedSegments: 0,
            duplicatePartialsDeleted: 0,
            emptyPartialsDeleted: 0,
            retrySkipped: 0,
        };

        try {
            await fs.access(recordingsBasePath);
        } catch {
            return result;
        }

        try {
            const cameraDirs = await fs.readdir(recordingsBasePath);
            for (const dirName of cameraDirs) {
                await scanCameraDir(dirName, result);
            }
        } catch (error) {
            logger.error?.('[Scanner] Error in segment scanner:', error);
        }

        /*
         * One line per SCAN, not per file. The per-file lines this replaces printed 8,879
         * entries a day and were duplicated verbatim by the enqueue path, so one event cost
         * two lines. These counters already existed but were never reported anywhere — the
         * volume was high and the visibility was still zero. Silent when nothing happened.
         */
        // retrySkipped is deliberately NOT in this gate. A file parked as `retain_dormant` is
        // re-skipped on every scan until retention removes it, so including it would print this
        // line every 60s forever once anything goes dormant — reintroducing the steady-state
        // noise this aggregate replaced. It is still reported when something else did happen.
        const didSomething = result.queuedSegments + result.duplicatePartialsDeleted
            + result.emptyPartialsDeleted;
        if (didSomething > 0) {
            logger.log?.(`[Scanner] ${result.scannedCameras} camera(s): queued=${result.queuedSegments} dupDeleted=${result.duplicatePartialsDeleted} emptyDeleted=${result.emptyPartialsDeleted} retrySkipped=${result.retrySkipped}`);
        }

        return result;
    }

    return { scanOnce, intervalMs: SCAN_INTERVAL_MS };
}

export default createRecordingRecoveryScanner;
