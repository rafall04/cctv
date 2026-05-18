// Purpose: Own recording maintenance loop scheduling with per-task telemetry.
// Caller: backend/server.js startup/shutdown and recordingService.initializeBackgroundWork.
// Deps: None.
// MainFuncs: register, start, stop, isRunning, getTaskStats.
// SideEffects: Owns recursive setTimeout handles for each registered task.

class RecordingScheduler {
    constructor() {
        this.tasks = new Map();
        this.timeouts = new Set();
        this.running = false;
    }

    register({ name, task, intervalMs, initialDelayMs = intervalMs } = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('scheduler.register requires a non-empty name');
        }
        if (typeof task !== 'function') {
            throw new Error(`scheduler.register('${name}') requires a function task`);
        }
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            throw new Error(`scheduler.register('${name}') requires positive intervalMs`);
        }

        this.tasks.set(name, {
            name,
            task,
            intervalMs,
            initialDelayMs,
            stats: {
                runCount: 0,
                lastRunAt: null,
                lastDurationMs: null,
                lastError: null,
            },
        });

        if (this.running) {
            this._scheduleNext(name, initialDelayMs);
        }
    }

    start() {
        if (this.running) {
            return;
        }
        this.running = true;
        for (const [name, entry] of this.tasks) {
            this._scheduleNext(name, entry.initialDelayMs);
        }
    }

    stop() {
        this.running = false;
        for (const timeoutId of this.timeouts) {
            clearTimeout(timeoutId);
        }
        this.timeouts.clear();
    }

    isRunning() {
        return this.running;
    }

    getTaskStats(name) {
        const entry = this.tasks.get(name);
        return entry ? { ...entry.stats, name, intervalMs: entry.intervalMs } : null;
    }

    getAllStats() {
        return [...this.tasks.values()].map((entry) => ({
            name: entry.name,
            intervalMs: entry.intervalMs,
            ...entry.stats,
        }));
    }

    _scheduleNext(name, delayMs) {
        if (!this.running) {
            return;
        }

        let timeoutId = null;
        const runCycle = async () => {
            this.timeouts.delete(timeoutId);
            if (!this.running) {
                return;
            }

            const entry = this.tasks.get(name);
            if (!entry) {
                return;
            }

            const startedAt = Date.now();
            try {
                await entry.task();
                entry.stats.lastError = null;
            } catch (error) {
                entry.stats.lastError = error?.message || String(error);
                console.error(`[RecordingScheduler] Task '${name}' failed:`, error);
            } finally {
                entry.stats.lastRunAt = startedAt;
                entry.stats.lastDurationMs = Date.now() - startedAt;
                entry.stats.runCount += 1;
                this._scheduleNext(name, entry.intervalMs);
            }
        };

        timeoutId = setTimeout(runCycle, delayMs);
        this.timeouts.add(timeoutId);
    }
}

export default new RecordingScheduler();
export { RecordingScheduler };
