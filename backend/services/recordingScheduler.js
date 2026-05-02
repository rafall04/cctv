// Purpose: Own recording scanner and cleanup timer lifecycle outside the recording facade.
// Caller: backend/server.js startup and shutdown orchestration, recordingService compatibility hooks.
// Deps: injected callbacks for scanner, background cleanup, and scheduled cleanup work.
// MainFuncs: start, stop, registerTimeout, isRunning.
// SideEffects: Starts and clears recursive timers for recording maintenance loops.

class RecordingScheduler {
    constructor() {
        this.timeouts = new Set();
        this.running = false;
    }

    start(tasks = {}) {
        if (this.running) {
            return;
        }

        this.running = true;
        const scheduleTimeout = (callback, delayMs) => {
            if (!this.running) {
                return null;
            }

            let timeoutId = null;
            const wrappedCallback = async () => {
                this.timeouts.delete(timeoutId);
                if (!this.running) {
                    return;
                }
                await callback();
            };

            timeoutId = setTimeout(wrappedCallback, delayMs);
            this.timeouts.add(timeoutId);
            return timeoutId;
        };

        tasks.startSegmentScanner?.(scheduleTimeout);
        tasks.startBackgroundCleanup?.(scheduleTimeout);
        tasks.startScheduledCleanup?.(scheduleTimeout);
    }

    stop() {
        this.running = false;
        for (const timeoutId of this.timeouts) {
            clearTimeout(timeoutId);
        }
        this.timeouts.clear();
    }

    registerTimeout(timeoutId) {
        if (timeoutId) {
            this.timeouts.add(timeoutId);
        }
        return timeoutId;
    }

    isRunning() {
        return this.running;
    }
}

export default new RecordingScheduler();
