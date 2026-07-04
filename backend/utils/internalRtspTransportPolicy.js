/*
Purpose: Resolve internal RTSP transport policy for MediaMTX and FFmpeg consumers.
Caller: MediaMTX sync, recording service, camera/area admin services, and tests.
Deps: None.
MainFuncs: normalizeInternalRtspTransport(), resolveInternalRtspTransport(), toMediaMtxSourceProtocol(), buildFfmpegRtspInputArgs().
SideEffects: None; pure policy helpers.
*/

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

export function buildFfmpegRtspInputArgs(inputUrl, transport = 'tcp', { socketTimeoutMicros = null } = {}) {
    const normalized = normalizeInternalRtspTransport(transport);
    // -stimeout makes FFmpeg abort a socket read after N microseconds of no I/O,
    // so a camera that stops delivering frames causes the process to EXIT instead
    // of hanging forever (routing it through the normal failure handler). This is
    // the RTSP socket-timeout option for FFmpeg 4.x.
    const timeoutArgs = Number.isFinite(socketTimeoutMicros) && socketTimeoutMicros > 0
        ? ['-stimeout', String(Math.floor(socketTimeoutMicros))]
        : [];

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
