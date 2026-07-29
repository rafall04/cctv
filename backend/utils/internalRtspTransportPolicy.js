/*
Purpose: Resolve internal RTSP transport policy for MediaMTX and FFmpeg consumers.
Caller: MediaMTX sync, recording service, camera/area admin services, and tests.
Deps: ffmpegCapabilities (FFmpeg major version, cached).
MainFuncs: normalizeInternalRtspTransport(), resolveInternalRtspTransport(), toMediaMtxSourceProtocol(), buildFfmpegRtspInputArgs().
SideEffects: None beyond a one-off cached `ffmpeg -version` probe; the version is injectable.
*/

import { getFfmpegMajorVersion } from './ffmpegCapabilities.js';

const INTERNAL_RTSP_TRANSPORT_VALUES = new Set(['default', 'tcp', 'udp', 'auto']);

export function normalizeInternalRtspTransport(value) {
    if (value === 'automatic') {
        return 'auto';
    }

    return INTERNAL_RTSP_TRANSPORT_VALUES.has(value) ? value : 'default';
}

export function resolveInternalRtspTransport(camera = {}, area = null) {
    const cameraTransport = normalizeInternalRtspTransport(camera?.internal_rtsp_transport_override);
    const areaTransport = normalizeInternalRtspTransport(area?.internal_rtsp_transport_default);

    if (cameraTransport !== 'default') {
        return cameraTransport;
    }

    if (areaTransport !== 'default') {
        return areaTransport;
    }

    return 'tcp';
}

export function toMediaMtxSourceProtocol(transport) {
    const normalized = normalizeInternalRtspTransport(transport);
    if (normalized === 'udp') {
        return 'udp';
    }
    if (normalized === 'auto') {
        return 'automatic';
    }
    return 'tcp';
}

export function buildFfmpegRtspInputArgs(inputUrl, transport = 'tcp', {
    socketTimeoutMicros = null,
    ffmpegMajorVersion = undefined,
} = {}) {
    const normalized = normalizeInternalRtspTransport(transport);
    // Abort a socket read after N microseconds of no I/O, so a camera that stops
    // delivering frames makes the process EXIT instead of hanging forever (routing it
    // through the normal failure handler).
    //
    // The option name is version-specific and getting it wrong kills every internal
    // recorder at once:
    //   FFmpeg 4.x : -stimeout <us>   (there, -timeout is the LISTEN timeout, in seconds)
    //   FFmpeg 5+  : -timeout  <us>   (-stimeout deprecated, then removed)
    //
    // Biased deliberately toward 4.x: only a positively-identified major >= 5 switches
    // the name. An undetectable version keeps today's proven behaviour rather than
    // gambling on a guess.
    // The probe is INSIDE the guard on purpose: getFfmpegMajorVersion() shells out synchronously
    // (execFileSync, 5s timeout), and callers that pass no socketTimeoutMicros cannot use the
    // answer. Computing it unconditionally blocked the Fastify event loop on paths that then
    // threw the result away.
    const timeoutArgs = [];
    if (Number.isFinite(socketTimeoutMicros) && socketTimeoutMicros > 0) {
        const major = ffmpegMajorVersion === undefined ? getFfmpegMajorVersion() : ffmpegMajorVersion;
        timeoutArgs.push(
            Number.isFinite(major) && major >= 5 ? '-timeout' : '-stimeout',
            String(Math.floor(socketTimeoutMicros)),
        );
    }

    if (normalized === 'auto') {
        return [...timeoutArgs, '-i', inputUrl];
    }

    return [
        '-rtsp_transport',
        normalized === 'udp' ? 'udp' : 'tcp',
        ...timeoutArgs,
        '-i',
        inputUrl,
    ];
}
