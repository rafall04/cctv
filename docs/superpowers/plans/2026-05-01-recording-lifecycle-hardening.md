# Recording Lifecycle Hardening Implementation Plan

> Execution order note: this plan is still valid, but cross-plan priority and missing integrity work are now coordinated by `docs/superpowers/plans/2026-05-03-recording-stabilization-priority-plan.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CCTV FFmpeg recording stop, restart, and shutdown lifecycle safe, awaitable, and correctly classified so controlled exits do not corrupt active segments or appear as camera crashes.

**Architecture:** Keep `recordingService.js` as the public facade while extracting FFmpeg process ownership into focused modules. `server.js` becomes the only process-signal orchestrator and calls `recordingService.shutdown()` before DB close.

**Tech Stack:** Node.js 20 ES modules, Fastify, Vitest, child_process `spawn`, SQLite via existing connection pool.

---

Purpose: Provide a task-by-task execution plan for the approved recording lifecycle hardening design.
Caller: Agentic implementation worker after human approval.
Deps: `docs/superpowers/specs/2026-05-01-recording-lifecycle-hardening-design.md`, `backend/services/recordingService.js`, `backend/server.js`, Vitest.
MainFuncs: Define exact files, tests, implementation order, verification commands, and commit boundaries.
SideEffects: Documentation only until executed; implementation will change backend recording lifecycle behavior.

## File Structure

- Create `backend/services/recordingFailureClassifier.js`: classify FFmpeg exits from output, code, signal, stream source, and stop reason.
- Create `backend/__tests__/recordingFailureClassifier.test.js`: focused classifier tests.
- Create `backend/services/recordingRuntimeState.js`: small runtime state container for active recordings and stop/restart flags.
- Create `backend/__tests__/recordingRuntimeState.test.js`: state transition tests.
- Create `backend/services/recordingProcessManager.js`: only module that owns FFmpeg child process lifecycle.
- Create `backend/__tests__/recordingProcessManager.test.js`: stop/restart/shutdown tests with mocked child processes.
- Modify `backend/services/recordingService.js`: remove module-level process signal handlers, delegate spawn/stop/restart/shutdown to process manager, preserve existing facade API.
- Modify `backend/__tests__/recordingService.test.js`: update lifecycle tests to assert safe delegation and no crash classification on intentional exits.
- Modify `backend/server.js`: call `await recordingService.shutdown()` before DB close and guard shutdown re-entry.
- Create `backend/__tests__/serverShutdown.test.js` only if direct `server.js` import can be isolated without starting the HTTP server; otherwise verify shutdown order with a focused exported helper task below.

## Task 1: Failure Classifier

**Files:**
- Create: `backend/services/recordingFailureClassifier.js`
- Create: `backend/__tests__/recordingFailureClassifier.test.js`

- [ ] **Step 1: Write the failing classifier tests**

Create `backend/__tests__/recordingFailureClassifier.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { classifyRecordingExit } from '../services/recordingFailureClassifier.js';

describe('recordingFailureClassifier', () => {
    it('classifies manual stop with ffmpeg code 255 as intentional_stop', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Immediate exit requested\nExiting normally, received signal 2.',
            exitCode: 255,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: 'manual_stop',
        })).toBe('intentional_stop');
    });

    it('classifies server shutdown signal output as intentional_shutdown', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Error writing trailer: Immediate exit requested\nreceived signal 2',
            exitCode: 255,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: 'server_shutdown',
        })).toBe('intentional_shutdown');
    });

    it('classifies restart stop as restart_requested', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Exiting normally, received signal 15.',
            exitCode: 255,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: 'stream_frozen_restart',
        })).toBe('restart_requested');
    });

    it('preserves upstream and source classifications for unknown exits', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Connection timed out',
            exitCode: 1,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: null,
        })).toBe('upstream_unreachable');

        expect(classifyRecordingExit({
            ffmpegOutput: 'Invalid data found when processing input',
            exitCode: 1,
            exitSignal: null,
            streamSource: 'external',
            stopReason: null,
        })).toBe('unsupported_playlist');
    });

    it('falls back to ffmpeg_failed for unknown non-zero exits', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'muxer failed unexpectedly',
            exitCode: 1,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: null,
        })).toBe('ffmpeg_failed');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- recordingFailureClassifier.test.js
```

Expected: fail because `recordingFailureClassifier.js` does not exist.

- [ ] **Step 3: Implement classifier**

Create `backend/services/recordingFailureClassifier.js`:

```javascript
// Purpose: Classify FFmpeg recording exits into operator-meaningful lifecycle/failure reasons.
// Caller: recordingProcessManager and recordingService close handlers.
// Deps: None.
// MainFuncs: classifyRecordingExit.
// SideEffects: None.

