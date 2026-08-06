/**
 * Purpose: Report a refused playback token once per reason, not once per request.
 * Caller: recordingPlaybackService.
 * Deps: none.
 * MainFuncs: noteTokenRefusal.
 * SideEffects: writes one line to stdout; keeps a bounded in-process Map.
 *
 * Keyed by camera + reason: a visitor changing cameras with one dead cookie is ONE fact, and
 * repeating it every few seconds would bury it in the same way silence did. stdout, not stderr — a
 * stale cookie is an expected condition, and stderr is reserved for what a human must act on.
 */

const TOKEN_REFUSAL_WINDOW_MS = 5 * 60 * 1000;
const tokenRefusalSeen = new Map();

export function noteTokenRefusal(cameraId, statusCode, message) {
    const key = `${cameraId}:${statusCode}:${message || ''}`;
    const now = Date.now();
    const last = tokenRefusalSeen.get(key);
    if (last && now - last < TOKEN_REFUSAL_WINDOW_MS) {
        return;
    }

    tokenRefusalSeen.set(key, now);
    // Keep the map from growing without bound on a long-lived process.
    if (tokenRefusalSeen.size > 500) {
        for (const [k, seen] of tokenRefusalSeen) {
            if (now - seen >= TOKEN_REFUSAL_WINDOW_MS) {
                tokenRefusalSeen.delete(k);
            }
        }
    }

    console.log(`[playback] token refused for camera ${cameraId} (${statusCode}): ${message || 'no reason given'} — serving public preview instead`);
}

export default { noteTokenRefusal };
