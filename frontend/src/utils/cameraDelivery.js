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

export function getStreamCapabilities(camera = {}) {
    const deliveryType = getEffectiveDeliveryType(camera);
    const fallbackCapabilities = {
        internal_hls: { live: true, popup: true, multiview: true, playback: true, supported_player: 'hls' },
        external_hls: { live: true, popup: true, multiview: true, playback: false, supported_player: 'hls' },
        external_mjpeg: { live: true, popup: true, multiview: false, playback: false, supported_player: 'mjpeg' },
        external_embed: { live: true, popup: true, multiview: false, playback: false, supported_player: 'embed' },
        external_jsmpeg: { live: true, popup: true, multiview: false, playback: false, supported_player: 'embed_fallback' },
        external_custom_ws: { live: false, popup: true, multiview: false, playback: false, supported_player: 'unsupported' },
    };

    return camera.stream_capabilities || fallbackCapabilities[deliveryType] || {
        live: false,
        popup: false,
        multiview: false,
        playback: false,
        supported_player: 'unsupported',
    };
}

export function isHlsDeliveryType(deliveryType) {
    return deliveryType === 'internal_hls' || deliveryType === 'external_hls';
}

export function isMultiViewSupported(camera = {}) {
    const capabilities = getStreamCapabilities(camera);
    return capabilities.multiview === true;
}

export function getPrimaryExternalUrl(camera = {}) {
    return camera.external_stream_url || camera.external_embed_url || camera._rawExternalStreamUrl || null;
}

export function getPopupEmbedUrl(camera = {}) {
    const deliveryType = getEffectiveDeliveryType(camera);

    if (deliveryType === 'external_embed') {
        return camera.external_embed_url || camera.external_stream_url || null;
    }

    if (deliveryType === 'external_mjpeg') {
        return camera.external_stream_url || camera.external_embed_url || null;
    }

    if (deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
        return camera.external_embed_url || null;
    }

    return null;
}
