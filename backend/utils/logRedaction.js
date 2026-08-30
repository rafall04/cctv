// Purpose: Strip embedded credentials out of free-text log lines before they are printed, and
//          strip them out of URLs before they are handed to a client.
// Caller: recordingService (FFmpeg output) + any log path that echoes third-party text
//         (redactUrlCredentials); public camera projections (stripUrlCredentials).
// Deps: None.
// MainFuncs: redactUrlCredentials, stripUrlCredentials.
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

// Matches a secret carried in a query string: `token=…`, `password=…`, and friends.
//
// Userinfo is no longer how third parties hand out access — a bearer token in the URL is, and
// FFmpeg echoes the whole command line on failure. Production was writing complete ZoneMinder
// JWTs into pm2 logs (which are archived and world-readable) every time a Jombang camera failed
// to yield a thumbnail. Those tokens expire in two hours, which limits the damage but does not
// make them safe to publish.
//
// The NAME is kept and only the value replaced, so the log still says a token was involved — that
// is the diagnosable part. The value class is the URL-safe token alphabet, not "anything up to a
// delimiter": FFmpeg formats failures as `URL: message`, and a greedier class swallowed that colon
// along with the start of the message.
//
// `session` is deliberately NOT on the list. An existing test asserts a `?session=` URL is
// credential-free, and there is no production evidence of one leaking — the JWTs that did leak came
// through `token=`. Add it if evidence turns up, but do not overrule that test on a hunch.
// `monitor=168` and friends are untouched either way: only the listed names match.
const URL_QUERY_SECRET_RE = /([?&](?:access_token|api_key|apikey|auth|authorization|key|passwd|password|pwd|secret|sig|signature|token)=)([A-Za-z0-9._~%+/=-]+)/gi;

/**
 * Strip credentials out of `value`: `scheme://user:pass@` becomes `scheme://****:****@`, and a
 * secret carried in a query string keeps its name but loses its value (`token=****`).
 *
 * Deliberately narrow: only the secret itself is removed, so hostnames, ports, paths
 * and error text all survive intact. Those are what make a recording failure
 * diagnosable, and over-redacting them would just trade one operational problem
 * for another.
 */
export function redactUrlCredentials(value) {
    if (typeof value !== 'string' || value === '') {
        return value;
    }
    return value
        .replace(URL_USERINFO_RE, '$1****:****@')
        .replace(URL_QUERY_SECRET_RE, '$1****');
}

/**
 * REMOVE the userinfo credentials from `value` so a URL is safe to hand a client: `scheme://user:pass@`
 * becomes `scheme://`, leaving a still-functional `scheme://host/path?query#frag`. Unlike
 * redactUrlCredentials — which MASKS to `****` to keep a log line legible — this yields a clean, usable
 * URL, so an admin who pasted `https://user:pass@host/snapshot.jpg` no longer leaks the credentials to
 * anonymous public clients while the image/embed keeps loading (browsers ignore userinfo on img/iframe
 * subresources anyway). Query/fragment are left untouched so signed/tokenised URLs still work. Global,
 * so a credential in a nested URL (an embed link whose fragment carries the real origin) is stripped
 * too. Non-strings and credential-free URLs are returned unchanged, so it is safe to run over any field.
 */
export function stripUrlCredentials(value) {
    if (typeof value !== 'string' || value === '') {
        return value;
    }
    return value.replace(URL_USERINFO_RE, '$1');
}

export default { redactUrlCredentials, stripUrlCredentials };
