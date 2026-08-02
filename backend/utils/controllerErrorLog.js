// Purpose: Route controller errors to the log stream that matches what they actually are.
// Caller: Controllers, in their catch blocks.
// Deps: None.
// MainFuncs: logControllerError.
// SideEffects: Writes one line to stdout or stderr.
//
// WHY
// ---
// pm2 splits console.error/warn into `*-error.log` and everything else into
// `*-out.log`. That split is the only triage tool an operator has, so it has to
// mean something: stderr is for what a human must act on.
//
// The prevailing catch block was `console.error('X error:', error)`, which prints
// the whole Error — stack trace included — no matter what it is. A visitor opening
// a share link whose playback token does not cover that camera is a 403: the system
// worked, the request was refused. Production logged 52 of those with full stack
// traces, plus 9 more from the heartbeat route, all filed as application errors.
//
// The rule here: a 4xx carries a statusCode because the handler *decided* to refuse
// it, so it is an outcome (stdout, one line). Anything without a statusCode, or a
// 5xx, is the code failing (stderr, with the stack).

/**
 * @param {string} label   Human context, e.g. 'Activate playback token'.
 * @param {Error}  error   The caught error; `statusCode` decides the stream.
 * @param {object} [logger] Injectable for tests; defaults to console.
 */
export function logControllerError(label, error, logger = console) {
    const status = Number(error?.statusCode);

    if (Number.isFinite(status) && status >= 400 && status < 500) {
        logger.log(`${label}: ${status} ${error.message}`);
        return;
    }

    logger.error(`${label}:`, error);
}

export default { logControllerError };
