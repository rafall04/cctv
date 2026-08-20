/*
Purpose: Collapse duplicate affiliate impression/click counts coming from ONE viewer into a single
         count per short window, using a BOUNDED in-memory store.
Caller: controllers/affiliateController.js (public offer resolve + the /go redirector).
Deps: none (deliberately dependency-free so it is trivially unit-testable).
MainFuncs: allowCount, _resetThrottleForTests, throttleSize.
SideEffects: One module-level Map, hard-capped at MAX_THROTTLE_KEYS. No timers, no I/O, no DB.

WHY THIS EXISTS AT ALL (AND WHY IT COVERS IMPRESSIONS, NOT ONLY CLICKS)
----------------------------------------------------------------------
The obvious version of this feature counts every request to the resolve endpoint as one
impression and every /go hit as one click. Both numbers would be wrong on day one:

  * frontend/src/services/apiClient.js REPLAYS a failed GET twice (NETWORK_RETRY_DELAYS_MS,
    400ms then 1200ms, GET/HEAD only). One viewer on a flaky mobile link therefore produces up
    to THREE resolve requests for a single rendered card. A partner paying for placement would
    be shown inflated impressions that no one can reconcile.
  * A /go URL is a plain GET on a public domain. Anything can hit it repeatedly.

So the throttle is applied to impressions AND clicks. The window is deliberately longer than the
retry ladder (1.6s total) with room to spare: 10s.

WHY THE STORE IS CAPPED AND SWEPT INSTEAD OF A BARE `new Map()`
---------------------------------------------------------------
The key contains the client IP, and the endpoints are public and unauthenticated. A bare Map
keyed on attacker-chosen identity is an unbounded allocation the caller cannot see — the process
just grows until pm2 restarts it. This is the same failure the HLS proxy already designed around:
services/hlsProxyService.js caps every FixedWindowLimiter at `maxLimiterKeys: 5000` and sweeps
expired entries. The shape here is copied from that class on purpose (windowStart + lastSeen,
LRU eviction by lastSeen, plus a sweep) so the two behave alike under load.

WHY THERE IS NO setInterval
---------------------------
hlsProxyService can own a timer because it has a start()/stop() lifecycle. A util imported by a
controller has none: a module-level interval would start at import time, keep the event loop
alive (hanging vitest runs), and never be cleared. Instead the sweep is amortised onto calls —
at most once per SWEEP_INTERVAL_MS. Between sweeps the hard cap is what bounds memory, and the
cap alone is sufficient; the sweep only exists so that a quiet period releases memory rather
than holding 5000 dead keys forever.
*/

/** How long one identity+event pair is collapsed into a single count. */
export const COUNT_WINDOW_MS = 10000;

/** Hard ceiling on tracked keys. Mirrors `maxLimiterKeys` in services/hlsProxyService.js. */
export const MAX_THROTTLE_KEYS = 5000;

/** Amortised sweep cadence. Longer than the window; this is housekeeping, not correctness. */
export const SWEEP_INTERVAL_MS = 60000;

/** key -> { windowStart, lastSeen } */
const entries = new Map();
let lastSweep = 0;

/**
 * Drop entries whose window has long expired. Cheap: the map is capped at 5000.
 * @param {number} now
 */
function sweepExpired(now) {
    for (const [key, entry] of entries) {
        if (now - entry.lastSeen >= COUNT_WINDOW_MS) {
            entries.delete(key);
        }
    }
    lastSweep = now;
}

/**
 * Evict the least-recently-seen key so a new one can be admitted at the cap.
 * Same tie-break as FixedWindowLimiter.evictOldestEntry(): oldest `lastSeen` wins.
 */
function evictOldestEntry() {
    let oldestKey = null;
    let oldestSeen = Infinity;

    for (const [key, entry] of entries) {
        if (entry.lastSeen < oldestSeen) {
            oldestSeen = entry.lastSeen;
            oldestKey = key;
        }
    }

    if (oldestKey !== null) {
        entries.delete(oldestKey);
    }
}

/**
 * Should this event be counted?
 *
 * Returns true at most once per key per COUNT_WINDOW_MS. A blocked call does NOT extend the
 * window (fixed window, not sliding) — otherwise a retry storm could keep a legitimate second
 * view from ever being counted.
 *
 * A key we cannot bucket is refused rather than counted: an uncounted impression is a small
 * reporting gap, an unbucketable key is an unbounded map.
 *
 * @param {string} key  Caller-built identity, e.g. `<ip>:i:<offerId>` or `<ip>:c:<offerId>:<link>`.
 * @param {number} [now] Injectable clock for tests.
 * @returns {boolean} true = count it, false = skip the count (the caller still serves the request).
 */
export function allowCount(key, now = Date.now()) {
    if (typeof key !== 'string' || key.length === 0) {
        return false;
    }

    if (now - lastSweep >= SWEEP_INTERVAL_MS) {
        sweepExpired(now);
    }

    const entry = entries.get(key);
    if (entry) {
        const age = now - entry.windowStart;
        // `age < 0` means the clock moved backwards (NTP step, container resume). Treat it as a
        // fresh window instead of blocking this key until real time catches up.
        if (age >= 0 && age < COUNT_WINDOW_MS) {
            entry.lastSeen = now;
            return false;
        }
        entry.windowStart = now;
        entry.lastSeen = now;
        return true;
    }

    if (entries.size >= MAX_THROTTLE_KEYS) {
        evictOldestEntry();
    }
    entries.set(key, { windowStart: now, lastSeen: now });
    return true;
}

/**
 * Number of tracked keys — for tests and any future diagnostics endpoint.
 * @returns {number}
 */
export function throttleSize() {
    return entries.size;
}

/**
 * Clear all state so a test can start from a known-empty store.
 * Named with the `_`/ForTests convention so it is obvious this is not production API.
 */
export function _resetThrottleForTests() {
    entries.clear();
    lastSweep = 0;
}

export default { allowCount, throttleSize, _resetThrottleForTests, COUNT_WINDOW_MS, MAX_THROTTLE_KEYS };
