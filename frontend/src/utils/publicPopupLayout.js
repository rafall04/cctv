export const DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO = 16 / 9;
export const NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO = 16 / 9;
export const COMMON_PUBLIC_POPUP_ASPECT_RATIOS = [
    16 / 9,
    4 / 3,
    1,
    3 / 2,
];
export const PUBLIC_POPUP_ASPECT_RATIO_SNAP_TOLERANCE = 0.025;

export function getPublicPopupBodyStyle({ isFullscreen, isPlaybackLocked, videoAspectRatio }) {
    if (isFullscreen) {
        return { aspectRatio: 'auto' };
    }

    const nextAspectRatio = isPlaybackLocked
        ? NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO
        : videoAspectRatio || DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO;

    return {
        aspectRatio: String(nextAspectRatio),
    };
}

export function getVideoAspectRatio(video) {
    if (!video) return null;
    const width = Number(video.videoWidth);
    const height = Number(video.videoHeight);

    if (!width || !height) return null;
    return normalizePublicPopupAspectRatio(width / height);
}

export function normalizePublicPopupAspectRatio(ratio) {
    const nextRatio = Number(ratio);
    if (!nextRatio || nextRatio <= 0) return null;

    let closestRatio = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const commonRatio of COMMON_PUBLIC_POPUP_ASPECT_RATIOS) {
        const distance = Math.abs(nextRatio - commonRatio);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestRatio = commonRatio;
        }
    }

    if (!closestRatio) {
        return nextRatio;
    }

    const maxSnapDistance = closestRatio * PUBLIC_POPUP_ASPECT_RATIO_SNAP_TOLERANCE;
    return closestDistance <= maxSnapDistance ? closestRatio : nextRatio;
}
