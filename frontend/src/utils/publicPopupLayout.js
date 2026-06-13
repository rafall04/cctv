/*
Purpose: Compute the popup modal + body layout for the public live-camera popup.
Caller: VideoPopup, publicPopupLayout tests.
Deps: None — pure functions.
MainFuncs: getPublicPopupBodyStyle, getPublicPopupModalStyle, getVideoAspectRatio, normalizePublicPopupAspectRatio.
SideEffects: None.

Design philosophy (v7, aspect-ratio fit + chrome budget):
  - The modal width is sized so the video, AT the camera's native
    aspect ratio, fills the viewport height that's LEFT OVER after
    reserving room for the always-on-screen chrome (sticky header +
    slim controls bar):
      videoHeight = max(MIN_VIDEO_HEIGHT, viewportHeight - chromeHeight)
      modalWidth  = min(viewportWidth, videoHeight * aspectRatio)
    So header + video + controls together = one screen ("video fit
    screen, controls visible"). A 4:3 camera gets a narrower modal, a
    9:16 portrait one a tall-narrow modal — the sides auto-adjust to
    each camera's real ratio.
  - The detail panel, related strip, and the sponsor AD are NOT part
    of chromeHeight on purpose: they live below the video + controls,
    so when an ad is present the modal grows past the viewport and the
    BACKDROP (overflow-y-auto, in VideoPopup.jsx) scrolls down to them.
    That is the "ada iklan -> tetap fit, scroll bawah" behaviour.
  - chromeHeight defaults to 0. With 0 it reduces to the prior
    full-viewport sizing — what callers that don't measure chrome get,
    and what the jsdom tests get (offsetHeight is 0 there). A safe,
    backward-compatible fallback.
  - The video body uses CSS `aspect-ratio: <ratio>`; with the width
    chosen above its derived height equals the budget exactly, so the
    frame fills the modal with NO letterbox and NO modal max-height
    (the max-height + flex + aspect-ratio combo was the v4/v5
    pillarbox bug — kept dead here).
  - No width cap on desktop. Ultra-wide / 4K monitors get a
    proportionally bigger video. Fullscreen is the "even bigger" escape.
  - Locked-playback (CORS / codec / offline) keeps the bare
    `maxHeight` only — a stable rectangular shell reads better as
    "this thing failed" than as a confident full-aspect card.
  - Mobile (< desktop breakpoint) keeps Tailwind's `w-full` — portrait
    phones get fit-width from CSS, chrome + ad stack below, no JS
    sizing (chromeHeight is ignored there).
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
// Minimum video height (px) so an extreme chrome budget (tiny window +
// tall header/controls) can't collapse the video into a sliver. Below
// this we let the modal grow past the viewport and the backdrop
// scrolls, rather than shrink the video into uselessness.
export const PUBLIC_POPUP_MIN_VIDEO_HEIGHT = 240;
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
    // v7: vertical room reserved for the always-on-screen chrome
    // (sticky header + slim controls bar). NOT the ad/detail/related —
    // those overflow below the fold and the backdrop scrolls to them.
    // Defaults to 0 → reduces to the prior full-viewport sizing.
    chromeHeight = 0,
    minVideoHeight = PUBLIC_POPUP_MIN_VIDEO_HEIGHT,
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

    if (isPlaybackLocked) {
        // Non-live state (CORS-blocked, codec-incompatible, offline).
        // KEEP the max-height cap so the error card stays sensibly
        // sized — full aspect-fit reads as "this is live and
        // important" which is the wrong vibe for an error screen.
        return {
            maxHeight: verticalPaddingPx > 0
                ? `calc(100vh - ${verticalPaddingPx}px)`
                : '100vh',
        };
    }

    const nextViewportWidth = Number(viewportWidth);
    const nextViewportHeight = Number(viewportHeight);
    if (!nextViewportWidth || !nextViewportHeight) {
        return {};
    }
    if (nextViewportWidth < PUBLIC_POPUP_DESKTOP_BREAKPOINT) {
        // Mobile: Tailwind `w-full` handles edge-to-edge. JS sizing
        // here would only fight the responsive class set. Backdrop
        // scrolls when total content exceeds viewport.
        return {};
    }

    const aspectRatio = Number(videoAspectRatio) || DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO;
    if (aspectRatio <= 0) {
        return {};
    }

    // Largest rectangle that fits inside the viewport while
    // respecting the camera's aspect ratio:
    //   width  = min(viewportWidth,  viewportHeight * aspectRatio)
    //   height = width / aspectRatio   (locked by body's aspect-ratio CSS)
    //
    // CRITICAL v6 change: we do NOT set `maxHeight` on the modal.
    // Previously the maxHeight + flex-col + body's aspect-ratio caused
    // a constraint conflict: the modal capped at 100vh, flex shrank
    // the body shorter than (width / aspectRatio), the body's CSS
    // aspect-ratio was violated, the <video> inside object-fit-
    // contain'd into the misshapen body, and we got pillarbox bars
    // showing the body bg on either side of the actual frame. With
    // maxHeight gone, the body is free to stretch to its full
    // aspect-derived height, the video fills it without letterbox,
    // and the BACKDROP (set up to scroll in VideoPopup.jsx) handles
    // overflow when total content > viewport height.
    const horizontalPaddingPx = Number(viewportHorizontalPadding) >= 0
        ? Number(viewportHorizontalPadding)
        : DEFAULT_PUBLIC_POPUP_VIEWPORT_HORIZONTAL_PADDING;
    const availableViewportWidth = nextViewportWidth - horizontalPaddingPx;

    // v7 chrome budget: the video fills the viewport height that
    // remains AFTER the sticky header + controls bar. Clamp to a floor
    // so a tiny window / tall chrome can't shrink the video to a sliver
    // (it then overflows + the backdrop scrolls instead). The ad is
    // deliberately excluded so it lands below the fold.
    const safeChromeHeight = Number(chromeHeight) > 0 ? Number(chromeHeight) : 0;
    const minVideoHeightPx = Number(minVideoHeight) > 0
        ? Number(minVideoHeight)
        : PUBLIC_POPUP_MIN_VIDEO_HEIGHT;
    const budgetedVideoHeight = Math.max(
        minVideoHeightPx,
        nextViewportHeight - safeChromeHeight - verticalPaddingPx,
    );

    const widthBoundWidth = availableViewportWidth;
    const heightBoundWidth = budgetedVideoHeight * aspectRatio;
    const aspectFitWidth = Math.floor(Math.min(widthBoundWidth, heightBoundWidth));

    // Min-width floor for portrait cameras so the title bar + action
    // buttons stay readable. The video itself still honours its aspect
    // ratio inside via the body's aspect-ratio CSS.
    const minWidthFloor = Math.min(
        Number(minDesktopWidth) || PUBLIC_POPUP_MIN_DESKTOP_WIDTH,
        availableViewportWidth,
    );
    const finalModalWidth = Math.max(minWidthFloor, aspectFitWidth);

    return finalModalWidth > 0 ? { width: `${finalModalWidth}px` } : {};
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
