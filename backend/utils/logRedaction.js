// Purpose: Strip embedded credentials out of free-text log lines before they are printed.
// Caller: recordingService (FFmpeg output), any log path that echoes third-party text.
// Deps: None.
// MainFuncs: redactUrlCredentials.
// SideEffects: None; pure string transform.
//
// WHY THIS EXISTS SEPARATELY FROM maskRecordingSourceForLog
// ---------------------------------------------------------
// `maskRecordingSourceForLog` (recordingStarter) parses a value that IS a URL with
// `new URL()`. That is the right tool when we own the string. It cannot help here:
// FFmpeg hands us prose with a URL somewhere inside it, e.g.
//
//   rtsp://admin:hunter2@10.0.0.4:554/stream1: Connection timed out
//
// which is not a URL and throws. The backend's own logger already masks its RTSP
// sources, so this gap was invisible there — but the recorder echoes FFmpeg's raw
// stderr, and that path printed the camera password in clear text 189 times in
// 2.5 days on production, into a file that is world-readable and never rotated.

// Matches the userinfo slot of a URL: scheme "://" then everything up to the "@"
// that closes the authority. The character class forbids "/", "?", "#" and space,
// so it can only ever match a real authority-position userinfo — a path that
// merely contains an "@" (…/photos/me@2x.png) has a "/" before it and is skipped.
const URL_USERINFO_RE = /([a-z][a-z0-9+.\-]*:\/\/)([^/?#\s@]+)@/gi;

/**
 * Replace `scheme://user:pass@` with `scheme://****:****@` everywhere in `value`.
 *
 * Deliberately narrow: only the userinfo is removed, so hostnames, ports, paths
 * and error text all survive intact. Those are what make a recording failure
 * diagnosable, and over-redacting them would just trade one operational problem
 * for another.
 */
export function redactUrlCredentials(value) {
    if (typeof value !== 'string' || value === '') {
        return value;
    }
    return value.replace(URL_USERINFO_RE, '$1****:****@');
}

export default { redactUrlCredentials };
