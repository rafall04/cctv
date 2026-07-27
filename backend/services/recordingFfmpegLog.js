// Purpose: Per-camera FFmpeg stderr log file + a tailer that replays it into the
//          existing stderr callbacks, so a recorder's output survives its parent.
// Caller: recordingProcessManager (spawn + adopt paths).
// Deps: node:fs, node:path, recordingPaths.
// MainFuncs: getFfmpegLogPath, openFfmpegLog, createLogTailer.
// SideEffects: Creates/appends/truncates one log file per recording camera.
//
// WHY A FILE INSTEAD OF A PIPE
// ----------------------------
// FFmpeg used to inherit a pipe to the backend for stderr. That pipe is what made
// recordings die on every backend restart: when the parent exits, the read end
// closes, and ffmpeg's very next progress write gets EPIPE/SIGPIPE and terminates.
// So "just spawn detached" is NOT enough on its own — the stdio has to stop
// pointing at the parent too.
//
// Writing stderr to a file decouples the two completely:
//   * ffmpeg keeps running (and keeps writing) no matter what happens to the backend;
//   * a NEW backend can adopt that same ffmpeg and pick the log up from the end,
//     so freshness tracking, segment-completion detection and error classification
//     all keep working exactly as before — they just read from a file, not a pipe.
//
// The progress lines ffmpeg emits are the heartbeat the freeze detector relies on
// (see recordingHealthMonitor), so they must NOT be suppressed with -nostats. They
// do mean the file grows steadily, hence the self-truncation below.

import { createReadStream, existsSync, mkdirSync, openSync, statSync, truncateSync } from 'fs';
import { dirname, join } from 'path';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';

// ffmpeg progress output is ~100 bytes every fraction of a second. Left alone that
// is hundreds of MB per camera per day on a disk that also holds the recordings.
// The tailer truncates once the file passes this, right after reading the tail —
// the fd is opened O_APPEND, so ffmpeg simply continues at the new (zero) end.
export const FFMPEG_LOG_MAX_BYTES = 8 * 1024 * 1024;
export const FFMPEG_LOG_POLL_INTERVAL_MS = 1000;

export function getFfmpegLogPath(recordingsBasePath = RECORDINGS_BASE_PATH, cameraId) {
    return join(recordingsBasePath, `camera${cameraId}`, 'ffmpeg.log');
}

/**
 * Open the per-camera log for appending and return a raw fd suitable for passing
 * to child_process.spawn's stdio array. O_APPEND matters: it is what lets the
 * tailer truncate the file underneath a running ffmpeg without corrupting offsets.
 */
export function openFfmpegLog(logPath) {
    mkdirSync(dirname(logPath), { recursive: true });
    return openSync(logPath, 'a');
}

/**
 * Follow a log file and hand every newly appended chunk to onData.
 *
 * `fromEnd: true` is the adoption case — an already-running ffmpeg has history in
 * the file we must not replay as if it were live (it would reset freshness and
 * re-fire old segment-completion events).
 *
 * Returns { stop() }. Never throws: a missing/unreadable log degrades to "no data
 * yet" so a log problem can never take down a recording.
 */
export function createLogTailer({
    logPath,
    onData,
    fromEnd = false,
    maxBytes = FFMPEG_LOG_MAX_BYTES,
    intervalMs = FFMPEG_LOG_POLL_INTERVAL_MS,
    logger = console,
} = {}) {
    let offset = 0;
    let inode = null;
    let stopped = false;
    let reading = false;

    if (fromEnd) {
        try {
            if (existsSync(logPath)) {
                const stats = statSync(logPath);
                offset = stats.size;
                inode = stats.ino;
            }
        } catch {
            offset = 0;
        }
    }

    function readNewBytes() {
        if (stopped || reading) {
            return;
        }

        let stats;
        try {
            stats = statSync(logPath);
        } catch {
            // Log not created yet (ffmpeg still starting) or removed by an operator.
            return;
        }
        const size = stats.size;

        // A different inode means the path now points at a NEW file — logrotate
        // moved the old one aside, or an operator replaced it. Byte offsets from
        // the previous file are meaningless against this one.
        if (inode !== null && stats.ino !== inode) {
            offset = 0;
        }
        inode = stats.ino;

        // Truncated underneath us — either by our own maxBytes sweep or externally.
        if (size < offset) {
            offset = 0;
        }
        if (size === offset) {
            return;
        }

        reading = true;
        const start = offset;
        const end = size - 1;
        offset = size;

        const stream = createReadStream(logPath, { start, end, encoding: 'utf8' });
        let chunkText = '';

        stream.on('data', (chunk) => { chunkText += chunk; });
        stream.on('error', (error) => {
            reading = false;
            logger.warn?.(`[FfmpegLog] Failed reading ${logPath}: ${error.message}`);
        });
        stream.on('close', () => {
            reading = false;
            if (chunkText) {
                try {
                    onData?.(chunkText);
                } catch (error) {
                    logger.warn?.(`[FfmpegLog] onData handler threw: ${error?.message || error}`);
                }
            }
            if (size > maxBytes) {
                try {
                    truncateSync(logPath, 0);
                    offset = 0;
                } catch (error) {
                    logger.warn?.(`[FfmpegLog] Could not truncate ${logPath}: ${error.message}`);
                }
            }
        });
    }

    const timer = setInterval(readNewBytes, intervalMs);
    timer.unref?.();

    return {
        stop() {
            stopped = true;
            clearInterval(timer);
        },
        // Test seam: drive one poll synchronously instead of waiting on the timer.
        pollNow: readNewBytes,
    };
}

export default { getFfmpegLogPath, openFfmpegLog, createLogTailer };
