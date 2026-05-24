/*
Purpose: Compute the popup modal + body layout for the public live-camera popup.
Caller: VideoPopup, publicPopupLayout tests.
Deps: None — pure functions.
MainFuncs: getPublicPopupBodyStyle, getPublicPopupModalStyle, getVideoAspectRatio, normalizePublicPopupAspectRatio.
SideEffects: None.

Design philosophy (v4, aspect-ratio fit):
  - The modal is sized to the LARGEST rectangle that fits inside the
    viewport while respecting the camera's native aspect ratio.
      modalWidth = min(viewportWidth, viewportHeight * aspectRatio)
    A 16:9 camera in a 16:9 viewport spans edge-to-edge. A 4:3 camera
    in the same viewport gets a narrower modal centered with side
    margins. A 9:16 portrait camera gets a tall narrow modal. The
    sides "adjust to the CCTV's aspect ratio" as the user wanted.
  - The video body uses CSS `aspect-ratio: <ratio>` driven by
    `videoAspectRatio`, so the frame fills the modal width natively
    without letterbox bars inside the modal.
  - Total content (sticky header + video + detail panel + sponsor ad
    + related strip + footer) is allowed to exceed the viewport
    height; the modal has `overflow-y-auto` to scroll. The header is
    `position: sticky` so the camera name + close button stay
    anchored even when the user scrolls past the video to read
    chrome / ads / related cameras.
  - There is NO width cap on desktop. Ultra-wide / 4K monitors get a
    proportionally bigger video — that's the point of an aspect-fit
    layout. Users wanting absolute maximum still have Fullscreen.
  - Locked-playback (CORS / codec / offline) keeps the bare
    `maxHeight` only — a stable rectangular shell reads better as
    "this thing failed" than as a confident full-aspect card.
  - Mobile (< desktop breakpoint) keeps Tailwind's `w-full` —
    portrait phones already get edge-to-edge from CSS, no JS sizing.
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
export const DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING = 0;
export const DEFAULT_PUBLIC_POPUP_VIEWPORT_HORIZONTAL_PADDING = 0;
export const DEFAULT_PUBLIC_POPUP_HEADER_HEIGHT = 88;
export const DEFAULT_PUBLIC_POPUP_FOOTER_HEIGHT = 64;
// Floor so a 9:16 portrait CCTV in a tall-ish landscape viewport
// doesn't collapse to a 300-px sliver where the title bar + action
// buttons get cramped. Below this we accept the modal being WIDER
// than the camera's native aspect demands; the body still uses
// aspect-ratio CSS so the actual video frame stays correctly
// proportioned (the surrounding chrome just gets a touch more room).
export const PUBLIC_POPUP_MIN_DESKTOP_WIDTH = 400;
// Legacy exports kept for source-compat with older callers + tests.
// v4 sizing does NOT use these; the previous v2/v3 modal-width caps
// are gone in favor of pure aspect-ratio fit.
export const PUBLIC_POPUP_VIDEO_HEIGHT_FRACTION = 0.78;
export const DEFAULT_PUBLIC_POPUP_MAX_DESKTOP_WIDTH = 1280;
export const PUBLIC_POPUP_BODY_MAX_HEIGHT_VH = 100;

export function getPublicPopupBodyStyle({ isFullscreen, isPlaybackLocked, videoAspectRatio }) {
    if (isFullscreen) {
        return { aspectRatio: 'auto' };
    }

    const nextAspectRatio = isPlaybackLocked
        ? NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO
        : videoAspectRatio || DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO;

    // No `maxHeight` constraint here. The modal-width math above
    // already ensures `modalWidth ≤ viewportHeight * aspectRatio`, so
    // the body's aspect-ratio-derived height never exceeds the
    // viewport on its own. Header + chrome above/below MAY push the
    // total over the viewport — the modal scrolls in that case.
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
    minDesktopWidth = PUBLIC_POPUP_MIN_DESKTOP_WIDTH,
    viewportVerticalPadding = DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING,
    viewportHorizontalPadding = DEFAULT_PUBLIC_POPUP_VIEWPORT_HORIZONTAL_PADDING,
    // Legacy args (maxDesktopWidth, videoHeightFraction, headerHeight,
    // footerHeight, topAdHeight, bottomAdHeight) are silently dropped.
    // Kept stable so existing callers don't have to chase renamed
    // bindings — see module header for the v4 sizing philosophy.
    ...legacyArgs
}) {
    void legacyArgs;

    if (isFullscreen) {
        return {};
    }

    const verticalPaddingPx = Number(viewportVerticalPadding) >= 0
        ? Number(viewportVerticalPadding)
        : DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING;
    const modalStyle = {
        maxHeight: verticalPaddingPx > 0
            ? `calc(100vh - ${verticalPaddingPx}px)`
            : '100vh',
    };

    if (isPlaybackLocked) {
        // Non-live state (CORS-blocked, codec-incompatible, offline).
        // Keep a stable rectangular shell — full aspect-fit reads as
        // "this is live and important", which is the wrong vibe for
        // an error screen.
        return modalStyle;
    }

    const nextViewportWidth = Number(viewportWidth);
    const nextViewportHeight = Number(viewportHeight);
    if (!nextViewportWidth || !nextViewportHeight) {
        return modalStyle;
    }
    if (nextViewportWidth < PUBLIC_POPUP_DESKTOP_BREAKPOINT) {
        // Mobile: Tailwind `w-full` handles edge-to-edge. JS sizing
        // here would only fight the responsive class set.
        return modalStyle;
    }

    const aspectRatio = Number(videoAspectRatio) || DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO;
    if (aspectRatio <= 0) {
        return modalStyle;
    }

    // Largest rectangle that fits inside the viewport while
    // respecting the camera's aspect ratio:
    //   width  = min(viewportWidth,  viewportHeight * aspectRatio)
    //   height = width / aspectRatio   (locked by body's aspect-ratio CSS)
    // For a 16:9 camera in a 16:9 viewport the two arms tie and the
    // modal spans edge-to-edge; for any other aspect mismatch the
    // smaller arm wins and the modal centers with side margins.
    const horizontalPaddingPx = Number(viewportHorizontalPadding) >= 0
        ? Number(viewportHorizontalPadding)
        : DEFAULT_PUBLIC_POPUP_VIEWPORT_HORIZONTAL_PADDING;
    const availableViewportWidth = nextViewportWidth - horizontalPaddingPx;
    const widthBoundWidth = availableViewportWidth;
    const heightBoundWidth = nextViewportHeight * aspectRatio;
    const aspectFitWidth = Math.floor(Math.min(widthBoundWidth, heightBoundWidth));

    // Min-width floor for portrait cameras so the title bar + action
    // buttons + share controls stay readable. The video itself still
    // honours its aspect ratio inside via the body's aspect-ratio CSS;
    // only the surrounding chrome gets a bit of extra room.
    const minWidthFloor = Math.min(
        Number(minDesktopWidth) || PUBLIC_POPUP_MIN_DESKTOP_WIDTH,
        availableViewportWidth,
    );
    const finalModalWidth = Math.max(minWidthFloor, aspectFitWidth);

    if (finalModalWidth > 0) {
        modalStyle.width = `${finalModalWidth}px`;
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
