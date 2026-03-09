export const DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO = 16 / 9;
export const NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO = 16 / 9;
export const COMMON_PUBLIC_POPUP_ASPECT_RATIOS = [
    16 / 9,
    4 / 3,
    1,
    3 / 2,
];
export const PUBLIC_POPUP_ASPECT_RATIO_SNAP_TOLERANCE = 0.025;
export const PUBLIC_POPUP_DESKTOP_BREAKPOINT = 768;
export const DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING = 16;
export const DEFAULT_PUBLIC_POPUP_VIEWPORT_HORIZONTAL_PADDING = 32;
export const DEFAULT_PUBLIC_POPUP_HEADER_HEIGHT = 88;
export const DEFAULT_PUBLIC_POPUP_FOOTER_HEIGHT = 64;

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

export function getPublicPopupModalStyle({
    isFullscreen,
    isPlaybackLocked,
    videoAspectRatio,
    viewportWidth,
    viewportHeight,
    headerHeight,
    footerHeight,
    maxDesktopWidth,
    viewportVerticalPadding = DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING,
    viewportHorizontalPadding = DEFAULT_PUBLIC_POPUP_VIEWPORT_HORIZONTAL_PADDING,
}) {
    if (isFullscreen) {
        return {};
    }

    const modalStyle = { maxHeight: 'calc(100vh - 16px)' };

    if (isPlaybackLocked) {
        return modalStyle;
    }

    const nextViewportWidth = Number(viewportWidth);
    const nextViewportHeight = Number(viewportHeight);
    if (!nextViewportWidth || !nextViewportHeight || nextViewportWidth < PUBLIC_POPUP_DESKTOP_BREAKPOINT) {
        return modalStyle;
    }

    const nextAspectRatio = Number(videoAspectRatio) || DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO;
    const nextHeaderHeight = Number(headerHeight) || DEFAULT_PUBLIC_POPUP_HEADER_HEIGHT;
    const nextFooterHeight = Number(footerHeight) || DEFAULT_PUBLIC_POPUP_FOOTER_HEIGHT;
    const availableBodyHeight = nextViewportHeight - viewportVerticalPadding - nextHeaderHeight - nextFooterHeight;
    const availableViewportWidth = nextViewportWidth - viewportHorizontalPadding;

    if (availableBodyHeight <= 0 || availableViewportWidth <= 0) {
        return modalStyle;
    }

    const computedModalWidth = Math.floor(Math.min(
        Number(maxDesktopWidth) || availableViewportWidth,
        availableViewportWidth,
        availableBodyHeight * nextAspectRatio
    ));

    if (computedModalWidth > 0) {
        modalStyle.width = `${computedModalWidth}px`;
    }

    return modalStyle;
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