const INTENTIONAL_STOP_REASONS = new Set([
    'manual_stop',
    'camera_disabled',
    'camera_offline',
]);

const SHUTDOWN_REASONS = new Set([
    'server_shutdown',
    'process_shutdown',
]);

const RESTART_REASONS = new Set([
    'stream_frozen_restart',
    'health_restart',
    'manual_restart',
]);

export function classifyRecordingExit({
    ffmpegOutput = '',
    exitCode = null,
    exitSignal = null,
    streamSource = 'internal',
    stopReason = null,
} = {}) {
    if (SHUTDOWN_REASONS.has(stopReason)) {
        return 'intentional_shutdown';
    }

    if (RESTART_REASONS.has(stopReason)) {
        return 'restart_requested';
    }

    if (INTENTIONAL_STOP_REASONS.has(stopReason)) {
        return 'intentional_stop';
    }

    const output = String(ffmpegOutput).toLowerCase();
    const signaled = exitSignal || output.includes('received signal') || output.includes('immediate exit requested');

    if (signaled && stopReason) {
        return stopReason === 'server_shutdown' ? 'intentional_shutdown' : 'intentional_stop';
    }

    if (output.includes('http error 403') || output.includes('forbidden') || output.includes('access denied')) {
        return 'upstream_unreachable';
    }
    if (output.includes('404 not found') || output.includes('server returned 404')) {
        return 'upstream_unreachable';
    }
    if (output.includes('connection refused') || output.includes('connection timed out') || output.includes('timed out')) {
        return 'upstream_unreachable';
    }
    if (streamSource === 'external' && (output.includes('invalid data found') || output.includes('failed to open segment') || output.includes('error when loading first segment'))) {
        return 'unsupported_playlist';
    }
    if (output.includes('invalid argument') || output.includes('protocol not found') || output.includes('no such file or directory')) {
        return 'invalid_source';
    }

    return exitCode === 0 && !exitSignal ? 'intentional_stop' : 'ffmpeg_failed';
}
```

- [ ] **Step 4: Run classifier tests**

Run:

```bash
cd backend && npm test -- recordingFailureClassifier.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingFailureClassifier.js backend/__tests__/recordingFailureClassifier.test.js
git commit -m "Add: recording failure classifier"
```

## Task 2: Runtime State Container

**Files:**
- Create: `backend/services/recordingRuntimeState.js`
- Create: `backend/__tests__/recordingRuntimeState.test.js`

- [ ] **Step 1: Write runtime state tests**

Create `backend/__tests__/recordingRuntimeState.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { RecordingRuntimeState } from '../services/recordingRuntimeState.js';

