/*
Purpose: Normalize per-camera thumbnail capture strategy for camera admin writes and thumbnail generation.
Caller: cameraService and thumbnailService.
Deps: None.
MainFuncs: normalizeThumbnailStrategy().
SideEffects: None.
*/

const THUMBNAIL_STRATEGY_VALUES = new Set(['default', 'direct_rtsp', 'hls_fallback', 'hls_only']);

export function normalizeThumbnailStrategy(value) {
    return THUMBNAIL_STRATEGY_VALUES.has(value) ? value : 'default';
}

export { THUMBNAIL_STRATEGY_VALUES };
