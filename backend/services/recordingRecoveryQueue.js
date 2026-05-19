// Purpose: Generic bounded-concurrency promise queue keyed by string identifier.
//          Handles dedup, in-flight tracking, pump loop, and drain.
// Caller: recordingRecoveryService (wires the queue around recordingRecoveryRunner.runRecovery).
// Deps: None.
// MainFuncs: createRecordingRecoveryQueue → { enqueue, isOwned, drain, getStats }.
// SideEffects: Calls the injected runJob(input) callback; no I/O of its own.

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_DRAIN_POLL_MS = 25;

export function createRecordingRecoveryQueue({
    runJob,
    keyFn,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    drainPollMs = DEFAULT_DRAIN_POLL_MS,
} = {}) {
    if (typeof runJob !== 'function') {
        throw new Error('recordingRecoveryQueue requires runJob(input) callback');
    }
    if (typeof keyFn !== 'function') {
        throw new Error('recordingRecoveryQueue requires keyFn(input) → string');
    }

    const queue = [];
    const queuedKeys = new Set();
    const inFlight = new Map(); // key → Promise
    const pendingPromises = new Map(); // key → { promise, resolve }
    let activeCount = 0;

    function startJob(input) {
        const key = keyFn(input);
        if (inFlight.has(key)) {
            return inFlight.get(key);
        }
        // Call runJob synchronously so callers that mock the underlying ffmpeg/finalizer
        // see the call within the same microtask the enqueue happened in (matches the
        // pre-refactor behavior the recordingService tests depend on).
        let promise;
        try {
            promise = Promise.resolve(runJob(input));
        } catch (error) {
            promise = Promise.reject(error);
        }
        promise = promise.finally(() => {
            inFlight.delete(key);
        });
        inFlight.set(key, promise);
        return promise;
    }

    function pump() {
        while (activeCount < maxConcurrent && queue.length > 0) {
            const job = queue.shift();
            queuedKeys.delete(job.key);
            const pending = pendingPromises.get(job.key);
            pendingPromises.delete(job.key);
            activeCount += 1;
            startJob(job.input)
                .then((result) => pending?.resolve(result))
                .catch((error) => pending?.resolve({
                    success: false,
                    terminal: false,
                    reason: error?.message || 'recovery_exception',
                }))
                .finally(() => {
                    activeCount -= 1;
                    pump();
                });
        }
    }

    function enqueue(input) {
        const key = keyFn(input);
        if (inFlight.has(key)) {
            return inFlight.get(key);
        }
        if (pendingPromises.has(key)) {
            return pendingPromises.get(key).promise;
        }

        let resolveFn;
        const promise = new Promise((resolve) => {
            resolveFn = resolve;
        });
        pendingPromises.set(key, { promise, resolve: resolveFn });
        queuedKeys.add(key);
        queue.push({ key, input });
        pump();
        return promise;
    }

    function isOwned(key) {
        return queuedKeys.has(key) || inFlight.has(key);
    }

    async function drain(timeoutMs = 30000) {
        const deadline = Date.now() + timeoutMs;
        while (queue.length > 0 || activeCount > 0 || inFlight.size > 0) {
            if (Date.now() > deadline) {
                throw new Error('recordingRecoveryQueue.drain timeout');
            }
            await new Promise((resolve) => setTimeout(resolve, drainPollMs));
        }
    }

    function getStats() {
        return {
            queueLength: queue.length,
            inFlightCount: inFlight.size,
            activeCount,
            maxConcurrent,
        };
    }

    return { enqueue, isOwned, drain, getStats };
}
