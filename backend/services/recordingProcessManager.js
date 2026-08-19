// Purpose: Own FFmpeg child process lifecycle for CCTV recording.
// Caller: recordingService facade.
// Deps: child_process spawn, recordingRuntimeState, recordingFailureClassifier.
// MainFuncs: RecordingProcessManager.start, stop, restart, shutdownAll, getStatus.
// SideEffects: Spawns and stops FFmpeg child processes; writes lifecycle logs.

import { closeSync } from 'fs';
import { spawn } from 'child_process';
import { RecordingRuntimeState } from './recordingRuntimeState.js';
import { classifyRecordingExit } from './recordingFailureClassifier.js';
import { RECORDING_PROCESS_GRACEFUL_STOP_MS } from './recordingIntervalsPolicy.js';
import { createLogTailer, currentLogSize, openFfmpegLog, readFfmpegLogTail } from './recordingFfmpegLog.js';

// How often an ADOPTED recorder is checked for liveness. We are not its parent, so
// there is no 'close' event to wait on — kill(pid, 0) is the only signal available.
const ADOPTED_LIVENESS_POLL_MS = 5000;

// Per-camera stderr tail retained for exit classification. Hard byte ceiling so the
// worker's memory stays flat as the fleet grows — 64 KB × cameras is the whole cost.
export const OUTPUT_BUFFER_MAX_BYTES = 64 * 1024;
export const OUTPUT_BUFFER_MAX_CHUNKS = 50;

export class RecordingProcessManager {
    constructor({ gracefulStopTimeoutMs = RECORDING_PROCESS_GRACEFUL_STOP_MS, binary = 'ffmpeg' } = {}) {
        this.binary = binary;
        this.gracefulStopTimeoutMs = gracefulStopTimeoutMs;
        this.state = new RecordingRuntimeState();
        this.outputBuffers = new Map();
        this.closeWaiters = new Map();
        this.callbacks = new Map();
        this.tailers = new Map();
        this.logPaths = new Map();
        this.logStartOffsets = new Map();
        this.livenessTimers = new Map();
    }

    async start(cameraId, { ffmpegArgs, camera, streamSource, spawnOptions, stderrLogPath, onStdout, onStderr, onClose, onError }) {
        if (this.state.has(cameraId)) {
            return { success: false, message: 'Already recording' };
        }

        // With a log path we hand ffmpeg a FILE for stderr instead of a pipe to us.
        // That is what lets the recorder outlive this process (a pipe to a dead
        // parent kills it on the next write). Without one — unit tests, and any
        // caller that has not been migrated — keep the original pipe wiring.
        let logFd = null;
        let effectiveSpawnOptions = spawnOptions;
        if (stderrLogPath) {
            try {
                logFd = openFfmpegLog(stderrLogPath);
                effectiveSpawnOptions = { ...spawnOptions, stdio: ['ignore', 'ignore', logFd] };
            } catch (error) {
                console.warn(`[Recording] Could not open ffmpeg log for camera ${cameraId} (${error.message}); falling back to pipes`);
                logFd = null;
            }
        }

        const child = spawn(this.binary, ffmpegArgs, effectiveSpawnOptions);
        this.state.setActive(cameraId, { process: child, camera, streamSource });
        this.outputBuffers.set(cameraId, []);
        this.callbacks.set(cameraId, { onStdout, onStderr, onClose, onError });

        if (logFd !== null) {
            // The child holds its own duplicate of the fd; keeping ours open would
            // pin the file and leak a descriptor per restart.
            try { closeSync(logFd); } catch { /* already closed */ }
            // Don't hold the event loop open for a process that is meant to outlive us.
            child.unref?.();
            this.startTailer(cameraId, stderrLogPath, { fromEnd: false });
        } else {
            child.stdout?.on('data', (data) => {
                this.state.updateLastDataAt(cameraId);
                onStdout?.(data);
            });

            child.stderr?.on('data', (data) => {
                this.feedOutput(cameraId, data.toString());
            });
        }

        child.on('close', (exitCode, exitSignal) => {
            this.handleClose(cameraId, exitCode, exitSignal);
        });

        child.on('error', (error) => {
            this.pushOutput(cameraId, error.message);
            onError?.(error);
            this.handleClose(cameraId, 1, null);
        });

        this.logLifecycle(cameraId, 'start', { pid: child.pid, reason: 'recording_started' });
        return { success: true, message: 'Recording started', pid: child.pid };
    }

