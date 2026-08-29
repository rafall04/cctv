// Purpose: Build the runOnReady/runOnNotReady push-hook fields for a MediaMTX path config (Phase 3).
// Caller: mediaMtxService.buildInternalPathConfig; unit-tested via that path (mediaMtxHooks.test.js).
// Deps: config (backend port + shared secret). Pure otherwise.
//
// MediaMTX runs these commands on the source not-ready<->ready transition, WITHOUT a shell but honouring
// double-quoted args, and substitutes $MTX_PATH (= camera stream_key) itself. Each hook curls the
// loopback push endpoint, which maps the path back to a camera and triggers a real health re-check
// (see internalHookController). The command is identical for every path — MediaMTX fills in $MTX_PATH.

import { config } from '../config/config.js';

/**
 * @param {boolean} isAlwaysOn only always_on paths get hooks — an on-demand path's not-ready just
 *   means the last viewer left, not a source failure.
 * @returns {{runOnReady: string, runOnReadyRestart: boolean, runOnNotReady: string}} EMPTY strings
 *   (not absent fields) when off, so a PATCH actively clears a stale hook. Disabled when
 *   INTERNAL_HOOK_SECRET is unset or not shell-safe.
 */
export function buildPushHookFields(isAlwaysOn) {
    const empty = { runOnReady: '', runOnReadyRestart: false, runOnNotReady: '' };
    const secret = config.security?.internalHookSecret;
    // The secret sits inside a double-quoted `curl -H` arg that MediaMTX runs WITHOUT a shell. A secret
    // limited to [A-Za-z0-9_-] cannot break that quoting or inject an argument; anything else disables
    // hooks rather than emit a malformed command (assertSecureConfig warns about it at boot).
    if (!isAlwaysOn || !secret || !/^[A-Za-z0-9_-]+$/.test(secret)) {
        return empty;
    }
    const port = config.server?.port || 3000;
    const cmd = (event) =>
        `curl -s -m 2 -o /dev/null -H "X-Internal-Secret: ${secret}" `
        + `"http://127.0.0.1:${port}/api/internal/mediamtx/path-event?event=${event}&path=$MTX_PATH"`;
    return { runOnReady: cmd('ready'), runOnReadyRestart: false, runOnNotReady: cmd('notready') };
}

export default buildPushHookFields;
