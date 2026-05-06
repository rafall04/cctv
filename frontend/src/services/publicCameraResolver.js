/*
 * Purpose: Resolve public-growth camera payloads into the standard stream payload expected by public video popups.
 * Caller: LandingPage discovery handlers and AreaPublicPage camera handlers.
 * Deps: streamService.
 * MainFuncs: resolvePublicPopupCamera.
 * SideEffects: May fetch /api/stream/:cameraId when a public-growth camera lacks streams.hls.
 */

import { streamService } from './streamService';

function hasHlsStream(camera = {}) {
    return Boolean(camera?.streams?.hls);
}

function mergePublicCameraWithStreamPayload(publicCamera, streamPayload = {}) {
    const payloadCamera = streamPayload.camera || {};

    return {
        ...publicCamera,
        ...payloadCamera,
        viewer_stats: publicCamera.viewer_stats || payloadCamera.viewer_stats,
        live_viewers: publicCamera.live_viewers ?? payloadCamera.live_viewers,
        total_views: publicCamera.total_views ?? payloadCamera.total_views,
        thumbnail_path: publicCamera.thumbnail_path ?? payloadCamera.thumbnail_path,
        thumbnail_updated_at: publicCamera.thumbnail_updated_at ?? payloadCamera.thumbnail_updated_at,
        streams: streamPayload.streams || payloadCamera.streams || publicCamera.streams,
        stream_source: streamPayload.stream_source || payloadCamera.stream_source || publicCamera.stream_source,
        delivery_type: streamPayload.delivery_type || payloadCamera.delivery_type || publicCamera.delivery_type,
        stream_capabilities: streamPayload.stream_capabilities || payloadCamera.stream_capabilities || publicCamera.stream_capabilities,
        external_use_proxy: streamPayload.external_use_proxy ?? payloadCamera.external_use_proxy ?? publicCamera.external_use_proxy,
        external_tls_mode: streamPayload.external_tls_mode ?? payloadCamera.external_tls_mode ?? publicCamera.external_tls_mode,
        external_stream_url: streamPayload.external_stream_url || payloadCamera.external_stream_url || publicCamera.external_stream_url,
        external_embed_url: streamPayload.external_embed_url || payloadCamera.external_embed_url || publicCamera.external_embed_url,
        external_snapshot_url: publicCamera.external_snapshot_url || streamPayload.external_snapshot_url || payloadCamera.external_snapshot_url,
        external_origin_mode: streamPayload.external_origin_mode || payloadCamera.external_origin_mode || publicCamera.external_origin_mode,
        availability_state: streamPayload.availability_state || payloadCamera.availability_state || publicCamera.availability_state,
        availability_reason: streamPayload.availability_reason || payloadCamera.availability_reason || publicCamera.availability_reason,
        availability_confidence: streamPayload.availability_confidence ?? payloadCamera.availability_confidence ?? publicCamera.availability_confidence,
    };
}

export async function resolvePublicPopupCamera(camera, standardCameras = []) {
    if (!camera) {
        return null;
    }

    if (hasHlsStream(camera)) {
        return camera;
    }

    const matchingStandardCamera = standardCameras.find((item) => item?.id === camera.id);
    if (hasHlsStream(matchingStandardCamera)) {
        return mergePublicCameraWithStreamPayload(camera, matchingStandardCamera);
    }

    const response = await streamService.getStreamUrls(camera.id);
    return mergePublicCameraWithStreamPayload(camera, response?.data || {});
}

export default resolvePublicPopupCamera;