    /**
     * Take ownership of an ffmpeg this process did NOT spawn — a recorder left
     * running by the previous backend instance. The whole point of detaching
     * recorders is that a deploy no longer interrupts them, which is only true if
     * the incoming instance re-attaches instead of killing and respawning.
     *
     * We get no 'close' event (we are not the parent), so liveness is polled and
     * the stderr log is tailed from its CURRENT end — replaying old history would
     * re-fire stale segment-completion events and falsify freshness.
     */
    adopt(cameraId, { pid, camera, streamSource, stderrLogPath, startedAt, onStderr, onClose, onError }) {
        if (this.state.has(cameraId)) {
            return { success: false, message: 'Already tracked' };
        }
        if (!Number.isInteger(pid) || pid <= 0) {
            return { success: false, message: 'Invalid pid' };
        }

        this.state.setActive(cameraId, { process: null, pid, camera, streamSource, startedAt });
        this.outputBuffers.set(cameraId, []);
        this.callbacks.set(cameraId, { onStderr, onClose, onError });

        if (stderrLogPath) {
            this.startTailer(cameraId, stderrLogPath, { fromEnd: true });
        }
        this.startLivenessPoll(cameraId, pid);

        this.logLifecycle(cameraId, 'adopt', { pid, reason: 'adopted_from_previous_instance' });
        return { success: true, message: 'Recording adopted', pid };
    }

    startTailer(cameraId, logPath, { fromEnd }) {
        this.stopTailer(cameraId);
        this.logPaths.set(cameraId, logPath);
        // Where this recorder's output begins. The log is append-only and outlives every
        // process that writes to it, so classification must not be allowed to read backwards
        // into the previous recorder's dying words.
        this.logStartOffsets.set(cameraId, currentLogSize(logPath));
        const tailer = createLogTailer({
            logPath,
            fromEnd,
            onData: (output) => this.feedOutput(cameraId, output),
        });
        this.tailers.set(cameraId, tailer);
    }

    stopTailer(cameraId) {
        this.tailers.get(cameraId)?.stop();
        this.tailers.delete(cameraId);
    }

    /**
     * What FFmpeg said, for classification — the polled buffer PLUS a fresh read of the log.
     *
     * The second half is not belt-and-braces. FFmpeg's stderr is block-buffered into a file, so
     * a recorder that dies quickly flushes its last words only as it exits, after the tailer's
     * final 1s poll. Production camera 1169 closed with an empty buffer eight seconds running,
     * while "Too many packets buffered for output stream 0:0." sat plainly in its ffmpeg.log —
     * so every fast failure classified as the generic `ffmpeg_failed` and the recorder could
     * never learn anything from it.
     */
    getOutputForClassification(cameraId) {
        const buffered = this.getOutput(cameraId);
        const flushed = readFfmpegLogTail({
            logPath: this.logPaths.get(cameraId),
            fromOffset: this.logStartOffsets.get(cameraId) ?? 0,
        });
        return flushed ? `${buffered}\n${flushed}` : buffered;
    }

    startLivenessPoll(cameraId, pid) {
        this.stopLivenessPoll(cameraId);
        const timer = setInterval(() => {
            if (this.isPidAlive(pid)) {
                return;
            }
            this.stopLivenessPoll(cameraId);
            this.handleClose(cameraId, null, null);
        }, ADOPTED_LIVENESS_POLL_MS);
        timer.unref?.();
        this.livenessTimers.set(cameraId, timer);
    }

    stopLivenessPoll(cameraId) {
        const timer = this.livenessTimers.get(cameraId);
        if (timer) {
            clearInterval(timer);
            this.livenessTimers.delete(cameraId);
        }
    }

