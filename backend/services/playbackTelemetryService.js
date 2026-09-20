// Purpose: Viewer-side playback failure telemetry. Server logs only see OUR side of the pipe —
//          a corrupt segment or a codec the fleet can't decode is invisible until a visitor
//          reports it. This ring buffer makes "many viewers failing on the same file" visible.
// Caller: routes/publicPlaybackTelemetryRoutes.js (record), systemHealthService (getSummary).
// Deps: none — deliberately in-memory. Telemetry must not grow cctv.db, and per-process PM2
//       numbers are acceptable (backend is pinned to one fork instance).
// MainFuncs: record, getSummary, resetForTests.
// SideEffects: None beyond memory. Anonymous and privacy-bounded BY CONSTRUCTION: no IP, no UA
//              string, no token id, no session id — only camera/segment/stage/error counters.

const MAX_EVENTS = 500;      // ring size — enough to see a burst, bounded so a flood can't grow it
const MAX_RECENT = 20;       // how many raw events getSummary() exposes
const SESSION_TOP_N = 10;
const MAX_COUNTER_KEYS = 2000; // attacker-chosen ids must not grow counters unboundedly — fold the tail
const OTHER_KEY = '__other';

const events = [];
let totalEvents = 0;
let lastEventAt = null;
const byStage = Object.create(null);
const byErrorCode = Object.create(null);
const byCamera = Object.create(null);

function bump(bucket, key) {
    if (key == null) return;
    const k = key in bucket || Object.keys(bucket).length < MAX_COUNTER_KEYS ? key : OTHER_KEY;
    bucket[k] = (bucket[k] || 0) + 1;
}

/**
 * Record one client-reported playback failure. `evt` is already shape-validated by the route
 * schema — this only normalizes and counts.
 */
function record(evt) {
    totalEvents += 1;
    lastEventAt = new Date().toISOString();
    const entry = {
        at: lastEventAt,
        stage: evt.stage,
        errorCode: evt.errorCode ?? null,
        cameraId: evt.cameraId ?? null,
        scope: evt.scope ?? null,
        segment: evt.segment ?? null,
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    bump(byStage, entry.stage);
    bump(byErrorCode, entry.errorCode);
    bump(byCamera, entry.cameraId);
}

function topEntries(bucket, n = SESSION_TOP_N) {
    return Object.entries(bucket)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([key, count]) => ({ key, count }));
}

function getSummary() {
    return {
        totalEvents,
        lastEventAt,
        byStage: { ...byStage },
        topErrorCodes: topEntries(byErrorCode),
        // OTHER_KEY stays a string — Number('__other') would be NaN.
        topCameras: topEntries(byCamera).map(({ key, count }) => ({ cameraId: key === OTHER_KEY ? OTHER_KEY : Number(key), count })),
        distinctCameraIds: Object.keys(byCamera).length,
        recent: events.slice(-MAX_RECENT),
    };
}

function resetForTests() {
    events.length = 0;
    totalEvents = 0;
    lastEventAt = null;
    for (const bucket of [byStage, byErrorCode, byCamera]) {
        for (const k of Object.keys(bucket)) delete bucket[k];
    }
}

export default { record, getSummary, resetForTests };
