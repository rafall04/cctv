/*
Purpose: Compute the popup modal + body layout for the public live-camera popup.
Caller: VideoPopup, publicPopupLayout tests.
Deps: None — pure functions.
MainFuncs: getPublicPopupBodyStyle, getPublicPopupModalStyle, getVideoAspectRatio, normalizePublicPopupAspectRatio.
SideEffects: None.

Design philosophy (v3, full-bleed):
  - The popup is full viewport width on desktop. No side backdrop,
    no `max-width` cap, no centered "card" feel — the camera image
    spans edge-to-edge so it reads as big as the source allows.
  - Total content (sticky header + video + detail panel + ads +
    related strip + footer) is allowed to exceed the viewport
    height. The modal has `overflow-y-auto`, so it scrolls. The
    header in VideoPopup.jsx is `position: sticky` so the camera
    name + close button stay visible while the user scrolls.
  - Mixed aspect ratios stay first-class: the body uses
    `aspect-ratio: <ratio>` driven by `videoAspectRatio`, so 4:3 /
    1:1 / 9:16 cameras scale naturally. A `max-height` cap on the
    body prevents 16:9 cameras from eating the entire 4K monitor —
    when the cap kicks in the <video> letterboxes inside the body
    (object-fit: contain), no clipped frames.
  - Mobile is unchanged. Tailwind's `w-full` already gives edge-to-
    edge there.
*/

export const DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO = 16 / 9;
export const NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO = 16 / 9;
export const COMMON_PUBLIC_POPUP_ASPECT_RATIOS = [
    16 / 9,
    4 / 3,
    1,
    3 / 2,
    9 / 16,
    3 / 4,
];
export const PUBLIC_POPUP_ASPECT_RATIO_SNAP_TOLERANCE = 0.025;
export const PUBLIC_POPUP_DESKTOP_BREAKPOINT = 768;
export const DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING = 16;
export const DEFAULT_PUBLIC_POPUP_VIEWPORT_HORIZONTAL_PADDING = 32;
export const DEFAULT_PUBLIC_POPUP_HEADER_HEIGHT = 88;
export const DEFAULT_PUBLIC_POPUP_FOOTER_HEIGHT = 64;
// Body height cap as a fraction of viewport. 92vh keeps a sliver of
// header visible at the top even before sticky kicks in, on viewports
// where the modal mounts already scrolled. The <video> letterboxes
// inside (object-fit: contain) if its aspect ratio collides with the
// cap — no clipped image.
export const PUBLIC_POPUP_BODY_MAX_HEIGHT_VH = 92;
// Legacy exports — kept for source-compat with v1/v2 callers + tests
// that still import these names. v3 sizing does NOT use them.
export const PUBLIC_POPUP_VIDEO_HEIGHT_FRACTION = 0.78;
export const DEFAULT_PUBLIC_POPUP_MAX_DESKTOP_WIDTH = 1280;
export const PUBLIC_POPUP_MIN_DESKTOP_WIDTH = 480;

export function getPublicPopupBodyStyle({ isFullscreen, isPlaybackLocked, videoAspectRatio }) {
    if (isFullscreen) {
        return { aspectRatio: 'auto' };
    }

    const nextAspectRatio = isPlaybackLocked
        ? NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO
        : videoAspectRatio || DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO;

    return {
        aspectRatio: String(nextAspectRatio),
        // Cap keeps header visible even when the natural aspect-ratio
        // height would otherwise fill (or exceed) the viewport. See
        // module header for the letterbox trade-off.
        maxHeight: `${PUBLIC_POPUP_BODY_MAX_HEIGHT_VH}vh`,
    };
}

export function getPublicPopupModalStyle({
    isFullscreen,
    isPlaybackLocked,
    viewportWidth,
    viewportVerticalPadding = DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING,
    // Legacy args (videoAspectRatio, viewportHeight, maxDesktopWidth,
    // minDesktopWidth, viewportHorizontalPadding, videoHeightFraction,
    // headerHeight, footerHeight, topAdHeight, bottomAdHeight) are
    // accepted but ignored under v3 full-bleed sizing. Kept stable so
    // existing callers + tests don't have to chase renamed args.
    ...legacyArgs
}) {
    void legacyArgs;

    if (isFullscreen) {
        return {};
    }

    const verticalPaddingPx = Number(viewportVerticalPadding)
        || DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING;
    const modalStyle = { maxHeight: `calc(100vh - ${verticalPaddingPx}px)` };

    if (isPlaybackLocked) {
        // Non-live state (CORS-blocked, codec-incompatible, offline).
        // A centered card reads better as "this thing failed" than
        // full-bleed full-width — full-bleed implies success/live.
        return modalStyle;
    }

    const nextViewportWidth = Number(viewportWidth);
    if (!nextViewportWidth) {
        return modalStyle;
    }
    if (nextViewportWidth < PUBLIC_POPUP_DESKTOP_BREAKPOINT) {
        // Mobile/tablet portrait already gets edge-to-edge from
        // Tailwind's `w-full`. JS sizing would fight responsive
        // classes — leave it alone.
        return modalStyle;
    }

    // Desktop: full-bleed 100% of viewport. No `max-width` cap —
    // ultra-wide monitors get a proportionally bigger video, with the
    // body `max-height` cap (92vh) keeping the header visible.
    modalStyle.width = '100vw';
    modalStyle.maxWidth = '100vw';

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
