import { getApiUrl } from '../config/config.js';

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
        return { targetUrl: null, proxyFallbackUrl: null, isDirectStream: false };
    }

    const isExternal = camera.stream_source === 'external';
    const proxyDisabled = camera.external_use_proxy === 0 || camera.external_use_proxy === false;
    const rawUrl = camera._rawExternalHlsUrl || camera.external_hls_url;
    const currentStreamUrl = camera.streams?.hls || null;

    // Direct stream conditions:
    // 1. Camera is external
    // 2. Proxy is explicitly disabled in DB
    // 3. Not forced back to proxy (e.g. after CORS failure)
    // 4. We have the raw external URL available
    const useDirectStream = isExternal && proxyDisabled && !forceProxy && !!rawUrl;

    if (!useDirectStream) {
        return {
            targetUrl: currentStreamUrl,
            proxyFallbackUrl: null,
            isDirectStream: false,
        };
    }

    // Build proxy fallback URL for use when direct stream fails (CORS, network)
    const baseUrl = getApiUrl();
    const query = new URLSearchParams({ url: rawUrl });
    query.set('cameraId', String(camera.id));
    const proxyFallbackUrl = `${baseUrl}/hls/proxy?${query.toString()}`;

    return {
        targetUrl: rawUrl,
        proxyFallbackUrl,
        isDirectStream: true,
    };
}
