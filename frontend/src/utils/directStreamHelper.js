import { getApiUrl } from '../config/config.js';
import { getEffectiveDeliveryType } from './cameraDelivery.js';

/**
 * Resolve the playback URL for a camera, honoring the external_use_proxy setting.
 *
 * When proxy is disabled for an external camera, the raw external HLS URL is used
 * for direct browser streaming. A proxy fallback URL is also provided so components
 * can automatically switch to backend proxy if a CORS / network error occurs.
 *
 * @param {Object} camera - Camera object from the API (must include streams, stream_source, external_use_proxy, _rawExternalHlsUrl)
 * @param {Object} [options]
 * @param {boolean} [options.forceProxy=false] - Force proxy usage (e.g. after CORS fallback)
 * @returns {{ targetUrl: string|null, proxyFallbackUrl: string|null, isDirectStream: boolean }}
 */
export function resolveStreamUrl(camera, { forceProxy = false } = {}) {
    if (!camera) {
        return { targetUrl: null, proxyFallbackUrl: null, isDirectStream: false, isAnnotated: false };
    }

    const deliveryType = getEffectiveDeliveryType(camera);
    const isExternalHls = deliveryType === 'external_hls';
    const proxyDisabled = camera.external_use_proxy === 0 || camera.external_use_proxy === false;
    const rawUrl = camera._rawExternalHlsUrl || camera.external_stream_url || camera.external_hls_url;
    const currentStreamUrl = camera.streams?.hls || null;
    // The vehicle-count annotated feed is served by nginx as static files, so the BACKEND proxy
    // never tracks its viewer sessions — the frontend must. streamService flags it inside `streams`
    // (see its getStreamData). Surfaced here so both HLS players (VideoPopup, MultiViewVideoItem)
    // read it from one place instead of sniffing the URL.
    const isAnnotated = camera.streams?.annotated === true;

    // Direct stream conditions:
    // 1. Camera is external
    // 2. Proxy is explicitly disabled in DB
    // 3. Not forced back to proxy (e.g. after CORS failure)
    // 4. We have the raw external URL available
    const useDirectStream = isExternalHls && proxyDisabled && !forceProxy && !!rawUrl;

    // Proxy URL for use when direct stream fails (CORS, network, upstream hang)
    const baseUrl = getApiUrl();
    const proxyUrl = rawUrl
        ? `${baseUrl}/hls/proxy?${new URLSearchParams({ url: rawUrl, cameraId: String(camera.id) }).toString()}`
        : null;

    if (!useDirectStream) {
        // A direct-mode external camera's streams.hls IS the raw upstream URL — when
        // forceProxy flips us out of direct mode, the fallback target must be the proxy
        // URL, or the "fallback" just reloads the same dead path.
        const forcedProxyUrl = (forceProxy && isExternalHls && proxyDisabled) ? proxyUrl : null;
        return {
            targetUrl: forcedProxyUrl || currentStreamUrl,
            proxyFallbackUrl: null,
            isDirectStream: false,
            isAnnotated,
        };
    }

    return {
        targetUrl: rawUrl,
        proxyFallbackUrl: proxyUrl,
        isDirectStream: true,
        isAnnotated,
    };
}
