/*
Purpose: Provide pointer/wheel/pinch zoom and pan behavior for multi-view video elements.
Caller: MultiViewVideoItem.
Deps: React refs/callbacks/effects/forwardRef/imperativeHandle, device tier detection, RAF transform throttle.
MainFuncs: ZoomableVideo.
SideEffects: Mutates wrapper/video DOM style and exposes zoom controls via imperative ref.
*/

import { useRef, useCallback, useEffect, useState, memo, forwardRef, useImperativeHandle } from 'react';
import { detectDeviceTier } from '../../utils/deviceDetector.js';
import { createTransformThrottle } from '../../utils/rafThrottle.js';

// ZOOMABLE VIDEO COMPONENT - Optimized for low-end devices
// Disables heavy features (willChange, RAF throttle) on low-end
// ============================================
const ZoomableVideo = memo(forwardRef(function ZoomableVideo(
    { videoRef, maxZoom = 4, onZoomChange },
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

    const getMaxPan = (z) => z <= 1 ? 0 : ((z - 1) / (2 * z)) * 100;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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

        if (animate && !isLowEnd) {
            wrapperRef.current.style.transition = 'transform 0.2s ease-out';
            wrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
        } else {
            wrapperRef.current.style.transition = 'none';
            // On low-end, apply directly without RAF throttle
            if (transformThrottleRef.current && !isLowEnd) {
                transformThrottleRef.current.update(zoom, panX, panY);
            } else {
                wrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
            }
        }
        // Push zoom into React state once per change so `touch-action` re-
        // renders. The hot pan-update path stays in the ref world.
        setCurrentZoom(zoom);
        onZoomChange?.(zoom);
    }, [onZoomChange, isLowEnd]);

    const handleZoom = useCallback((delta, animate = true) => {
        const s = stateRef.current;
        s.zoom = clamp(s.zoom + delta, 1, maxZoom);
        if (s.zoom <= 1) { s.panX = 0; s.panY = 0; }
        else {
            const max = getMaxPan(s.zoom);
            s.panX = clamp(s.panX, -max, max);
            s.panY = clamp(s.panY, -max, max);
        }
        applyTransform(animate);
    }, [maxZoom, applyTransform]);

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
            const [p1, p2] = Array.from(pointersRef.current.values());
            s.pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
            s.pinchStartZoom = s.zoom;
            s.dragging = false; // Pan and pinch are mutually exclusive.
        } else if (pointersRef.current.size === 1 && s.zoom > 1) {
            // Single pointer down at zoom > 1 → start pan.
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
    }, []);

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
                const max = getMaxPan(s.zoom);
                s.panX = clamp(s.panX, -max, max);
                s.panY = clamp(s.panY, -max, max);
            }
            // Pinch updates are continuous — skip the animated transition.
            if (transformThrottleRef.current && !isLowEnd) {
                transformThrottleRef.current.update(s.zoom, s.panX, s.panY);
            } else if (wrapperRef.current) {
                wrapperRef.current.style.transform = `scale(${s.zoom}) translate(${s.panX}%, ${s.panY}%)`;
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
        const max = getMaxPan(s.zoom);

        // Direct 1:1 mapping with container size factor
        const factor = 0.15; // Adjust for natural feel
        s.panX = clamp(s.startPanX + dx * factor, -max, max);
        s.panY = clamp(s.startPanY + dy * factor, -max, max);

        // On low-end, apply directly without RAF throttle
        if (transformThrottleRef.current && !isLowEnd) {
            transformThrottleRef.current.update(s.zoom, s.panX, s.panY);
        } else if (wrapperRef.current) {
            wrapperRef.current.style.transform = `scale(${s.zoom}) translate(${s.panX}%, ${s.panY}%)`;
        }
    }, [isLowEnd, maxZoom, onZoomChange]);

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
    // wrapperRef.current._zoomIn pattern. Safe to remove once nothing else
    // reaches into the DOM for these.
    useEffect(() => {
        if (wrapperRef.current) {
            wrapperRef.current._zoomIn = () => handleZoom(0.5);
            wrapperRef.current._zoomOut = () => handleZoom(-0.5);
            wrapperRef.current._reset = reset;
            wrapperRef.current._getZoom = () => stateRef.current.zoom;
        }
    }, [handleZoom, reset]);

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
                className="w-full h-full pointer-events-none object-contain"
                muted
                playsInline
                autoPlay
            />
        </div>
    );
}));


export default ZoomableVideo;
