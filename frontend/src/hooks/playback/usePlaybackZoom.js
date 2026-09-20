/*
 * Purpose: Wheel/pinch/button zoom + pan for the playback stage, fullscreen-aware.
 * Caller: PlaybackVideo.
 * Deps: utils/zoomFit (shared with MultiView), utils/rafThrottle, utils/deviceDetector.
 * MainFuncs: usePlaybackZoom.
 * SideEffects: Mutates stage element transform/touch-action; listens for pointer+wheel on it.
 *
 * Playback memakai <video controls> native, jadi gesture layer harus hidup berdampingan dengan
 * kontrol bawaan: pada 1x pointer tunggal TIDAK ditangkap (timeline/scrub native tetap jalan,
 * swipe vertikal tetap men-scroll halaman lewat touch-action:pan-y), pinch dua jari baru
 * dicegat untuk zoom. Begitu zoom > 1 kontrol native disembunyikan oleh pemanggil dan stage
 * mengambil alih penuh (touch-action:none + pointer capture untuk pan).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { detectDeviceTier } from '../../utils/deviceDetector.js';
import { createTransformThrottle } from '../../utils/rafThrottle.js';
import { computeFitFractions, fillScaleFrom, appliedScale, maxPanPercent } from '../../utils/zoomFit.js';

const DRAG_CLICK_SUPPRESS_PX = 6;

export default function usePlaybackZoom({ stageRef, videoElRef, isFullscreen = false, maxZoom = 4 }) {
    const stateRef = useRef({
        zoom: 1, panX: 0, panY: 0,
        dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0,
        pinchStartDist: 0, pinchStartZoom: 1,
        movedPx: 0,
    });
    const pointersRef = useRef(new Map());
    const throttleRef = useRef(null);
    const suppressClickRef = useRef(false);
    const [zoom, setZoom] = useState(1);
    const isLowEnd = detectDeviceTier() === 'low';

    const isFullscreenRef = useRef(isFullscreen);
    isFullscreenRef.current = isFullscreen;
    const fitRef = useRef({ fw: 1, fh: 1, fillScale: 1 });

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // Metrik object-contain: fraksi stage yang diisi frame video per sumbu pada 1x, lalu
    // fillScale = skala yang membuat sumbu pendek menyentuh tepi (letterbox hilang). Dibaca
    // di AWAL gesture, bukan per frame.
    const refreshFit = useCallback(() => {
        const video = videoElRef.current;
        const stage = stageRef.current;
        let fractions = { fw: 1, fh: 1 };
        if (video && stage) {
            const vw = Number(video.videoWidth) || 0;
            const vh = Number(video.videoHeight) || 0;
            const ew = stage.clientWidth || 0;
            const eh = stage.clientHeight || 0;
            if (vw && vh && ew && eh) {
                fractions = computeFitFractions(vw / vh, ew / eh);
            }
        }
        fitRef.current = { ...fractions, fillScale: fillScaleFrom(fractions) };
    }, [stageRef, videoElRef]);

    const scaleFor = useCallback((z) => (
        appliedScale(z, fitRef.current.fillScale, isFullscreenRef.current)
    ), []);

    // Windowed = rumus simetris warisan (box sudah rasio kamera). Fullscreen memakai geometri
    // aspect-aware supaya pan menjangkau overflow yang didorong fill di luar layar.
    const legacyMaxPan = (z) => (z <= 1 ? 0 : ((z - 1) / (2 * z)) * 100);
    const getMaxPanX = useCallback((z) => (
        isFullscreenRef.current ? maxPanPercent(z, fitRef.current.fw, fitRef.current.fillScale, true) : legacyMaxPan(z)
    ), []);
    const getMaxPanY = useCallback((z) => (
        isFullscreenRef.current ? maxPanPercent(z, fitRef.current.fh, fitRef.current.fillScale, true) : legacyMaxPan(z)
    ), []);

    const applyTransform = useCallback((animate = false) => {
        const stage = stageRef.current;
        if (!stage) return;
        const { zoom: z, panX, panY } = stateRef.current;
        const s = scaleFor(z);
        stage.style.transition = animate && !isLowEnd ? 'transform 0.2s ease-out' : 'none';
        const paint = `scale(${s}) translate(${panX}%, ${panY}%)`;
        if (throttleRef.current && !isLowEnd && !animate) {
            throttleRef.current.update(s, panX, panY);
        } else {
            stage.style.transform = paint;
        }
        setZoom(z);
    }, [isLowEnd, scaleFor, stageRef]);

    const clampIntoBounds = useCallback(() => {
        const s = stateRef.current;
        if (s.zoom <= 1) { s.panX = 0; s.panY = 0; return; }
        const maxX = getMaxPanX(s.zoom);
        const maxY = getMaxPanY(s.zoom);
        s.panX = clamp(s.panX, -maxX, maxX);
        s.panY = clamp(s.panY, -maxY, maxY);
    }, [getMaxPanX, getMaxPanY]);

    const handleZoom = useCallback((delta, animate = true) => {
        refreshFit();
        const s = stateRef.current;
        s.zoom = clamp(s.zoom + delta, 1, maxZoom);
        clampIntoBounds();
        applyTransform(animate);
    }, [maxZoom, applyTransform, refreshFit, clampIntoBounds]);

    const zoomIn = useCallback(() => handleZoom(0.5), [handleZoom]);
    const zoomOut = useCallback(() => handleZoom(-0.5), [handleZoom]);
    const resetZoom = useCallback(() => {
        const s = stateRef.current;
        if (s.zoom === 1 && s.panX === 0 && s.panY === 0) return;
        s.zoom = 1; s.panX = 0; s.panY = 0;
        applyTransform(true);
    }, [applyTransform]);

    // Throttle RAF pada stage — dimatikan di low-end (sama seperti ZoomableVideo).
    useEffect(() => {
        const stage = stageRef.current;
        if (stage && !isLowEnd) {
            throttleRef.current = createTransformThrottle(stage);
        }
        return () => throttleRef.current?.cancel();
    }, [isLowEnd, stageRef]);

    // Masuk/keluar fullscreen mengubah rasio viewport → terapkan ulang skala untuk zoom aktif.
    useEffect(() => {
        if (stateRef.current.zoom > 1) {
            refreshFit();
            applyTransform(false);
        }
    }, [isFullscreen, refreshFit, applyTransform]);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return undefined;
        const s = stateRef.current;
        const pointers = pointersRef.current;

        const onWheel = (e) => {
            e.preventDefault();
            handleZoom(e.deltaY > 0 ? -0.5 : 0.5, false);
        };

        const onPointerDown = (e) => {
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 2) {
                refreshFit();
                const [p1, p2] = Array.from(pointers.values());
                s.pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
                s.pinchStartZoom = s.zoom;
                s.dragging = false;
            } else if (pointers.size === 1 && s.zoom > 1) {
                refreshFit();
                s.dragging = true;
                s.movedPx = 0;
                s.startX = e.clientX;
                s.startY = e.clientY;
                s.startPanX = s.panX;
                s.startPanY = s.panY;
            } else {
                // Pointer tunggal pada 1x: biarkan ke kontrol native — tanpa capture, tanpa pan.
                return;
            }
            try { stage.setPointerCapture(e.pointerId); } catch { /* transisi fullscreen */ }
        };

        const onPointerMove = (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (pointers.size === 2 && s.pinchStartDist > 0) {
                const [p1, p2] = Array.from(pointers.values());
                const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                s.zoom = clamp(s.pinchStartZoom * (dist / s.pinchStartDist), 1, maxZoom);
                clampIntoBounds();
                const sc = scaleFor(s.zoom);
                if (throttleRef.current && !isLowEnd) {
                    throttleRef.current.update(sc, s.panX, s.panY);
                } else {
                    stage.style.transform = `scale(${sc}) translate(${s.panX}%, ${s.panY}%)`;
                }
                setZoom(s.zoom);
                return;
            }

            if (!s.dragging) return;
            const dx = e.clientX - s.startX;
            const dy = e.clientY - s.startY;
            s.movedPx = Math.max(s.movedPx, Math.hypot(dx, dy));
            const maxX = getMaxPanX(s.zoom);
            const maxY = getMaxPanY(s.zoom);
            s.panX = clamp(s.startPanX + dx * 0.15, -maxX, maxX);
            s.panY = clamp(s.startPanY + dy * 0.15, -maxY, maxY);
            const sc = scaleFor(s.zoom);
            if (throttleRef.current && !isLowEnd) {
                throttleRef.current.update(sc, s.panX, s.panY);
            } else {
                stage.style.transform = `scale(${sc}) translate(${s.panX}%, ${s.panY}%)`;
            }
        };

        const onPointerUp = (e) => {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) s.pinchStartDist = 0;
            if (pointers.size === 0) {
                if (s.dragging && s.movedPx > DRAG_CLICK_SUPPRESS_PX) suppressClickRef.current = true;
                s.dragging = false;
            }
            try { stage.releasePointerCapture(e.pointerId); } catch { /* abaikan race */ }
        };

        // Tap yang menutup drag/pinch bisa jatuh ke <video> dan men-toggle play — telan di
        // fase capture SEKALI saja, supaya tap berikutnya tetap sampai ke kontrol native.
        const onClickCapture = (e) => {
            if (!suppressClickRef.current) return;
            suppressClickRef.current = false;
            e.preventDefault();
            e.stopPropagation();
        };

        stage.addEventListener('pointerdown', onPointerDown);
        stage.addEventListener('pointermove', onPointerMove);
        stage.addEventListener('pointerup', onPointerUp);
        stage.addEventListener('pointercancel', onPointerUp);
        stage.addEventListener('click', onClickCapture, true);
        stage.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            stage.removeEventListener('pointerdown', onPointerDown);
            stage.removeEventListener('pointermove', onPointerMove);
            stage.removeEventListener('pointerup', onPointerUp);
            stage.removeEventListener('pointercancel', onPointerUp);
            stage.removeEventListener('click', onClickCapture, true);
            stage.removeEventListener('wheel', onWheel);
        };
    }, [stageRef, isLowEnd, maxZoom, handleZoom, refreshFit, clampIntoBounds, scaleFor, getMaxPanX, getMaxPanY]);

    return {
        zoom,
        isZoomed: zoom > 1,
        zoomIn,
        zoomOut,
        resetZoom,
        // pan-y pada 1x: pinch dicegat untuk video (bukan halaman) tapi swipe vertikal tetap
        // men-scroll. none saat zoomed: pan dua sumbu sepenuhnya milik kita.
        touchAction: zoom > 1 ? 'none' : 'pan-y',
    };
}
