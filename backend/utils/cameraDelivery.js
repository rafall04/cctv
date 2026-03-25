export const DELIVERY_TYPES = [
    'internal_hls',
    'external_hls',
    'external_mjpeg',
    'external_embed',
    'external_jsmpeg',
    'external_custom_ws',
];

export function getEffectiveDeliveryType(camera = {}) {
    if (DELIVERY_TYPES.includes(camera.delivery_type)) {
        return camera.delivery_type;
    }

    if (camera.stream_source === 'external' && camera.external_hls_url) {
        return 'external_hls';
    }

    return 'internal_hls';
}

export function getCompatStreamSource(deliveryType) {
    return deliveryType === 'internal_hls' ? 'internal' : 'external';
}

export function isHlsDeliveryType(deliveryType) {
    return deliveryType === 'internal_hls' || deliveryType === 'external_hls';
}

export function getStreamCapabilities(deliveryType) {
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