describe('RecordingRuntimeState', () => {
    it('tracks active process metadata and stop intent', () => {
        const state = new RecordingRuntimeState();
        const process = { pid: 1234 };

        state.setActive(5, { process, streamSource: 'internal', startedAt: new Date('2026-05-01T00:00:00.000Z') });
        state.markStopping(5, 'server_shutdown', new Date('2026-05-01T00:00:01.000Z'));

        expect(state.get(5)).toMatchObject({
            cameraId: 5,
            pid: 1234,
            status: 'stopping',
            stopReason: 'server_shutdown',
            forcedKill: false,
        });
    });

    it('prevents overlapping restarts with a per-camera lock', () => {
        const state = new RecordingRuntimeState();

        expect(state.tryBeginRestart(7)).toBe(true);
        expect(state.tryBeginRestart(7)).toBe(false);

        state.endRestart(7);
        expect(state.tryBeginRestart(7)).toBe(true);
    });

    it('records exit facts before clearing active state', () => {
        const state = new RecordingRuntimeState();
        state.setActive(9, { process: { pid: 999 }, streamSource: 'internal' });

        state.markForcedKill(9);
        state.markExited(9, { exitCode: 255, exitSignal: null });

        expect(state.get(9)).toMatchObject({
            forcedKill: true,
            lastExitCode: 255,
            lastExitSignal: null,
        });

        state.remove(9);
        expect(state.get(9)).toBe(null);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- recordingRuntimeState.test.js
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement runtime state**

Create `backend/services/recordingRuntimeState.js`:

```javascript
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
```

- [ ] **Step 4: Run runtime state tests**

Run:

```bash
cd backend && npm test -- recordingRuntimeState.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingRuntimeState.js backend/__tests__/recordingRuntimeState.test.js
git commit -m "Add: recording runtime state"
```

## Task 3: Process Manager Lifecycle

**Files:**
- Create: `backend/services/recordingProcessManager.js`
- Create: `backend/__tests__/recordingProcessManager.test.js`

- [ ] **Step 1: Write process manager tests**

Create `backend/__tests__/recordingProcessManager.test.js`:

```javascript
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
    spawn: spawnMock,
}));

function createProcess(pid = 1000) {
    const process = new EventEmitter();
    process.pid = pid;
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    process.kill = vi.fn();
    return process;
}

describe('RecordingProcessManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('awaits close when stopping an active recording', async () => {
        const child = createProcess(111);
        spawnMock.mockReturnValue(child);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 5000 });

        await manager.start(1, {
            ffmpegArgs: ['-i', 'rtsp://camera'],
            camera: { id: 1 },
            streamSource: 'internal',
        });

        const stopPromise = manager.stop(1, 'manual_stop');
        expect(child.kill).toHaveBeenCalledWith('SIGINT');

        child.emit('close', 255, null);
        await expect(stopPromise).resolves.toMatchObject({
            cameraId: 1,
            reason: 'intentional_stop',
            forcedKill: false,
        });
        expect(manager.getStatus(1)).toEqual({ isRecording: false, status: 'stopped' });
    });

    it('sends SIGKILL after graceful timeout', async () => {
        const child = createProcess(222);
        spawnMock.mockReturnValue(child);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 1000 });

        await manager.start(2, {
            ffmpegArgs: ['-i', 'rtsp://camera'],
            camera: { id: 2 },
            streamSource: 'internal',
        });

        const stopPromise = manager.stop(2, 'server_shutdown');
        await vi.advanceTimersByTimeAsync(1000);
        expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');

        child.emit('close', null, 'SIGKILL');
        await expect(stopPromise).resolves.toMatchObject({
            cameraId: 2,
            reason: 'intentional_shutdown',
            forcedKill: true,
        });
    });

    it('serializes restart until the old process closes', async () => {
        const first = createProcess(333);
        const second = createProcess(444);
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 5000 });
        const config = {
            ffmpegArgs: ['-i', 'rtsp://camera'],
            camera: { id: 3 },
            streamSource: 'internal',
        };

        await manager.start(3, config);
        const restartPromise = manager.restart(3, 'stream_frozen', config);

        expect(first.kill).toHaveBeenCalledWith('SIGINT');
        expect(spawnMock).toHaveBeenCalledTimes(1);

        first.emit('close', 255, null);
        await restartPromise;

        expect(spawnMock).toHaveBeenCalledTimes(2);
        expect(manager.getStatus(3)).toMatchObject({ isRecording: true, pid: 444 });
    });

    it('shuts down all active recordings and waits for close events', async () => {
        const first = createProcess(555);
        const second = createProcess(666);
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 5000 });

        await manager.start(5, { ffmpegArgs: ['a'], camera: { id: 5 }, streamSource: 'internal' });
        await manager.start(6, { ffmpegArgs: ['b'], camera: { id: 6 }, streamSource: 'internal' });

        const shutdownPromise = manager.shutdownAll('server_shutdown');
        first.emit('close', 255, null);
        second.emit('close', 255, null);

        await expect(shutdownPromise).resolves.toHaveLength(2);
        expect(manager.getActiveCameraIds()).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- recordingProcessManager.test.js
```

Expected: fail because the process manager does not exist.

- [ ] **Step 3: Implement process manager**

Create `backend/services/recordingProcessManager.js`:

```javascript
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
    }

    async start(cameraId, { ffmpegArgs, camera, streamSource }) {
        if (this.state.has(cameraId)) {
            return { success: false, message: 'Already recording' };
        }

        const child = spawn(this.binary, ffmpegArgs);
        this.state.setActive(cameraId, { process: child, camera, streamSource });
        this.outputBuffers.set(cameraId, []);

        child.stdout.on('data', () => {
            this.state.updateLastDataAt(cameraId);
        });

        child.stderr.on('data', (data) => {
            this.state.updateLastDataAt(cameraId);
            const chunks = this.outputBuffers.get(cameraId);
            if (chunks) {
                chunks.push(data.toString());
                if (chunks.length > 50) {
                    chunks.shift();
                }
            }
        });

        child.on('close', (exitCode, exitSignal) => {
            this.handleClose(cameraId, exitCode, exitSignal);
        });

        child.on('error', (error) => {
            const chunks = this.outputBuffers.get(cameraId) ?? [];
            chunks.push(error.message);
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

    getOutput(cameraId) {
        return (this.outputBuffers.get(cameraId) ?? []).join('');
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

        const waiters = this.closeWaiters.get(cameraId) ?? [];
        this.closeWaiters.delete(cameraId);
        this.outputBuffers.delete(cameraId);
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
```

- [ ] **Step 4: Run process manager tests**

Run:

```bash
cd backend && npm test -- recordingProcessManager.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingProcessManager.js backend/__tests__/recordingProcessManager.test.js
git commit -m "Add: recording process manager"
```

## Task 4: Facade Integration In `recordingService.js`

**Files:**
- Modify: `backend/services/recordingService.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add integration tests for intentional exits and shutdown**

In `backend/__tests__/recordingService.test.js`, add these tests before the final `});` of the existing `describe` block:

```javascript
    it('does not mark intentional stop exit as ffmpeg_failed', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const child = createSpawnProcess();
        child.pid = 707;
        spawnMock.mockReturnValue(child);
        queryOneMock.mockReturnValue(createCamera({ id: 70 }));

        await recordingService.startRecording(70);
        const stopPromise = recordingService.stopRecording(70);
        child.emit('close', 255, null);

        await expect(stopPromise).resolves.toMatchObject({ success: true });
        expect(executeMock).toHaveBeenCalledWith(
            'UPDATE cameras SET recording_status = ? WHERE id = ?',
            ['stopped', 70]
        );
    });

    it('stops all active recordings during service shutdown', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const first = createSpawnProcess();
        const second = createSpawnProcess();
        first.pid = 801;
        second.pid = 802;
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        queryOneMock.mockImplementation((sql, params) => createCamera({ id: params?.[0] ?? 1 }));

        await recordingService.startRecording(81);
        await recordingService.startRecording(82);

        const shutdownPromise = recordingService.shutdown();
        expect(first.kill).toHaveBeenCalledWith('SIGINT');
        expect(second.kill).toHaveBeenCalledWith('SIGINT');

        first.emit('close', 255, null);
        second.emit('close', 255, null);

        await expect(shutdownPromise).resolves.toHaveLength(2);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && npm test -- recordingService.test.js -t "intentional stop|service shutdown"
```

Expected: fail because `stopRecording()` currently deletes state immediately and `shutdown()` does not exist.

- [ ] **Step 3: Update imports and remove module-level signal cleanup**

In `backend/services/recordingService.js`, replace the child process import and add the process manager import:

```javascript
import { spawn } from 'child_process';
```

with:

```javascript
import recordingProcessManager from './recordingProcessManager.js';
```

Delete the module-level cleanup block currently registering `process.on('exit')`, `process.on('SIGINT')`, and `process.on('SIGTERM')`.

- [ ] **Step 4: Delegate start process ownership**

In `startRecording(cameraId)`, keep camera lookup, source resolution, directory creation, FFmpeg args, and DB status update. Replace direct `spawn('ffmpeg', ffmpegArgs)`, process event wiring, and `activeRecordings.set(...)` with:

```javascript
            const startResult = await recordingProcessManager.start(cameraId, {
                ffmpegArgs,
                camera,
                streamSource: sourceConfig.streamSource,
            });

            if (!startResult.success) {
                return startResult;
            }
```

Then keep:

```javascript
            this.markRecordingRecovered(cameraId, Date.now());
            execute(
                'UPDATE cameras SET recording_status = ?, last_recording_start = ? WHERE id = ?',
                ['recording', new Date().toISOString(), cameraId]
            );
```

If segment completion detection currently depends on FFmpeg stderr in `recordingService.js`, add a callback option to process manager before committing this task:

```javascript
onStderr: (output) => this.handleRecordingStderr(cameraId, output),
onClose: (result) => this.handleRecordingClosed(cameraId, result),
```

and implement those callback hooks in `recordingProcessManager.start()`.

- [ ] **Step 5: Delegate stop/restart/shutdown**

Replace `stopRecording(cameraId, options = {})` internals with:

```javascript
    async stopRecording(cameraId, options = {}) {
        try {
            const shouldRemoveHealthState = options.removeHealthState !== false;
            const reason = options.reason ?? 'manual_stop';
            const activeStatus = recordingProcessManager.getStatus(cameraId);

            if (!activeStatus.isRecording && activeStatus.status === 'stopped') {
                return { success: false, message: 'Not recording' };
            }

            await recordingProcessManager.stop(cameraId, reason);

            if (shouldRemoveHealthState) {
                this.clearRuntimeHealthState(cameraId);
            }

            execute(
                'UPDATE cameras SET recording_status = ? WHERE id = ?',
                ['stopped', cameraId]
            );

            console.log(`Stopped recording for camera ${cameraId}`);
            return { success: true, message: 'Recording stopped' };
        } catch (error) {
            console.error(`Error stopping recording for camera ${cameraId}:`, error);
            return { success: false, message: error.message };
        }
    }
```

Update `restartRecording(cameraId, reason = 'manual')` to call:

```javascript
        await this.stopRecording(cameraId, {
            removeHealthState: reason === 'manual',
            reason: reason === 'manual' ? 'manual_restart' : `${reason}_restart`,
        });
```

Add this method to the class:

```javascript
    async shutdown() {
        this.isShuttingDown = true;
        return recordingProcessManager.shutdownAll('server_shutdown');
    }
```

Initialize `this.isShuttingDown = false;` in the constructor.

- [ ] **Step 6: Prevent health restart during shutdown**

At the start of `tickHealthMonitoring(now = Date.now())`, add:

```javascript
        if (this.isShuttingDown) {
            return;
        }
```

- [ ] **Step 7: Run recording service tests**

Run:

```bash
cd backend && npm test -- recordingService.test.js
```

Expected: pass. If tests reveal segment callbacks broke, restore segment detection through process manager callbacks before moving on.

- [ ] **Step 8: Commit**

```bash
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Fix: delegate recording process lifecycle"
```

## Task 5: Server Shutdown Orchestration

**Files:**
- Modify: `backend/server.js`

- [ ] **Step 1: Add shutdown re-entry guard**

In `backend/server.js`, before `const shutdown = async () => {`, add:

```javascript
let shutdownInProgress = false;
```

At the start of `shutdown`, add:

```javascript
    if (shutdownInProgress) {
        return;
    }
    shutdownInProgress = true;
```

- [ ] **Step 2: Stop recording before DB close**

In the shutdown function, after background services stop and before `console.log('[Shutdown] Closing database connections...');`, insert:

```javascript
        console.log('[Shutdown] Stopping active recordings...');
        try {
            const results = await recordingService.shutdown();
            console.log(`[Shutdown] Stopped ${results.length} active recording processes`);
        } catch (error) {
            console.error('[Shutdown] Recording cleanup error:', error.message);
        }
```

Expected location: after playback viewer session cleanup and before DB connection close.

- [ ] **Step 3: Remove duplicate service signal ownership**

Confirm this command returns no `process.on` registrations in recording service:

```bash
cd backend && node -e "import('node:fs').then(fs=>fs.readFileSync('services/recordingService.js','utf8')).then(s=>{ if (/process\\.on\\(/.test(s)) process.exit(1); })"
```

Expected: exit code `0`.

- [ ] **Step 4: Run shutdown-adjacent tests**

Run:

```bash
cd backend && npm test -- recordingService.test.js recordingProcessManager.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/server.js backend/services/recordingService.js
git commit -m "Fix: centralize recording shutdown orchestration"
```

## Task 6: Full Verification

**Files:**
- No planned file changes.

- [ ] **Step 1: Run targeted lifecycle tests**

Run:

```bash
cd backend && npm test -- recordingFailureClassifier.test.js recordingRuntimeState.test.js recordingProcessManager.test.js recordingService.test.js
```

Expected: all pass.

- [ ] **Step 2: Run full backend test suite**

Run:

```bash
cd backend && npm test
```

Expected: all pass. If unrelated pre-existing tests fail, capture exact failures and do not claim full pass.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff -- backend/services/recordingFailureClassifier.js backend/services/recordingRuntimeState.js backend/services/recordingProcessManager.js backend/services/recordingService.js backend/server.js backend/__tests__/recordingFailureClassifier.test.js backend/__tests__/recordingRuntimeState.test.js backend/__tests__/recordingProcessManager.test.js backend/__tests__/recordingService.test.js
```

Expected: only lifecycle-related files changed.

- [ ] **Step 4: Commit remaining verification-only fixes if any**

Only if Task 6 required small test or lint corrections:

```bash
git add <exact-files>
git commit -m "Fix: stabilize recording lifecycle tests"
```

- [ ] **Step 5: Push**

Run:

```bash
git push origin main
```

Expected: push succeeds.

## Execution Notes

- Do not use `git add .` because this repository currently contains unrelated modified and untracked files.
- Do not change FFmpeg segment format, retention, playback APIs, or database schema in this implementation.
- Keep every runtime file header synchronized with Purpose, Caller, Deps, MainFuncs, and SideEffects.
- If `recordingService.js` becomes too risky to patch in one task, split Task 4 into two commits: start delegation first, stop/restart/shutdown delegation second.
