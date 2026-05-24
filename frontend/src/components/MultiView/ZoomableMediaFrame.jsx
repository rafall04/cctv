/*
Purpose: Generic zoom/pan/pinch wrapper for any media child (iframe, img, canvas).
Caller: VideoPopup external embed/mjpeg paths.
Deps: React hooks (forwardRef + useImperativeHandle), device tier detection, RAF transform throttle.
MainFuncs: ZoomableMediaFrame.
SideEffects: Mutates wrapper DOM style and exposes zoom controls via imperative ref.
*/

import { memo, useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { detectDeviceTier } from '../../utils/deviceDetector.js';
import { createTransformThrottle } from '../../utils/rafThrottle.js';

const ZoomableMediaFrame = memo(forwardRef(function ZoomableMediaFrame(
    { children, maxZoom = 4, onZoomChange },
    ref,
) {
    const wrapperRef = useRef(null);
    const transformThrottleRef = useRef(null);
    const stateRef = useRef({
        zoom: 1, panX: 0, panY: 0,
        dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0,
        pinchStartDist: 0, pinchStartZoom: 1,
    });
    const pointersRef = useRef(new Map());
    const [currentZoom, setCurrentZoom] = useState(1);
    const isLowEnd = detectDeviceTier() === 'low';

    const getMaxPan = (z) => z <= 1 ? 0 : ((z - 1) / (2 * z)) * 100;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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
            if (transformThrottleRef.current && !isLowEnd) {
                transformThrottleRef.current.update(zoom, panX, panY);
            } else {
                wrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
            }
        }

        setCurrentZoom(zoom);
        onZoomChange?.(zoom);
    }, [isLowEnd, onZoomChange]);

    const handleZoom = useCallback((delta, animate = true) => {
        const state = stateRef.current;
        state.zoom = clamp(state.zoom + delta, 1, maxZoom);
        if (state.zoom <= 1) {
            state.panX = 0;
            state.panY = 0;
        } else {
            const maxPan = getMaxPan(state.zoom);
            state.panX = clamp(state.panX, -maxPan, maxPan);
            state.panY = clamp(state.panY, -maxPan, maxPan);
        }
        applyTransform(animate);
    }, [applyTransform, maxZoom]);

    const handleWheel = useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
        handleZoom(event.deltaY > 0 ? -0.5 : 0.5, false);
    }, [handleZoom]);

    const handlePointerDown = useCallback((event) => {
        const state = stateRef.current;
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointersRef.current.size === 2) {
            const [p1, p2] = Array.from(pointersRef.current.values());
            state.pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
            state.pinchStartZoom = state.zoom;
            state.dragging = false;
        } else if (pointersRef.current.size === 1 && state.zoom > 1) {
            state.dragging = true;
            state.startX = event.clientX;
            state.startY = event.clientY;
            state.startPanX = state.panX;
            state.startPanY = state.panY;
            wrapperRef.current.style.cursor = 'grabbing';
        }
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Ignore capture failures.
        }
    }, []);

    const handlePointerMove = useCallback((event) => {
        const state = stateRef.current;
        if (!pointersRef.current.has(event.pointerId)) return;
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointersRef.current.size === 2 && state.pinchStartDist > 0) {
            const [p1, p2] = Array.from(pointersRef.current.values());
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const ratio = dist / state.pinchStartDist;
            state.zoom = clamp(state.pinchStartZoom * ratio, 1, maxZoom);
            if (state.zoom <= 1) {
                state.panX = 0;
                state.panY = 0;
            } else {
                const maxPan = getMaxPan(state.zoom);
                state.panX = clamp(state.panX, -maxPan, maxPan);
                state.panY = clamp(state.panY, -maxPan, maxPan);
            }
            if (transformThrottleRef.current && !isLowEnd) {
                transformThrottleRef.current.update(state.zoom, state.panX, state.panY);
            } else if (wrapperRef.current) {
                wrapperRef.current.style.transform = `scale(${state.zoom}) translate(${state.panX}%, ${state.panY}%)`;
            }
            setCurrentZoom(state.zoom);
            onZoomChange?.(state.zoom);
            return;
        }

        if (!state.dragging) return;

        const dx = event.clientX - state.startX;
        const dy = event.clientY - state.startY;
        const maxPan = getMaxPan(state.zoom);
        const factor = 0.15;

        state.panX = clamp(state.startPanX + dx * factor, -maxPan, maxPan);
        state.panY = clamp(state.startPanY + dy * factor, -maxPan, maxPan);

        if (transformThrottleRef.current && !isLowEnd) {
            transformThrottleRef.current.update(state.zoom, state.panX, state.panY);
        } else if (wrapperRef.current) {
            wrapperRef.current.style.transform = `scale(${state.zoom}) translate(${state.panX}%, ${state.panY}%)`;
        }
    }, [isLowEnd, maxZoom, onZoomChange]);

    const handlePointerUp = useCallback((event) => {
        const state = stateRef.current;
        pointersRef.current.delete(event.pointerId);

        if (pointersRef.current.size < 2) {
            state.pinchStartDist = 0;
        }
        if (pointersRef.current.size === 0) {
            state.dragging = false;
            if (wrapperRef.current) {
                wrapperRef.current.style.cursor = state.zoom > 1 ? 'grab' : 'default';
            }
        }
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // Ignore release errors.
        }
    }, []);

    const reset = useCallback(() => {
        const state = stateRef.current;
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        applyTransform(true);
    }, [applyTransform]);

    useImperativeHandle(ref, () => ({
        zoomIn: () => handleZoom(0.5),
        zoomOut: () => handleZoom(-0.5),
        reset,
        getZoom: () => stateRef.current.zoom,
    }), [handleZoom, reset]);

    // Backwards-compat shim — older callers reach into wrapper DOM directly.
    useEffect(() => {
        if (!wrapperRef.current) return;

        wrapperRef.current._zoomIn = () => handleZoom(0.5);
        wrapperRef.current._zoomOut = () => handleZoom(-0.5);
        wrapperRef.current._reset = reset;
        wrapperRef.current._getZoom = () => stateRef.current.zoom;
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
                touchAction: currentZoom > 1 ? 'none' : 'pan-x pan-y',
                willChange: isLowEnd ? 'auto' : 'transform',
            }}
        >
            {children}
        </div>
    );
}));

export default ZoomableMediaFrame;
