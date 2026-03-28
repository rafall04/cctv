export const DELIVERY_TYPES = [
    'internal_hls',
    'external_hls',
    'external_mjpeg',
    'external_embed',
    'external_jsmpeg',
    'external_custom_ws',
];

export const CAMERA_DELIVERY_CLASSIFICATIONS = [
    ...DELIVERY_TYPES,
    'external_unresolved',
];

export const EXTERNAL_HEALTH_MODES = [
    'default',
    'passive_first',
    'hybrid_probe',
    'probe_first',
    'disabled',
];

export const DELIVERY_TYPE_PATTERNS = {
    websocket: /^wss?:\/\//i,
    http: /^https?:\/\//i,
    hlsHint: /\.m3u8($|[?#])/i,
    zoneminderMjpeg: /\/zm\/cgi-bin\/nph-zms/i,
    jsmpegHint: /jsmpeg/i,
};

function normalizeUrl(url) {
    return typeof url === 'string' ? url.trim() : '';
}

function normalizeStreamSource(streamSource) {
    return typeof streamSource === 'string'
        ? streamSource.trim().toLowerCase()
        : '';
}

function hasInternalRtsp(camera = {}) {
    return Boolean(normalizeUrl(camera.private_rtsp_url));
}

function hasExternalSourceMetadata(camera = {}) {
    return Boolean(
        normalizeUrl(camera.external_hls_url)
        || normalizeUrl(camera.external_stream_url)
        || normalizeUrl(camera.external_embed_url)
        || normalizeUrl(camera.external_snapshot_url)
    );
}

function inferLegacyExternalDeliveryType(camera = {}) {
    const externalHlsUrl = normalizeUrl(camera.external_hls_url);
    const externalStreamUrl = normalizeUrl(camera.external_stream_url);
    const externalEmbedUrl = normalizeUrl(camera.external_embed_url);
    const externalUrl = externalStreamUrl || externalHlsUrl;
    const hasExternalFields = Boolean(externalHlsUrl || externalStreamUrl || externalEmbedUrl);
    const streamSource = normalizeStreamSource(camera.stream_source);

    if (externalHlsUrl && DELIVERY_TYPE_PATTERNS.http.test(externalHlsUrl)) {
        return 'external_hls';
    }

    if (externalUrl && DELIVERY_TYPE_PATTERNS.websocket.test(externalUrl)) {
        return DELIVERY_TYPE_PATTERNS.jsmpegHint.test(externalUrl)
            ? 'external_jsmpeg'
            : 'external_custom_ws';
    }

    if (externalUrl && DELIVERY_TYPE_PATTERNS.zoneminderMjpeg.test(externalUrl)) {
        return 'external_mjpeg';
    }

    if (externalUrl && DELIVERY_TYPE_PATTERNS.http.test(externalUrl)) {
        return DELIVERY_TYPE_PATTERNS.hlsHint.test(externalUrl)
            ? 'external_hls'
            : 'external_mjpeg';
    }

    if (externalEmbedUrl && DELIVERY_TYPE_PATTERNS.http.test(externalEmbedUrl)) {
        return 'external_embed';
    }

    if (hasExternalFields || streamSource === 'external') {
        return 'external_hls';
    }

    return null;
}

export function getCameraDeliveryProfile(camera = {}) {
    const streamSource = normalizeStreamSource(camera.stream_source);
    const deliveryType = DELIVERY_TYPES.includes(camera.delivery_type)
        ? camera.delivery_type
        : null;
    const inferredDeliveryType = inferLegacyExternalDeliveryType(camera);
    const internalRtsp = hasInternalRtsp(camera);
    const externalSourceMetadata = hasExternalSourceMetadata(camera);

    if (
        streamSource === 'external'
        && !internalRtsp
        && !externalSourceMetadata
    ) {
        return {
            classification: 'external_unresolved',
            effectiveDeliveryType: deliveryType || inferredDeliveryType || 'external_hls',
            compatStreamSource: 'external',
            hasInternalRtsp: internalRtsp,
            hasExternalSourceMetadata: externalSourceMetadata,
            inferredDeliveryType,
        };
    }

    const effectiveDeliveryType = deliveryType || inferredDeliveryType || 'internal_hls';

    return {
        classification: effectiveDeliveryType,
        effectiveDeliveryType,
        compatStreamSource: effectiveDeliveryType === 'internal_hls' ? 'internal' : 'external',
        hasInternalRtsp: internalRtsp,
        hasExternalSourceMetadata: externalSourceMetadata,
        inferredDeliveryType,
    };
}

export function getEffectiveDeliveryType(cameraOrDeliveryType = {}) {
    if (typeof cameraOrDeliveryType === 'string') {
        return DELIVERY_TYPES.includes(cameraOrDeliveryType)
            ? cameraOrDeliveryType
            : 'internal_hls';
    }

    return getCameraDeliveryProfile(cameraOrDeliveryType).effectiveDeliveryType;
}

export function getPrimaryExternalStreamUrl(camera = {}) {
    const deliveryType = getEffectiveDeliveryType(camera);
    const externalHlsUrl = normalizeUrl(camera.external_hls_url);
    const externalStreamUrl = normalizeUrl(camera.external_stream_url);

    if (deliveryType === 'external_hls') {
        return externalStreamUrl || externalHlsUrl || null;
    }

    return externalStreamUrl || externalHlsUrl || null;
}

export function getCompatStreamSource(deliveryType) {
    return deliveryType === 'internal_hls' ? 'internal' : 'external';
}

export function isHlsDeliveryType(deliveryType) {
    return deliveryType === 'internal_hls' || deliveryType === 'external_hls';
}

export function getStreamCapabilities(cameraOrDeliveryType = {}) {
    const deliveryType = getEffectiveDeliveryType(cameraOrDeliveryType);

    switch (deliveryType) {
        case 'internal_hls':
            return {
                live: true,
                popup: true,
                multiview: true,
                playback: true,
                direct_embed: false,
                supported_player: 'hls',
            };
        case 'external_hls':
            return {
                live: true,
                popup: true,
                multiview: true,
                playback: true,
                direct_embed: false,
                supported_player: 'hls',
            };
        case 'external_mjpeg':
            return {
                live: true,
                popup: true,
                multiview: false,
                playback: false,
                direct_embed: true,
                supported_player: 'mjpeg',
            };
        case 'external_embed':
            return {
                live: true,
                popup: true,
                multiview: false,
                playback: false,
                direct_embed: true,
                supported_player: 'embed',
            };
        case 'external_jsmpeg':
            return {
                live: true,
                popup: true,
                multiview: false,
                playback: false,
                direct_embed: true,
                supported_player: 'embed_fallback',
            };
        case 'external_custom_ws':
            return {
                live: false,
                popup: true,
                multiview: false,
                playback: false,
                direct_embed: true,
                supported_player: 'unsupported',
            };
        default:
            return {
                live: false,
                popup: false,
                multiview: false,
                playback: false,
                direct_embed: false,
                supported_player: 'unsupported',
            };
    }
}

export function normalizeExternalOriginMode(originMode) {
    if (originMode === 'embed') {
        return 'embed';
    }

    return 'direct';
}

export function normalizeExternalHealthMode(healthMode) {
    return EXTERNAL_HEALTH_MODES.includes(healthMode) ? healthMode : 'default';
}
