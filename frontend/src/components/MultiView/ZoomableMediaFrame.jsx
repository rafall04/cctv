import { memo, useCallback, useEffect, useRef } from 'react';
import { detectDeviceTier } from '../../utils/deviceDetector.js';
import { createTransformThrottle } from '../../utils/rafThrottle.js';

const ZoomableMediaFrame = memo(function ZoomableMediaFrame({
    children,
    maxZoom = 4,
    onZoomChange,
}) {
    const wrapperRef = useRef(null);
    const transformThrottleRef = useRef(null);
    const stateRef = useRef({ zoom: 1, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });
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
        if (state.zoom <= 1) return;
        state.dragging = true;
        state.startX = event.clientX;
        state.startY = event.clientY;
        state.startPanX = state.panX;
        state.startPanY = state.panY;
        wrapperRef.current.style.cursor = 'grabbing';
        event.currentTarget.setPointerCapture(event.pointerId);
    }, []);

    const handlePointerMove = useCallback((event) => {
        const state = stateRef.current;
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
    }, [isLowEnd]);

    const handlePointerUp = useCallback((event) => {
        const state = stateRef.current;
        state.dragging = false;
        if (wrapperRef.current) {
            wrapperRef.current.style.cursor = state.zoom > 1 ? 'grab' : 'default';
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
                cursor: 'default',
                touchAction: 'none',
                willChange: isLowEnd ? 'auto' : 'transform',
            }}
        >
            {children}
        </div>
    );
});

export default ZoomableMediaFrame;
