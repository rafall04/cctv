/*
Purpose: Pure geometry for the fullscreen "fill on zoom" behaviour of ZoomableVideo.
Caller: ZoomableVideo, zoomFit tests.
Deps: None — pure functions.
MainFuncs: computeFitFractions, fillScaleFrom, appliedScale, maxPanPercent.
SideEffects: None.

The problem: a camera whose aspect ratio differs from the fullscreen viewport (e.g. a 16:9
camera on an ultrawide phone in landscape, or a 4:3 camera on a 16:9 screen) can only ever be
shown as EITHER letterbox black bars (object-contain) OR a permanent crop (object-cover). We
keep object-CONTAIN so the whole frame is always present and reachable by pan, and instead
BOOST the CSS scale once the user zooms in so the frame fills the viewport — the bars vanish
because the content is scaled past the viewport edge, not because any pixels were thrown away.
*/

// Fraction of the viewport that an object-contain'd frame occupies on each axis at scale 1.
// The SHORT axis is < 1 — that's the side the black bars sit on.
//   videoAspect / viewportAspect are width/height ratios (> 0).
export function computeFitFractions(videoAspect, viewportAspect) {
    if (!(videoAspect > 0) || !(viewportAspect > 0)) return { fw: 1, fh: 1 };
    if (videoAspect <= viewportAspect) {
        // Video narrower than the viewport → contain fits by HEIGHT → bars left/right.
        return { fw: videoAspect / viewportAspect, fh: 1 };
    }
    // Video wider than the viewport → contain fits by WIDTH → bars top/bottom.
    return { fw: 1, fh: viewportAspect / videoAspect };
}

// The scale that makes the SHORT axis just reach the viewport edge (bars gone). >= 1.
export function fillScaleFrom({ fw, fh }) {
    const m = Math.min(fw, fh);
    return m > 0 ? 1 / m : 1;
}

// Actual CSS scale to apply. In fullscreen, the moment the user zooms in (zoom > 1) we
// multiply by fillScale so even the first nudge fills the viewport width — no pillarbox.
// At 1x (overview) and when windowed we apply the raw zoom, so the whole frame shows with
// its natural, honest letterbox.
export function appliedScale(zoom, fillScale, isFullscreen) {
    return isFullscreen && zoom > 1 ? zoom * fillScale : zoom;
}

// Max |translate| (percent of the element) allowed on one axis so the content edge cannot be
// dragged inside the viewport. `f` is that axis's contain fraction at scale 1 (from
// computeFitFractions). Returns 0 when that axis doesn't overflow (nothing to pan into).
// Mirrors the CSS `scale(s) translate(t%)` order: visual shift = s * (t/100) * size.
export function maxPanPercent(zoom, f, fillScale, isFullscreen) {
    const s = appliedScale(zoom, fillScale, isFullscreen);
    if (!(s > 0)) return 0;
    const frac = f * s;
    return frac <= 1 ? 0 : ((frac - 1) / (2 * s)) * 100;
}
