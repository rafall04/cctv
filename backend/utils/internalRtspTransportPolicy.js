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

export function buildFfmpegRtspInputArgs(inputUrl, transport = 'tcp') {
    const normalized = normalizeInternalRtspTransport(transport);
    if (normalized === 'auto') {
        return ['-i', inputUrl];
    }

    return [
        '-rtsp_transport',
        normalized === 'udp' ? 'udp' : 'tcp',
        '-i',
        inputUrl,
    ];
}
