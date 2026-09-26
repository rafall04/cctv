/*
 * Purpose: Collapse parallel identical GETs into one in-flight promise.
 * Caller: Public read services (cameraService.getActiveCameras, areaService.getPublicAreas).
 * Deps: none.
 * MainFuncs: dedupeInflight.
 * SideEffects: Holds pending promises in a module-scope map until they settle.
 *
 * Why module scope: CameraProvider already dedupes refreshes through an instance ref, but a
 * provider instance that React abandons mid-commit (concurrent render) keeps its timers and
 * listeners alive — so the landing page can end up firing the same pair of GETs twice on every
 * 30s tick. Instance-level dedupe cannot see across that boundary; a module-level map can.
 * Only the IN-FLIGHT window is shared — nothing is cached after settle, so refresh cadence
 * and error semantics are unchanged.
 */

const inflight = new Map();

/**
 * Run `fn` once per `key` while its promise is pending; concurrent callers share the result.
 * @param {string} key distinguishes policy variants (e.g. blocking vs background request config)
 * @param {() => Promise<*>} fn performs the fetch
 * @returns {Promise<*>}
 */
export function dedupeInflight(key, fn) {
    const pending = inflight.get(key);
    if (pending) {
        return pending;
    }
    const promise = Promise.resolve().then(fn);
    inflight.set(key, promise);
    const clear = () => inflight.delete(key);
    // Both branches clear without rethrowing, so the derived promise resolves quietly —
    // rejection handling stays the caller's job.
    promise.then(clear, clear);
    return promise;
}

/** Test seam: drop all pending dedupe entries so each test starts clean. */
export function resetInflightDedupe() {
    inflight.clear();
}
