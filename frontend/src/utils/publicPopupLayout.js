/*
Purpose: Compute the popup modal + body layout for the public live-camera popup.
Caller: VideoPopup, publicPopupLayout tests.
Deps: None — pure functions.
MainFuncs: getPublicPopupBodyStyle, getPublicPopupModalStyle, getVideoAspectRatio, normalizePublicPopupAspectRatio.
SideEffects: None.

Design philosophy (v2):
  - The VIDEO is the popup's primary content. We size the modal so the
    video lands at a target fraction of the viewport HEIGHT, regardless
    of how much chrome (title, sponsor badge, detail panel, related
    strip, ads) flows above or below.
  - Everything else scrolls. The modal has `overflow-y-auto`, so total
    content beyond the viewport scrolls naturally — the user keeps
    full image clarity instead of watching the video shrink to make
    room for ads.
  - Mixed aspect ratios are first-class: the body uses CSS
    `aspect-ratio: <ratio>` driven by `videoAspectRatio`, so a 4:3 or
    1:1 or portrait 9:16 camera fills its modal natively without
    letterboxing inside the modal. The modal WIDTH is what flexes per
    aspect ratio, not the body within.
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
// Legacy header/footer height constants — kept for callers that still
// pass them as args, but no longer used in the modal-width formula.
// Header/footer/details/ads/related no longer steal real estate from
// the video; they scroll instead.
export const DEFAULT_PUBLIC_POPUP_HEADER_HEIGHT = 88;
export const DEFAULT_PUBLIC_POPUP_FOOTER_HEIGHT = 64;
// Fraction of viewport HEIGHT the video targets when sizing the modal.
// 0.78 picked empirically: leaves enough room for the title bar +
// status pills to be visible without scrolling on most desktop sizes,
// while keeping the camera image dominant. Tuning above ~0.85 cramps
// the chrome; below ~0.65 the video starts feeling like a thumbnail.
export const PUBLIC_POPUP_VIDEO_HEIGHT_FRACTION = 0.78;
// Hard cap so a 4K monitor doesn't render a 3000-pixel-wide modal that
// reads like a billboard. 1280 covers up-to-WQHD comfortably; users on
// 4K+ can still hit Fullscreen for edge-to-edge.
export const DEFAULT_PUBLIC_POPUP_MAX_DESKTOP_WIDTH = 1280;
// Floor so a portrait-aspect camera (e.g., 9:16 phone-mounted source)
// doesn't collapse to a 280-pixel sliver where the title / action
// buttons get unreadable. Below this we accept the modal being WIDER
// than the video's native aspect demands; the body still uses
// aspect-ratio CSS so the video itself stays correctly proportioned
// — only the surrounding chrome gets a little extra horizontal room.
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
    };
}

export function getPublicPopupModalStyle({
    isFullscreen,
    isPlaybackLocked,
    videoAspectRatio,
    viewportWidth,
    viewportHeight,
    maxDesktopWidth,
    minDesktopWidth = PUBLIC_POPUP_MIN_DESKTOP_WIDTH,
    viewportVerticalPadding = DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING,
    viewportHorizontalPadding = DEFAULT_PUBLIC_POPUP_VIEWPORT_HORIZONTAL_PADDING,
    videoHeightFraction = PUBLIC_POPUP_VIDEO_HEIGHT_FRACTION,
    // Note: headerHeight / footerHeight / topAdHeight / bottomAdHeight
    // are silently accepted but ignored — kept so v1 callers don't
    // break their bindings. The video-priority formula sizes against
    // viewport height directly; the modal scrolls if chrome overflows.
    ...legacyArgs
}) {
    // Touch legacyArgs once so the linter knows we consume the rest
    // parameter (we intentionally don't use the values inside).
    void legacyArgs;
    if (isFullscreen) {
        return {};
    }

    // `calc(100vh - <padding>)` lets the modal grow up to the visible
    // viewport, with `overflow-y-auto` (set on the modal element by the
    // component) handling everything past that.
    const verticalPaddingPx = Number(viewportVerticalPadding)
        || DEFAULT_PUBLIC_POPUP_VIEWPORT_VERTICAL_PADDING;
    const modalStyle = { maxHeight: `calc(100vh - ${verticalPaddingPx}px)` };

    if (isPlaybackLocked) {
        // Non-live state (CORS-blocked, codec-incompatible, offline). We
        // keep a stable rectangular layout instead of trying to size to
        // a live aspect ratio that the player will never reach.
        return modalStyle;
    }

    const nextViewportWidth = Number(viewportWidth);
    const nextViewportHeight = Number(viewportHeight);
    if (!nextViewportWidth || !nextViewportHeight) {
        return modalStyle;
    }
    if (nextViewportWidth < PUBLIC_POPUP_DESKTOP_BREAKPOINT) {
        // Mobile/tablet portrait: let the modal use its CSS `w-full`
        // width with the same height cap. Imposing a JS width here
        // would fight with Tailwind's responsive classes.
        return modalStyle;
    }

    const aspectRatio = Number(videoAspectRatio) || DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO;
    if (aspectRatio <= 0) {
        return modalStyle;
    }

    // Target video size: a deliberate fraction of viewport height. We
    // then compute modal width from that height + aspect ratio — the
    // modal is "sized for the video", everything else scrolls.
    const fraction = Number(videoHeightFraction) || PUBLIC_POPUP_VIDEO_HEIGHT_FRACTION;
    const clampedFraction = Math.max(0.4, Math.min(0.95, fraction));
    const targetVideoHeight = Math.floor(nextViewportHeight * clampedFraction);
    const targetVideoWidth = Math.floor(targetVideoHeight * aspectRatio);

    const availableViewportWidth = nextViewportWidth - viewportHorizontalPadding;
    const cap = Number(maxDesktopWidth) || DEFAULT_PUBLIC_POPUP_MAX_DESKTOP_WIDTH;

    const computedModalWidth = Math.floor(Math.min(
        cap,
        availableViewportWidth,
        targetVideoWidth,
    ));

    // Apply the minimum-width floor unless the viewport itself is
    // narrower (in which case `w-full` will take over).
    const minWidthFloor = Math.min(Number(minDesktopWidth) || PUBLIC_POPUP_MIN_DESKTOP_WIDTH, availableViewportWidth);
    const finalModalWidth = Math.max(minWidthFloor, computedModalWidth);

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
