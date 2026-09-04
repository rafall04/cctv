/*
 * Purpose: Lean live-only HLS player for a PLAYBACK TOKEN holder — mints a live stream_access grant
 *          from the token (cookie) and plays the live feed through the SHARED live-player core, so it
 *          inherits the exact codec verdict, decoded-frame gate, live-edge recovery and dynamic
 *          aspect-ratio sizing the public popup uses.
 * Caller: pages/Playback.jsx (modal), when a token that allows live is active.
 * Deps: streamTokenService.getLiveGrant (playback-token → live grant), useHlsLivePlayer,
 *       useVideoAspectRatio, ZoomableVideo (all shared).
 * MainFuncs: TokenLivePlayer.
 *
 * WHY NOT REUSE CustomerLivePlayer: that one resolves the HLS URL through the canViewLive-gated
 * /api/stream/:id + /token endpoints, which a non-account token holder is not entitled to. The live
 * grant here returns the URL AND the token together, so this player never touches those gated paths.
 * Everything AFTER the URL is shared (useHlsLivePlayer), so a live-player fix reaches both at once.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, Maximize, Minimize, ZoomIn, ZoomOut, RotateCcw, Camera } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useHlsLivePlayer } from '../../hooks/useHlsLivePlayer';
import { useVideoAspectRatio } from '../../hooks/useVideoAspectRatio';
import ZoomableVideo from '../MultiView/ZoomableVideo';
import { getLiveGrant, buildSecureStreamUrl } from '../../services/streamTokenService';
import { toggleElementFullscreen } from '../../utils/fullscreen.js';
import { takeSnapshot } from '../../utils/snapshotHelper';

export default function TokenLivePlayer({ camera, onClose }) {
    const dialogRef = useRef(null);
    useFocusTrap(dialogRef, { onEscape: onClose });
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const zoomRef = useRef(null);
    const [muted, setMuted] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [snapshotMsg, setSnapshotMsg] = useState('');

    // One call returns both the HLS URL and the short-lived stream_access token; the backend has
    // already verified this token covers the camera and allows live. Everything after this — codec
    // handling, decoded-frame gate, live-edge recovery, native HLS — is the shared core's job.
    const resolveStream = useCallback(async () => {
        const { token, streamUrl } = await getLiveGrant(camera.id);
        if (!streamUrl) throw Object.assign(new Error('Stream live tidak tersedia'), { friendly: true });
        return buildSecureStreamUrl(streamUrl, token);
    }, [camera.id]);

    // Token-holder wording for the shared error kinds (defaults cover codec/payment/unsupported).
    const messages = { denied: 'Akses live ditolak. Token mungkin dicabut atau tidak mengizinkan live.' };
    const mapError = useCallback(
        ({ kind, httpCode }) => (kind === 'network' && httpCode ? `Stream terputus (HTTP ${httpCode}). Coba lagi sebentar lagi.` : undefined),
        [],
    );

    const state = useHlsLivePlayer({ videoRef, resolveStream, resetKey: camera.id, messages, mapError });
    const aspectRatio = useVideoAspectRatio(videoRef, camera.id);
    // Constrain the video box by BOTH the modal width AND a viewport-height budget, preserving the
    // camera ratio — so a portrait/tall camera narrows (no pillarbox) instead of capping to landscape,
    // and a landscape camera still fills the modal. Same idea as VideoPopup's getPublicPopupModalStyle.
    const ar = aspectRatio || 16 / 9;
    const videoBoxStyle = { aspectRatio: ar, maxHeight: '80vh', maxWidth: `min(100%, calc(80vh * ${ar}))` };

    // Native fullscreen state — the button icon and ZoomableVideo's fill-on-zoom both read it.
    useEffect(() => {
        const onFsChange = () => setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
        return () => {
            document.removeEventListener('fullscreenchange', onFsChange);
            document.removeEventListener('webkitfullscreenchange', onFsChange);
        };
    }, []);

    // Re-assert the mute preference onto the element: ZoomableVideo hardcodes `muted`, and React
    // re-applies it whenever ZoomableVideo re-renders (e.g. on a fullscreen toggle), which would
    // otherwise silently re-mute a stream the viewer chose to unmute.
    useEffect(() => {
        if (videoRef.current) videoRef.current.muted = muted;
    }, [muted, isFullscreen, state.status]);

    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setMuted(v.muted);
    }, []);

    const toggleFs = useCallback(() => {
        toggleElementFullscreen(containerRef.current);
    }, []);

    const handleSnapshot = useCallback(async () => {
        const v = videoRef.current;
        if (!v) return;
        const res = await takeSnapshot(v, { cameraName: camera.name || 'kamera', watermarkEnabled: true });
        setSnapshotMsg(res.message || '');
        setTimeout(() => setSnapshotMsg(''), 2500);
    }, [camera.name]);

    // One control cluster reused in two places (only one mounts at a time): a footer BELOW the video
    // when windowed (never covering the picture, like VideoPopup), and an overlay ON the video only in
    // fullscreen (where no footer exists inside the fullscreen element).
    const controlCluster = (
        <>
            <button type="button" onClick={() => zoomRef.current?.zoomOut()} disabled={zoom <= 1} aria-label="Perkecil" title="Perkecil" className="rounded-lg p-1.5 text-white transition-colors hover:bg-white/20 disabled:opacity-30"><ZoomOut className="h-4 w-4" /></button>
            <span className="w-9 text-center text-[10px] font-medium tabular-nums text-white">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomRef.current?.zoomIn()} disabled={zoom >= 4} aria-label="Perbesar" title="Perbesar" className="rounded-lg p-1.5 text-white transition-colors hover:bg-white/20 disabled:opacity-30"><ZoomIn className="h-4 w-4" /></button>
            {zoom > 1 && (
                <button type="button" onClick={() => zoomRef.current?.reset()} aria-label="Reset zoom" title="Reset zoom" className="rounded-lg p-1.5 text-white transition-colors hover:bg-white/20"><RotateCcw className="h-4 w-4" /></button>
            )}
            <span className="mx-0.5 h-5 w-px bg-white/20" />
            <button type="button" onClick={handleSnapshot} aria-label="Ambil screenshot" title="Ambil screenshot" className="rounded-lg p-1.5 text-white transition-colors hover:bg-white/20"><Camera className="h-4 w-4" /></button>
            <button type="button" onClick={toggleMute} aria-label={muted ? 'Bunyikan suara' : 'Bisukan'} title={muted ? 'Bunyikan' : 'Bisukan'} className="rounded-lg p-1.5 text-white transition-colors hover:bg-white/20">{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
            <button type="button" onClick={toggleFs} aria-label={isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'} title={isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'} className="rounded-lg p-1.5 text-white transition-colors hover:bg-white/20">{isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>
        </>
    );

    return (
        <div className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto bg-black/80 p-4" onClick={onClose}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={`Live ${camera.name}`}
                className="my-auto w-full max-w-3xl overflow-hidden rounded-card bg-black shadow-e2"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3">
                    <div>
                        <h3 className="font-semibold text-white">Live · {camera.name}</h3>
                        {camera.area_name && (
                            <p className="text-xs text-content-subtle">{camera.area_name}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-1.5 text-sm text-content-subtle transition-colors hover:bg-white/10 hover:text-white"
                    >
                        Tutup ✕
                    </button>
                </div>
                {/* Dynamic aspect-ratio (measured from the stream), NOT a hardcoded 16:9 — a 4:3 / 16:10 /
                    9:16 camera fills its box instead of pillarboxing, exactly as VideoPopup does. */}
                <div ref={containerRef} className="relative mx-auto overflow-hidden bg-black" style={videoBoxStyle}>
                    {/* ZoomableVideo = the SAME clean player VideoPopup uses: no native seek/pause bar,
                        object-contain, pinch-zoom + pan, fullscreen fill (no black bars). The shared
                        hook attaches hls.js to videoRef; the ref exposes zoomIn/zoomOut/reset. */}
                    <ZoomableVideo ref={zoomRef} videoRef={videoRef} isFullscreen={isFullscreen} onZoomChange={setZoom} />

                    {/* Small badge only — never a control that hides the picture. */}
                    {state.status === 'playing' && (
                        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1">
                            <span className="h-2 w-2 rounded-full bg-status-live animate-pulse" />
                            <span className="text-xs font-semibold uppercase tracking-wide text-white">Live</span>
                        </div>
                    )}
                    {snapshotMsg && (
                        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
                            {snapshotMsg}
                        </div>
                    )}

                    {/* FULLSCREEN only: the footer bar is not inside the fullscreen element, so the
                        controls overlay the video here (exactly as VideoPopup does in fullscreen). */}
                    {state.status === 'playing' && isFullscreen && (
                        <div className="absolute bottom-4 right-4 z-30 flex items-center gap-0.5 rounded-xl bg-black/55 p-1">
                            {controlCluster}
                        </div>
                    )}

                    {state.status === 'loading' && !state.needsGesture && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-content-subtle">
                            Memuat siaran langsung…
                        </div>
                    )}
                    {/* Muted autoplay refused (data-saver / low-power / strict WebView): a real user
                        gesture is the only way in. The loading text above is pointer-events-none, so this
                        button — and any control beneath — stays tappable. */}
                    {state.status === 'loading' && state.needsGesture && (
                        <button
                            type="button"
                            onClick={() => videoRef.current?.play().catch(() => {})}
                            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/60 text-white"
                        >
                            <span className="text-4xl leading-none">▶</span>
                            <span className="text-sm">Ketuk untuk memutar</span>
                        </button>
                    )}
                    {state.status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-6 text-center">
                            <span className="text-3xl">⚠️</span>
                            <p className="text-sm text-red-300">{state.message}</p>
                        </div>
                    )}
                </div>

                {/* WINDOWED: controls live in a bar BELOW the video — never covering the picture,
                    the same layout VideoPopup uses windowed. Hidden in fullscreen (overlay takes over). */}
                {state.status === 'playing' && !isFullscreen && (
                    <div className="flex items-center justify-end gap-0.5 border-t border-white/10 px-2 py-1.5">
                        {controlCluster}
                    </div>
                )}
            </div>
        </div>
    );
}
