import { useRef, useCallback, useEffect, memo } from 'react';
import { detectDeviceTier } from '../../utils/deviceDetector.js';
import { createTransformThrottle } from '../../utils/rafThrottle.js';

// ZOOMABLE VIDEO COMPONENT - Optimized for low-end devices
// Disables heavy features (willChange, RAF throttle) on low-end
// ============================================
const ZoomableVideo = memo(function ZoomableVideo({ videoRef, maxZoom = 4, onZoomChange, isFullscreen = false }) {
    const wrapperRef = useRef(null);
    const transformThrottleRef = useRef(null);
    const stateRef = useRef({ zoom: 1, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });
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
        if (s.zoom <= 1) return;
        s.dragging = true;
        s.startX = e.clientX;
        s.startY = e.clientY;
        s.startPanX = s.panX;
        s.startPanY = s.panY;
        wrapperRef.current.style.cursor = 'grabbing';
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = useCallback((e) => {
        const s = stateRef.current;
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
        } else {
            wrapperRef.current.style.transform = `scale(${s.zoom}) translate(${s.panX}%, ${s.panY}%)`;
        }
    }, [isLowEnd]);

    const handlePointerUp = useCallback((e) => {
        const s = stateRef.current;
        s.dragging = false;
        if (wrapperRef.current) wrapperRef.current.style.cursor = s.zoom > 1 ? 'grab' : 'default';
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { }
    }, []);

    const reset = useCallback(() => {
        const s = stateRef.current;
        s.zoom = 1; s.panX = 0; s.panY = 0;
        applyTransform(true);
    }, [applyTransform]);

    // Expose methods via ref
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
                cursor: 'default',
                touchAction: 'none',
                // CRITICAL: willChange creates GPU layer - disable on low-end to reduce memory
                willChange: isLowEnd ? 'auto' : 'transform'
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
});


export default ZoomableVideo;