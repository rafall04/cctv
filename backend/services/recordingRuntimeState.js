// Purpose: Store runtime-only recording process state with explicit lifecycle transitions.
// Caller: recordingProcessManager and recordingService health coordination.
// Deps: None.
// MainFuncs: RecordingRuntimeState.
// SideEffects: Mutates in-memory state only.

export class RecordingRuntimeState {
    constructor() {
        this.records = new Map();
        this.restartLocks = new Set();
        this.shutdownInFlight = false;
    }

    setActive(cameraId, { process, streamSource, startedAt = new Date(), camera = null }) {
        const record = {
            cameraId,
            process,
            pid: process?.pid ?? null,
            camera,
            streamSource,
            status: 'recording',
            startedAt,
            lastDataAt: Date.now(),
            stopReason: null,
            stopStartedAt: null,
            restartInFlight: this.restartLocks.has(cameraId),
            shutdownInFlight: this.shutdownInFlight,
            forcedKill: false,
            lastExitCode: null,
            lastExitSignal: null,
        };
        this.records.set(cameraId, record);
        return record;
    }

    get(cameraId) {
        return this.records.get(cameraId) ?? null;
    }

    has(cameraId) {
        return this.records.has(cameraId);
    }

    entries() {
        return this.records.entries();
    }

    activeCameraIds() {
        return [...this.records.keys()];
    }

    updateLastDataAt(cameraId, now = Date.now()) {
        const record = this.get(cameraId);
        if (record) {
            record.lastDataAt = now;
        }
        return record;
    }

    markStopping(cameraId, stopReason, stopStartedAt = new Date()) {
        const record = this.get(cameraId);
        if (!record) {
            return null;
        }
        record.status = 'stopping';
        record.stopReason = stopReason;
        record.stopStartedAt = stopStartedAt;
        record.shutdownInFlight = this.shutdownInFlight;
        return record;
    }

    markForcedKill(cameraId) {
        const record = this.get(cameraId);
        if (record) {
            record.forcedKill = true;
        }
        return record;
    }

    markExited(cameraId, { exitCode, exitSignal }) {
        const record = this.get(cameraId);
        if (!record) {
            return null;
        }
        record.lastExitCode = exitCode;
        record.lastExitSignal = exitSignal;
        record.status = 'exited';
        return record;
    }

    remove(cameraId) {
        this.records.delete(cameraId);
        this.restartLocks.delete(cameraId);
    }

    tryBeginRestart(cameraId) {
        if (this.restartLocks.has(cameraId)) {
            return false;
        }
        this.restartLocks.add(cameraId);
        const record = this.get(cameraId);
        if (record) {
            record.restartInFlight = true;
        }
        return true;
    }

    endRestart(cameraId) {
        this.restartLocks.delete(cameraId);
        const record = this.get(cameraId);
        if (record) {
            record.restartInFlight = false;
        }
    }

    beginShutdown() {
        this.shutdownInFlight = true;
        for (const record of this.records.values()) {
            record.shutdownInFlight = true;
        }
    }
}
