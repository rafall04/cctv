export const DELIVERY_TYPES = [
    'internal_hls',
    'external_hls',
    'external_mjpeg',
    'external_embed',
    'external_jsmpeg',
    'external_custom_ws',
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

function inferLegacyExternalDeliveryType(camera = {}) {
    const externalHlsUrl = normalizeUrl(camera.external_hls_url);
    const externalStreamUrl = normalizeUrl(camera.external_stream_url);
    const externalEmbedUrl = normalizeUrl(camera.external_embed_url);
    const externalUrl = externalStreamUrl || externalHlsUrl;
    const hasExternalFields = Boolean(externalHlsUrl || externalStreamUrl || externalEmbedUrl);
    const streamSource = typeof camera.stream_source === 'string'
        ? camera.stream_source.trim().toLowerCase()
        : '';

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

export function getEffectiveDeliveryType(cameraOrDeliveryType = {}) {
    if (typeof cameraOrDeliveryType === 'string') {
        return DELIVERY_TYPES.includes(cameraOrDeliveryType)
            ? cameraOrDeliveryType
            : 'internal_hls';
    }

    const camera = cameraOrDeliveryType || {};

    if (DELIVERY_TYPES.includes(camera.delivery_type)) {
        return camera.delivery_type;
    }

    return inferLegacyExternalDeliveryType(camera) || 'internal_hls';
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
                playback: false,
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
