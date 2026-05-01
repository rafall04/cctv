// Purpose: Own FFmpeg child process lifecycle for CCTV recording.
// Caller: recordingService facade.
// Deps: child_process spawn, recordingRuntimeState, recordingFailureClassifier.
// MainFuncs: RecordingProcessManager.start, stop, restart, shutdownAll, getStatus.
// SideEffects: Spawns and stops FFmpeg child processes; writes lifecycle logs.

import { spawn } from 'child_process';
import { RecordingRuntimeState } from './recordingRuntimeState.js';
import { classifyRecordingExit } from './recordingFailureClassifier.js';

export class RecordingProcessManager {
    constructor({ gracefulStopTimeoutMs = 10000, binary = 'ffmpeg' } = {}) {
        this.binary = binary;
        this.gracefulStopTimeoutMs = gracefulStopTimeoutMs;
        this.state = new RecordingRuntimeState();
        this.outputBuffers = new Map();
        this.closeWaiters = new Map();
        this.callbacks = new Map();
    }

    async start(cameraId, { ffmpegArgs, camera, streamSource, onStdout, onStderr, onClose, onError }) {
        if (this.state.has(cameraId)) {
            return { success: false, message: 'Already recording' };
        }

        const child = spawn(this.binary, ffmpegArgs);
        this.state.setActive(cameraId, { process: child, camera, streamSource });
        this.outputBuffers.set(cameraId, []);
        this.callbacks.set(cameraId, { onStdout, onStderr, onClose, onError });

        child.stdout.on('data', (data) => {
            this.state.updateLastDataAt(cameraId);
            onStdout?.(data);
        });

        child.stderr.on('data', (data) => {
            const output = data.toString();
            this.state.updateLastDataAt(cameraId);
            this.pushOutput(cameraId, output);
            onStderr?.(output);
        });

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

    async stop(cameraId, reason = 'manual_stop', { signal = 'SIGINT', timeoutMs = this.gracefulStopTimeoutMs } = {}) {
        const record = this.state.get(cameraId);
        if (!record) {
            return { cameraId, reason: 'not_recording', forcedKill: false };
        }

        this.state.markStopping(cameraId, reason);
        const closePromise = this.waitForClose(cameraId);
        record.process.kill(signal);
        this.logLifecycle(cameraId, 'stop_signal', { pid: record.pid, reason, signal });

        const timeout = setTimeout(() => {
            const latest = this.state.get(cameraId);
            if (latest && latest.status !== 'exited') {
                this.state.markForcedKill(cameraId);
                latest.process.kill('SIGKILL');
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

    async shutdownAll(reason = 'server_shutdown') {
        this.state.beginShutdown();
        const stops = this.getActiveCameraIds().map((cameraId) => this.stop(cameraId, reason));
        return Promise.all(stops);
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

    pushOutput(cameraId, output) {
        const chunks = this.outputBuffers.get(cameraId);
        if (!chunks) {
            return;
        }
        chunks.push(output);
        if (chunks.length > 50) {
            chunks.shift();
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
            ffmpegOutput: this.getOutput(cameraId),
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