    isPidAlive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        } catch (error) {
            // EPERM means it exists but belongs to someone else — still alive.
            return error?.code === 'EPERM';
        }
    }

    feedOutput(cameraId, output) {
        this.state.updateLastDataAt(cameraId);
        this.pushOutput(cameraId, output);
        this.callbacks.get(cameraId)?.onStderr?.(output);
    }

    async stop(cameraId, reason = 'manual_stop', { signal = 'SIGINT', timeoutMs = this.gracefulStopTimeoutMs } = {}) {
        const record = this.state.get(cameraId);
        if (!record) {
            return { cameraId, reason: 'not_recording', forcedKill: false };
        }

        this.state.markStopping(cameraId, reason);
        const closePromise = this.waitForClose(cameraId);
        this.signalRecord(record, signal);
        this.logLifecycle(cameraId, 'stop_signal', { pid: record.pid, reason, signal, adopted: !!record.adopted });

        const timeout = setTimeout(() => {
            const latest = this.state.get(cameraId);
            if (latest && latest.status !== 'exited') {
                this.state.markForcedKill(cameraId);
                this.signalRecord(latest, 'SIGKILL');
                this.logLifecycle(cameraId, 'force_kill', { pid: latest.pid, reason, signal: 'SIGKILL' });
            }
        }, timeoutMs);

        try {
            return await closePromise;
        } finally {
            clearTimeout(timeout);
        }
    }

    async restart(cameraId, reason, config) {
        if (!this.state.tryBeginRestart(cameraId)) {
            return { success: false, message: 'Restart already in progress' };
        }

        try {
            await this.stop(cameraId, `${reason}_restart`);
            return await this.start(cameraId, config);
        } finally {
            this.state.endRestart(cameraId);
        }
    }

    /**
     * Send a signal to a record whether or not we own a child handle for it.
     * Adopted recorders only have a pid. Note that ffmpeg is spawned detached, so
     * the signal must target the pid itself — never the negated process group,
     * which would also hit whatever else shares it.
     */
    signalRecord(record, signal) {
        if (!record) {
            return false;
        }
        try {
            if (record.process) {
                record.process.kill(signal);
            } else if (record.pid) {
                process.kill(record.pid, signal);
            } else {
                return false;
            }
            return true;
        } catch (error) {
            // ESRCH = already gone; nothing left to signal.
            if (error?.code !== 'ESRCH') {
                console.warn(`[Recording] Failed to signal camera ${record.cameraId} pid ${record.pid}: ${error.message}`);
            }
            return false;
        }
    }

    async shutdownAll(reason = 'server_shutdown') {
        this.state.beginShutdown();
        const stops = this.getActiveCameraIds().map((cameraId) => this.stop(cameraId, reason));
        return Promise.all(stops);
    }

    /**
     * Server shutdown path: let every recorder KEEP RUNNING and just release our
     * side of it (tailers, liveness polls, in-memory state).
     *
     * This is the behaviour change that makes a backend deploy safe. Stopping the
     * recorders here is what used to truncate an in-flight segment on every single
     * restart — and when the process died hard instead of gracefully, the next
     * instance SIGKILLed the leftovers before ffmpeg could write the moov atom,
     * turning a truncated segment into an unplayable one. The incoming instance
     * calls adopt() and picks these same processes back up.
     */
    detachAll(reason = 'server_shutdown_detach') {
        const cameraIds = this.getActiveCameraIds();
        const detached = [];

        for (const cameraId of cameraIds) {
            const record = this.state.get(cameraId);
            if (!record) {
                continue;
            }
            this.stopTailer(cameraId);
            this.stopLivenessPoll(cameraId);
            // Drop our 'close'/'error' listeners so a child exiting during shutdown
            // cannot drive lifecycle work against a half-torn-down service.
            record.process?.removeAllListeners?.('close');
            record.process?.removeAllListeners?.('error');
            this.logLifecycle(cameraId, 'detach', { pid: record.pid, reason });
            detached.push({ cameraId, pid: record.pid });
            this.outputBuffers.delete(cameraId);
            this.callbacks.delete(cameraId);
            this.closeWaiters.delete(cameraId);
            this.state.remove(cameraId);
        }

        return detached;
    }

    getStatus(cameraId) {
        const record = this.state.get(cameraId);
        if (!record) {
            return { isRecording: false, status: 'stopped' };
        }
        return {
            isRecording: record.status === 'recording',
            status: record.status,
            pid: record.pid,
            startTime: record.startedAt,
            streamSource: record.streamSource,
            stopReason: record.stopReason,
            forcedKill: record.forcedKill,
            adopted: !!record.adopted,
            // Last time FFmpeg wrote anything (the `-stats` heartbeat ticks sub-second while it is
            // pulling). Exposed so the lifecycle policy can tell a recorder that is still being fed
            // by the camera from one that has stalled — see recordingLifecyclePolicy.
            lastDataAt: record.lastDataAt ?? null,
        };
    }

    getActiveCameraIds() {
        return this.state.activeCameraIds();
    }

    getRecord(cameraId) {
        return this.state.get(cameraId);
    }

    getOutput(cameraId) {
        return (this.outputBuffers.get(cameraId) ?? []).join('');
    }

    /**
     * Keep a small tail of ffmpeg stderr per camera, for exit classification.
     *
     * Bounded by BYTES, not chunk count. That distinction became load-bearing when
     * stderr moved from a pipe to a tailed log file: a pipe delivered small chunks,
     * but a tailer chunk is "everything appended since the last poll" and can be
     * megabytes if the process is busy. Keeping 50 of those per camera would scale
     * into hundreds of MB per camera — the opposite of what a fixed-size ring is for.
     *
     * classifyRecordingExit only ever reads the recent tail, so a few KB is plenty.
     */
    pushOutput(cameraId, output) {
        const chunks = this.outputBuffers.get(cameraId);
        if (!chunks) {
            return;
        }

        const text = String(output ?? '');
        // A single oversized chunk is truncated to its TAIL — the end is where the
        // error that killed ffmpeg will be.
        chunks.push(text.length > OUTPUT_BUFFER_MAX_BYTES
            ? text.slice(-OUTPUT_BUFFER_MAX_BYTES)
            : text);

        let total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        while (chunks.length > 1 && (total > OUTPUT_BUFFER_MAX_BYTES || chunks.length > OUTPUT_BUFFER_MAX_CHUNKS)) {
            total -= chunks.shift().length;
        }
    }

    waitForClose(cameraId) {
        if (!this.closeWaiters.has(cameraId)) {
            this.closeWaiters.set(cameraId, []);
        }

        return new Promise((resolve) => {
            this.closeWaiters.get(cameraId).push(resolve);
        });
    }

    handleClose(cameraId, exitCode, exitSignal) {
        const record = this.state.markExited(cameraId, { exitCode, exitSignal });
        if (!record) {
            return;
        }

        const reason = classifyRecordingExit({
            ffmpegOutput: this.getOutputForClassification(cameraId),
            exitCode,
            exitSignal,
            streamSource: record.streamSource,
            stopReason: record.stopReason,
        });

        const result = {
            cameraId,
            reason,
            exitCode,
            exitSignal,
            forcedKill: record.forcedKill,
            stopReason: record.stopReason,
        };

        this.logLifecycle(cameraId, 'close', {
            pid: record.pid,
            reason,
            exitCode,
            exitSignal,
            forcedKill: record.forcedKill,
        });

        const callbacks = this.callbacks.get(cameraId);
        callbacks?.onClose?.(result);

        const waiters = this.closeWaiters.get(cameraId) ?? [];
        this.closeWaiters.delete(cameraId);
        this.outputBuffers.delete(cameraId);
        this.callbacks.delete(cameraId);
        this.stopTailer(cameraId);
        // After classification, never before: getOutputForClassification reads through it.
        this.logPaths.delete(cameraId);
        this.logStartOffsets.delete(cameraId);
        this.stopLivenessPoll(cameraId);
        this.state.remove(cameraId);

        for (const resolve of waiters) {
            resolve(result);
        }
    }

    logLifecycle(cameraId, action, details = {}) {
        console.log('[RecordingLifecycle]', JSON.stringify({ cameraId, action, ...details }));
    }
}

export default new RecordingProcessManager();
