/*
Purpose: Provide pointer/wheel/pinch zoom and pan behavior for multi-view video elements.
Caller: MultiViewVideoItem, VideoPopup.
Deps: React refs/callbacks/effects/forwardRef/imperativeHandle, device tier detection, RAF transform throttle, zoomFit geometry.
MainFuncs: ZoomableVideo.
SideEffects: Mutates wrapper/video DOM style and exposes zoom controls via imperative ref.
*/

import { useRef, useCallback, useEffect, useState, memo, forwardRef, useImperativeHandle } from 'react';
import { detectDeviceTier } from '../../utils/deviceDetector.js';
import { createTransformThrottle } from '../../utils/rafThrottle.js';
import { computeFitFractions, fillScaleFrom, appliedScale, maxPanPercent } from '../../utils/zoomFit.js';

// ZOOMABLE VIDEO COMPONENT - Optimized for low-end devices
// Disables heavy features (willChange, RAF throttle) on low-end
// ============================================
const ZoomableVideo = memo(forwardRef(function ZoomableVideo(
    { videoRef, maxZoom = 4, onZoomChange, isFullscreen = false },
    ref,
) {
    const wrapperRef = useRef(null);
    const transformThrottleRef = useRef(null);
    const stateRef = useRef({
        zoom: 1, panX: 0, panY: 0,
        dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0,
        // Pinch-to-zoom state
        pinchStartDist: 0, pinchStartZoom: 1,
    });
    // Active pointers for multi-touch (pinch) gesture tracking. Map keyed by
    // pointerId so the gesture survives finger-by-finger lift/touch without
    // losing the other pointer's last known position.
    const pointersRef = useRef(new Map());
    // currentZoom mirrors stateRef.zoom but as React state so the wrapper's
    // CSS `touch-action` can be reactive — `none` only when zoomed so the
    // page stays scrollable when the tile is at 1x.
    const [currentZoom, setCurrentZoom] = useState(1);
    const isLowEnd = detectDeviceTier() === 'low';

    // Latest isFullscreen, readable from the dep-less transform helpers below
    // without threading it through every gesture callback's dependency list.
    const isFullscreenRef = useRef(isFullscreen);
    isFullscreenRef.current = isFullscreen;

    // Aspect-fit metrics for the FULLSCREEN fill-on-zoom behaviour (refreshFit()):
    //   fw/fh     = fraction of the viewport the object-contain'd frame fills per axis at 1x
    //               (the short axis < 1 is where the black bars sit).
    //   fillScale = scale that makes the short axis reach the viewport edge (bars gone).
    const fitRef = useRef({ fw: 1, fh: 1, fillScale: 1 });

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // Recompute fit metrics from the live <video> intrinsic size vs the wrapper (= viewport
    // in fullscreen). Cheap: one layout read, called at the START of each gesture, not per
    // frame. Falls back to neutral {1,1,1} until metadata/layout is available.
    const refreshFit = useCallback(() => {
        const video = videoRef.current;
        const el = wrapperRef.current;
        let fractions = { fw: 1, fh: 1 };
        if (video && el) {
            const vw = Number(video.videoWidth) || 0;
            const vh = Number(video.videoHeight) || 0;
            const ew = el.clientWidth || 0;
            const eh = el.clientHeight || 0;
            if (vw && vh && ew && eh) {
                fractions = computeFitFractions(vw / vh, ew / eh);
            }
        }
        fitRef.current = { ...fractions, fillScale: fillScaleFrom(fractions) };
    }, [videoRef]);

    // Applied CSS scale. WINDOWED (or fullscreen at 1x) → raw zoom, honest letterbox. FULLSCREEN
    // + zoomed → boosted by fillScale so the first zoom already fills the viewport width (no
    // pillarbox), while object-contain keeps the whole frame present for pan to reach.
    const scaleFor = useCallback((zoom) => (
        appliedScale(zoom, fitRef.current.fillScale, isFullscreenRef.current)
    ), []);

    // Per-axis pan limits. Fullscreen uses the aspect-aware geometry so pan reaches the
    // overflow (incl. the top/bottom that fill pushes off-screen); windowed keeps the legacy
    // symmetric formula (there the body is already sized to the camera ratio, no bars).
    const legacyMaxPan = (zoom) => (zoom <= 1 ? 0 : ((zoom - 1) / (2 * zoom)) * 100);
    const getMaxPanX = useCallback((zoom) => (
        isFullscreenRef.current
            ? maxPanPercent(zoom, fitRef.current.fw, fitRef.current.fillScale, true)
            : legacyMaxPan(zoom)
    ), []);
    const getMaxPanY = useCallback((zoom) => (
        isFullscreenRef.current
            ? maxPanPercent(zoom, fitRef.current.fh, fitRef.current.fillScale, true)
            : legacyMaxPan(zoom)
    ), []);

    // Initialize RAF throttle on mount - skip on low-end
    useEffect(() => {
        if (wrapperRef.current && !isLowEnd) {
            transformThrottleRef.current = createTransformThrottle(wrapperRef.current);
        }
        return () => {
            transformThrottleRef.current?.cancel();
        };
    }, [isLowEnd]);

    const applyTransform = useCallback((animate = false) => {
        if (!wrapperRef.current) return;
        const { zoom, panX, panY } = stateRef.current;
        const s = scaleFor(zoom);

        if (animate && !isLowEnd) {
            wrapperRef.current.style.transition = 'transform 0.2s ease-out';
            wrapperRef.current.style.transform = `scale(${s}) translate(${panX}%, ${panY}%)`;
        } else {
            wrapperRef.current.style.transition = 'none';
            // On low-end, apply directly without RAF throttle
            if (transformThrottleRef.current && !isLowEnd) {
                transformThrottleRef.current.update(s, panX, panY);
            } else {
                wrapperRef.current.style.transform = `scale(${s}) translate(${panX}%, ${panY}%)`;
            }
        }
        // Push zoom into React state once per change so `touch-action` re-
        // renders. The hot pan-update path stays in the ref world.
        setCurrentZoom(zoom);
        onZoomChange?.(zoom);
    }, [onZoomChange, isLowEnd, scaleFor]);

    const handleZoom = useCallback((delta, animate = true) => {
        refreshFit();
        const s = stateRef.current;
        s.zoom = clamp(s.zoom + delta, 1, maxZoom);
        if (s.zoom <= 1) { s.panX = 0; s.panY = 0; }
        else {
            const maxX = getMaxPanX(s.zoom);
            const maxY = getMaxPanY(s.zoom);
            s.panX = clamp(s.panX, -maxX, maxX);
            s.panY = clamp(s.panY, -maxY, maxY);
        }
        applyTransform(animate);
    }, [maxZoom, applyTransform, refreshFit, getMaxPanX, getMaxPanY]);

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        handleZoom(e.deltaY > 0 ? -0.5 : 0.5, false);
    }, [handleZoom]);

    const handlePointerDown = useCallback((e) => {
        const s = stateRef.current;
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointersRef.current.size === 2) {
            // Two pointers down → start pinch. Capture initial distance and
            // zoom level so we can scale relative to the user's natural
            // pinch gesture.
            refreshFit();
            const [p1, p2] = Array.from(pointersRef.current.values());
            s.pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
            s.pinchStartZoom = s.zoom;
            s.dragging = false; // Pan and pinch are mutually exclusive.
        } else if (pointersRef.current.size === 1 && s.zoom > 1) {
            // Single pointer down at zoom > 1 → start pan.
            refreshFit();
            s.dragging = true;
            s.startX = e.clientX;
            s.startY = e.clientY;
            s.startPanX = s.panX;
            s.startPanY = s.panY;
            wrapperRef.current.style.cursor = 'grabbing';
        }
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // Some elements refuse capture (e.g., during fullscreen transitions).
        }
    }, [refreshFit]);

    const handlePointerMove = useCallback((e) => {
        const s = stateRef.current;
        if (!pointersRef.current.has(e.pointerId)) return;
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointersRef.current.size === 2 && s.pinchStartDist > 0) {
            // Pinch-to-zoom: scale relative to the initial pinch distance.
            const [p1, p2] = Array.from(pointersRef.current.values());
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const ratio = dist / s.pinchStartDist;
            s.zoom = clamp(s.pinchStartZoom * ratio, 1, maxZoom);
            if (s.zoom <= 1) {
                s.panX = 0;
                s.panY = 0;
            } else {
                const maxX = getMaxPanX(s.zoom);
                const maxY = getMaxPanY(s.zoom);
                s.panX = clamp(s.panX, -maxX, maxX);
                s.panY = clamp(s.panY, -maxY, maxY);
            }
            // Pinch updates are continuous — skip the animated transition.
            const sc = scaleFor(s.zoom);
            if (transformThrottleRef.current && !isLowEnd) {
                transformThrottleRef.current.update(sc, s.panX, s.panY);
            } else if (wrapperRef.current) {
                wrapperRef.current.style.transform = `scale(${sc}) translate(${s.panX}%, ${s.panY}%)`;
            }
            // Sync React state at ~60fps cap so touchAction stays correct
            // even while pinching down past 1x.
            setCurrentZoom(s.zoom);
            onZoomChange?.(s.zoom);
            return;
        }

        if (!s.dragging) return;

        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        const maxX = getMaxPanX(s.zoom);
        const maxY = getMaxPanY(s.zoom);

        // Direct 1:1 mapping with container size factor
        const factor = 0.15; // Adjust for natural feel
        s.panX = clamp(s.startPanX + dx * factor, -maxX, maxX);
        s.panY = clamp(s.startPanY + dy * factor, -maxY, maxY);

        // On low-end, apply directly without RAF throttle
        const sc = scaleFor(s.zoom);
        if (transformThrottleRef.current && !isLowEnd) {
            transformThrottleRef.current.update(sc, s.panX, s.panY);
        } else if (wrapperRef.current) {
            wrapperRef.current.style.transform = `scale(${sc}) translate(${s.panX}%, ${s.panY}%)`;
        }
    }, [isLowEnd, maxZoom, onZoomChange, getMaxPanX, getMaxPanY, scaleFor]);

    const handlePointerUp = useCallback((e) => {
        const s = stateRef.current;
        pointersRef.current.delete(e.pointerId);

        // Drop pinch state once we're back to ≤1 pointer; commit final zoom
        // so the next pinch starts from a clean baseline.
        if (pointersRef.current.size < 2) {
            s.pinchStartDist = 0;
        }
        if (pointersRef.current.size === 0) {
            s.dragging = false;
            if (wrapperRef.current) wrapperRef.current.style.cursor = s.zoom > 1 ? 'grab' : 'default';
        }
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
            // Ignore pointer capture release races.
        }
    }, []);

    const reset = useCallback(() => {
        const s = stateRef.current;
        s.zoom = 1; s.panX = 0; s.panY = 0;
        applyTransform(true);
    }, [applyTransform]);

    // Imperative API for parent — preferred over the legacy
    // `wrapperRef.current._zoomIn = ...` pattern because it survives DOM
    // structural changes (parent doesn't have to know our internal layout).
    useImperativeHandle(ref, () => ({
        zoomIn: () => handleZoom(0.5),
        zoomOut: () => handleZoom(-0.5),
        reset,
        getZoom: () => stateRef.current.zoom,
    }), [handleZoom, reset]);

    // Backwards-compat shim for any caller still relying on the old
    // wrapperRef.current._zoomIn pattern (VideoPopup toggles fullscreen zoom
    // reset through here). Safe to remove once nothing else reaches into the DOM.
    useEffect(() => {
        if (wrapperRef.current) {
            wrapperRef.current._zoomIn = () => handleZoom(0.5);
            wrapperRef.current._zoomOut = () => handleZoom(-0.5);
            wrapperRef.current._reset = reset;
            wrapperRef.current._getZoom = () => stateRef.current.zoom;
        }
    }, [handleZoom, reset]);

    // Entering/leaving fullscreen changes the viewport aspect → the applied scale for the
    // current zoom changes too. Re-apply so a zoomed-in frame doesn't linger at a stale
    // scale. Only when actually zoomed (at 1x scaleFor is 1 regardless, and this avoids a
    // spurious onZoomChange on every fullscreen toggle).
    useEffect(() => {
        if (stateRef.current.zoom > 1) {
            refreshFit();
            applyTransform(false);
        }
    }, [isFullscreen, refreshFit, applyTransform]);

    return (
        <div
            ref={wrapperRef}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="w-full h-full"
            style={{
                transformOrigin: 'center center',
                cursor: currentZoom > 1 ? 'grab' : 'default',
                // Only block native scroll/zoom when actually zoomed-in.
                // At 1x, leave touchAction at `pan-y pan-x` so the page
                // remains scrollable when a finger lands on the tile.
                touchAction: currentZoom > 1 ? 'none' : 'pan-x pan-y',
                // CRITICAL: willChange creates GPU layer - disable on low-end to reduce memory
                willChange: isLowEnd ? 'auto' : 'transform',
            }}
        >
            <video
                ref={videoRef}
                // object-CONTAIN always — the WHOLE frame stays present, so pan reaches every
                // edge. The fullscreen fill comes from scaleFor() boosting the scale on zoom,
                // NOT from cropping the source (object-cover would throw the overflow away for
                // good, so panning could never bring the top/bottom back — the bug we fixed).
                className="w-full h-full pointer-events-none object-contain"
                muted
                playsInline
                autoPlay
            />
        </div>
    );
}));


export default ZoomableVideo;
