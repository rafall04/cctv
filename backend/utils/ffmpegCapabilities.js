// Purpose: Detect the installed FFmpeg major version so version-specific options are
//          chosen correctly instead of being hard-coded to whatever shipped in 2022.
// Caller: internalRtspTransportPolicy (RTSP socket-timeout option name).
// Deps: child_process execFileSync.
// MainFuncs: getFfmpegMajorVersion, resetFfmpegCapabilitiesCache.
// SideEffects: Runs `ffmpeg -version` ONCE per process and caches the result.
//
// WHY THIS EXISTS
// ---------------
// The RTSP socket-I/O timeout is spelled differently across FFmpeg majors:
//
//   FFmpeg 4.x : -stimeout <microseconds>   (-timeout there means the LISTEN timeout, in seconds)
//   FFmpeg 5+  : -timeout  <microseconds>   (-stimeout was deprecated and then removed)
//
// The recorder hard-coded `-stimeout`. That is correct on the 4.2.7 currently deployed,
// but an OS upgrade bumps FFmpeg to 5/6/7, where an unknown option makes ffmpeg exit
// immediately — every internal RTSP camera would fail to start, look like a mass camera
// outage, and take recording down completely.
//
// Getting this backwards is worse than not having it, so detection is biased hard toward
// today's behaviour: anything we cannot positively identify as >= 5 keeps `-stimeout`.

import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

let cachedMajorVersion;

/**
 * Major version of the ffmpeg on PATH, or null when it cannot be determined.
 * Never throws — a detection failure must not stop a recording from starting.
 *
 * child_process is required LAZILY rather than imported at module scope. This module
 * sits in the recording graph, and many test files mock 'child_process' with only the
 * handful of functions they use; a static `import { execFileSync }` makes every one of
 * those files fail to load ("No export is defined on the mock"). Resolving through
 * createRequire at call time sidesteps the ESM mock registry, and tests inject `exec`
 * directly anyway.
 */
export function getFfmpegMajorVersion({ exec = null, binary = 'ffmpeg' } = {}) {
    if (cachedMajorVersion !== undefined) {
        return cachedMajorVersion;
    }

    try {
        const run = exec || requireFromHere('node:child_process').execFileSync;
        const out = String(run(binary, ['-version'], { encoding: 'utf8', timeout: 5000 }));
        /*
         * Accept a major with or without a following dot. Requiring `\d+\.` missed the builds most
         * likely to be NEW: git/snapshot and static tarballs print `ffmpeg version N-113456-g5f2f0e`
         * and a bare `ffmpeg version 7` has no dot either — both would have fallen back to 4.x
         * behaviour and emitted `-stimeout` to an ffmpeg that removed it, which is the exact
         * box-wide recording outage this module exists to prevent.
         */
        const match = /ffmpeg version n?(\d+)(?:[.\-\s]|$)/i.exec(out);
        cachedMajorVersion = match ? Number.parseInt(match[1], 10) : null;
    } catch {
        /*
         * Do NOT cache a failure. `undefined` means "not probed yet", `null` means "probed and
         * genuinely unknown". A transient EAGAIN/ENOMEM under boot-storm fork pressure, or this
         * call tripping its own 5s timeout on a loaded box, must not pin the whole process to
         * 4.x behaviour for its entire lifetime — on an ffmpeg 5+ host that would kill every
         * recorder until restart. Leaving it unset lets the next caller retry.
         */
        return null;
    }

    return cachedMajorVersion;
}

/** Test seam. */
export function resetFfmpegCapabilitiesCache() {
    cachedMajorVersion = undefined;
}

export default { getFfmpegMajorVersion, resetFfmpegCapabilitiesCache };
