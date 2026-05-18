// Purpose: Finalize pending/orphan MP4 recordings into validated playback-ready segment rows.
// Caller: recordingService scanner, FFmpeg close handling, startup recovery, and shutdown drain.
// Deps: recordingMediaProbe, recordingRemuxer, recordingFilePromoter, segment repository, diagnostics repository,
//        segmentFilePolicy, recordingPaths, recordingIntervalsPolicy.
// MainFuncs: createRecordingSegmentFinalizer, finalizeSegment, drain.
// SideEffects: Probes/remuxes/renames recording files and writes recording segment/diagnostic rows.

import { promises as fsPromises } from 'fs';
import recordingSegmentRepository from './recordingSegmentRepository.js';
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';
import {
    getFinalRecordingPath,
    getTempRecordingPath,
    parseSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';
import { RECORDING_FINALIZER_STABILITY_DELAY_MS } from './recordingIntervalsPolicy.js';
import { createRecordingMediaProbe } from './recordingMediaProbe.js';
import { createRecordingRemuxer } from './recordingRemuxer.js';
import { createRecordingFilePromoter } from './recordingFilePromoter.js';

const defaultProbe = createRecordingMediaProbe();
const defaultRemuxer = createRecordingRemuxer();
const defaultPromoter = createRecordingFilePromoter();

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRecordingSegmentFinalizer({
    recordingsBasePath = RECORDINGS_BASE_PATH,
    repository = recordingSegmentRepository,
    diagnosticsRepository = recordingRecoveryDiagnosticsRepository,
    stabilityDelayMs = RECORDING_FINALIZER_STABILITY_DELAY_MS,
    probe = defaultProbe,
    remuxer = defaultRemuxer,
    promoter = defaultPromoter,
    logger = console,
} = {}) {
    const inFlight = new Map();

    function recordDiagnostic({ cameraId, finalFilename, filePath, state, reason, fileSize, detectedAt }) {
        diagnosticsRepository.upsertDiagnostic({
            cameraId,
            filename: finalFilename,
            filePath,
            state,
            reason,
            fileSize,
            detectedAt,
        });
    }

    async function safeUnlink(filePath, label) {
        try {
            await promoter.removeIfExists(filePath);
        } catch (error) {
            logger.warn?.(`[RecordingFinalizer] Failed to cleanup ${label} ${filePath}: ${error.message}`);
        }
    }

    async function finalizeInternal({ cameraId, sourcePath, filename, sourceType = 'partial' }) {
        const parsed = parseSegmentFilename(filename);
        const finalFilename = parsed?.finalFilename ?? toFinalSegmentFilename(filename);
        if (!parsed || !finalFilename) {
            return { success: false, reason: 'invalid_filename' };
        }

        const finalPath = getFinalRecordingPath(recordingsBasePath, cameraId, finalFilename);
        const tempPath = getTempRecordingPath(recordingsBasePath, cameraId, finalFilename);
        const detectedAt = new Date().toISOString();

        try {
            await fsPromises.access(sourcePath);

            const stable = await promoter.ensureStable(sourcePath, stabilityDelayMs);
            if (!stable.stable) {
                recordDiagnostic({
                    cameraId, finalFilename, filePath: sourcePath,
                    state: 'pending', reason: 'file_still_changing',
                    fileSize: stable.size, detectedAt,
                });
                return { success: false, reason: 'file_still_changing', finalFilename };
            }

            const sourceDuration = await probe.probeDuration(sourcePath);
            if (!sourceDuration) {
                recordDiagnostic({
                    cameraId, finalFilename, filePath: sourcePath,
                    state: 'retryable_failed', reason: 'invalid_duration',
                    fileSize: stable.size, detectedAt,
                });
                return { success: false, reason: 'invalid_duration', finalFilename };
            }

            const needsRemux = sourcePath !== finalPath || sourceType !== 'final_orphan';
            if (needsRemux) {
                await remuxer.remuxToFile(sourcePath, tempPath);
                const tempDuration = await probe.probeDuration(tempPath);
                if (!tempDuration) {
                    recordDiagnostic({
                        cameraId, finalFilename, filePath: tempPath,
                        state: 'retryable_failed', reason: 'remux_invalid_duration',
                        fileSize: stable.size, detectedAt,
                    });
                    return { success: false, reason: 'remux_invalid_duration', finalFilename };
                }
                await promoter.promote(tempPath, finalPath);
            }

            const finalStats = await fsPromises.stat(finalPath);
            const duration = await probe.probeDuration(finalPath);
            if (!duration) {
                recordDiagnostic({
                    cameraId, finalFilename, filePath: finalPath,
                    state: 'retryable_failed', reason: 'final_invalid_duration',
                    fileSize: finalStats.size, detectedAt,
                });
                return { success: false, reason: 'final_invalid_duration', finalFilename };
            }

            repository.upsertSegment({
                cameraId,
                filename: finalFilename,
                startTime: parsed.timestamp.toISOString(),
                endTime: new Date(parsed.timestamp.getTime() + duration * 1000).toISOString(),
                fileSize: finalStats.size,
                duration,
                filePath: finalPath,
            });
            diagnosticsRepository.clearDiagnostic({ cameraId, filename: finalFilename });

            if (sourceType === 'partial' && sourcePath !== finalPath) {
                await safeUnlink(sourcePath, 'finalized partial');
            }

            logger.log?.(`[RecordingFinalizer] Finalized camera${cameraId}/${finalFilename} duration=${duration}s source=${sourceType}`);
            return { success: true, finalFilename, duration, filePath: finalPath };
        } catch (error) {
            logger.warn?.(`[RecordingFinalizer] Failed camera${cameraId}/${finalFilename}: ${error.message || 'finalize_failed'}`);
            await safeUnlink(tempPath, 'temp file');
            recordDiagnostic({
                cameraId, finalFilename, filePath: sourcePath,
                state: 'retryable_failed', reason: error.message || 'finalize_failed',
                fileSize: 0, detectedAt,
            });
            return { success: false, reason: error.message || 'finalize_failed', finalFilename };
        }
    }

    function finalizeSegment(input) {
        const finalFilename = toFinalSegmentFilename(input.filename);
        const key = `${input.cameraId}:${finalFilename || input.filename}`;
        if (inFlight.has(key)) {
            return inFlight.get(key);
        }

        const promise = finalizeInternal(input).finally(() => {
            inFlight.delete(key);
        });
        inFlight.set(key, promise);
        return promise;
    }

    // Loop until the in-flight map is empty or the deadline passes. The snapshot
    // approach would miss finalize jobs that begin after drain() is called (e.g.
    // a late ffmpeg close handler firing during shutdown).
    async function drain(timeoutMs = 30000) {
        const deadline = Date.now() + timeoutMs;
        while (inFlight.size > 0 && Date.now() < deadline) {
            await Promise.race([
                Promise.allSettled([...inFlight.values()]),
                sleep(50),
            ]);
        }
        return {
            drained: inFlight.size === 0,
            pending: inFlight.size,
        };
    }

    return { finalizeSegment, drain };
}

export default createRecordingSegmentFinalizer();
