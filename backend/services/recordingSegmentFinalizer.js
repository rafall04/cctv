// Purpose: Finalize pending/orphan MP4 recordings into validated playback-ready segment rows.
// Caller: recordingService scanner, FFmpeg close handling, startup recovery, and shutdown drain.
// Deps: fs promises, child_process, recordingSegmentFilePolicy, segment repository, diagnostics repository.
// MainFuncs: createRecordingSegmentFinalizer, finalizeSegment, drain.
// SideEffects: Probes/remuxes/renames recording files and writes recording segment/diagnostic rows.

import { exec, spawn } from 'child_process';
import { promises as fsPromises } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import recordingSegmentRepository from './recordingSegmentRepository.js';
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';
import {
    getFinalRecordingPath,
    getTempRecordingPath,
    parseSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RECORDINGS_BASE_PATH = join(__dirname, '..', '..', 'recordings');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDuration(stdout) {
    const duration = Math.round(parseFloat(String(stdout || '').trim()));
    return Number.isFinite(duration) && duration >= 1 ? duration : null;
}

async function probeDuration(filePath) {
    const { stdout } = await execPromise(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: 'utf8', timeout: 5000 }
    );
    return parseDuration(stdout);
}

async function remuxToTemp(sourcePath, tempPath) {
    await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', sourcePath,
            '-c', 'copy',
            '-movflags', '+faststart',
            '-fflags', '+genpts',
            '-avoid_negative_ts', 'make_zero',
            '-f', 'mp4',
            '-y',
            tempPath,
        ]);

        let stderr = '';
        ffmpeg.stderr?.on('data', (chunk) => {
            if (stderr.length < 10000) {
                stderr += chunk.toString();
            }
        });
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`ffmpeg remux failed with code ${code}: ${stderr.slice(-500)}`));
        });
        ffmpeg.on('error', reject);
    });
}

async function removeFileIfExists(filePath) {
    try {
        await fsPromises.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}

export function createRecordingSegmentFinalizer({
    recordingsBasePath = DEFAULT_RECORDINGS_BASE_PATH,
    repository = recordingSegmentRepository,
    diagnosticsRepository = recordingRecoveryDiagnosticsRepository,
    stabilityDelayMs = 10000,
} = {}) {
    const inFlight = new Map();

    async function ensureStableFile(filePath) {
        const first = await fsPromises.stat(filePath);
        await sleep(stabilityDelayMs);
        const second = await fsPromises.stat(filePath);
        if (first.size !== second.size) {
            return { stable: false, size: second.size, mtimeMs: second.mtimeMs };
        }
        return { stable: true, size: second.size, mtimeMs: second.mtimeMs };
    }

    async function promoteTemp(tempPath, finalPath) {
        try {
            await fsPromises.rename(tempPath, finalPath);
        } catch (error) {
            if (error.code !== 'EXDEV') {
                throw error;
            }
            await fsPromises.copyFile(tempPath, finalPath);
            await fsPromises.unlink(tempPath);
        }
    }

    async function cleanupTempFile(tempPath) {
        try {
            await removeFileIfExists(tempPath);
        } catch (error) {
            console.warn(`[RecordingFinalizer] Failed to cleanup temp file ${tempPath}: ${error.message}`);
        }
    }

    async function cleanupFinalizedPartial(sourcePath) {
        try {
            await removeFileIfExists(sourcePath);
        } catch (error) {
            console.warn(`[RecordingFinalizer] Failed to cleanup finalized partial ${sourcePath}: ${error.message}`);
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
            const stable = await ensureStableFile(sourcePath);
            if (!stable.stable) {
                diagnosticsRepository.upsertDiagnostic({
                    cameraId,
                    filename: finalFilename,
                    filePath: sourcePath,
                    state: 'pending',
                    reason: 'file_still_changing',
                    fileSize: stable.size,
                    detectedAt,
                });
                return { success: false, reason: 'file_still_changing', finalFilename };
            }

            const sourceDuration = await probeDuration(sourcePath);
            if (!sourceDuration) {
                diagnosticsRepository.upsertDiagnostic({
                    cameraId,
                    filename: finalFilename,
                    filePath: sourcePath,
                    state: 'retryable_failed',
                    reason: 'invalid_duration',
                    fileSize: stable.size,
                    detectedAt,
                });
                return { success: false, reason: 'invalid_duration', finalFilename };
            }

            if (sourcePath !== finalPath || sourceType !== 'final_orphan') {
                await remuxToTemp(sourcePath, tempPath);
                const tempDuration = await probeDuration(tempPath);
                if (!tempDuration) {
                    diagnosticsRepository.upsertDiagnostic({
                        cameraId,
                        filename: finalFilename,
                        filePath: tempPath,
                        state: 'retryable_failed',
                        reason: 'remux_invalid_duration',
                        fileSize: stable.size,
                        detectedAt,
                    });
                    return { success: false, reason: 'remux_invalid_duration', finalFilename };
                }
                await promoteTemp(tempPath, finalPath);
            }

            const finalStats = await fsPromises.stat(finalPath);
            const duration = await probeDuration(finalPath);
            if (!duration) {
                diagnosticsRepository.upsertDiagnostic({
                    cameraId,
                    filename: finalFilename,
                    filePath: finalPath,
                    state: 'retryable_failed',
                    reason: 'final_invalid_duration',
                    fileSize: finalStats.size,
                    detectedAt,
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
                await cleanupFinalizedPartial(sourcePath);
            }

            console.log(`[RecordingFinalizer] Finalized camera${cameraId}/${finalFilename} duration=${duration}s source=${sourceType}`);
            return { success: true, finalFilename, duration, filePath: finalPath };
        } catch (error) {
            console.warn(`[RecordingFinalizer] Failed camera${cameraId}/${finalFilename}: ${error.message || 'finalize_failed'}`);
            await cleanupTempFile(tempPath);
            diagnosticsRepository.upsertDiagnostic({
                cameraId,
                filename: finalFilename,
                filePath: sourcePath,
                state: 'retryable_failed',
                reason: error.message || 'finalize_failed',
                fileSize: 0,
                detectedAt,
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

    async function drain(timeoutMs = 30000) {
        const work = Promise.allSettled([...inFlight.values()]);
        const timeout = sleep(timeoutMs).then(() => 'timeout');
        const result = await Promise.race([work, timeout]);
        return {
            drained: result !== 'timeout',
            pending: inFlight.size,
        };
    }

    return { finalizeSegment, drain };
}

export default createRecordingSegmentFinalizer();
