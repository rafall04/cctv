/*
 * Purpose: Lean live-only HLS player for the customer portal — fetches ownership-gated stream URLs,
 *          attaches the per-camera stream token, plays through the SHARED live-player core, and
 *          surfaces suspension (402) as its own amber state.
 * Caller: pages/customer/MyCameras.jsx (modal).
 * Deps: streamService (gated /api/stream/:id), streamTokenService (?token=), useHlsLivePlayer,
 *       useVideoAspectRatio (shared).
 * MainFuncs: CustomerLivePlayer.
 *
 * WHY THE SHARED CORE: this used to hand-roll a thinner hls.js setup (a 10s manifest timeout that
 * times out on the ID-mobile → Cloudflare-SIN path, no live-edge recovery, no decoded-frame gate).
 * Routing through useHlsLivePlayer gives it VideoPopup-grade resilience; the portal keeps only its
 * own chrome (native controls) and its suspension wording.
 */

import { useRef, useCallback } from 'react';
import streamService from '../../services/streamService';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useHlsLivePlayer } from '../../hooks/useHlsLivePlayer';
import { useVideoAspectRatio } from '../../hooks/useVideoAspectRatio';
import { getSecureStreamUrl, buildSecureStreamUrl, clearTokenCache } from '../../services/streamTokenService';

export default function CustomerLivePlayer({ camera, onClose }) {
    const dialogRef = useRef(null);
    useFocusTrap(dialogRef, { onEscape: onClose });
    const videoRef = useRef(null);

    const resolveStream = useCallback(async () => {
        const streamResponse = await streamService.getStreamUrls(camera.id, undefined, {
            skipGlobalErrorNotification: true,
        });
        const hlsUrl = streamResponse?.data?.streams?.hls;
        if (!hlsUrl) throw Object.assign(new Error('Stream tidak tersedia'), { friendly: true });
        // Non-community cameras require a camera-bound token; harmless for community class too, so
        // always attach it in the portal.
        const { token } = await getSecureStreamUrl(camera.id);
        return buildSecureStreamUrl(hlsUrl, token);
    }, [camera.id]);

    // Portal wording; `payment` gets its own amber card below (kind === 'payment').
    const messages = {
        payment: 'Saldo habis — kamera ditangguhkan.',
        denied: 'Akses stream ditolak. Muat ulang halaman.',
        notfound: 'Kamera tidak ditemukan atau bukan milik akun ini.',
    };
    // A denied stream means the cached per-camera token is stale — drop it so a reload re-mints.
    const onError = useCallback(({ kind }) => {
        if (kind === 'denied') clearTokenCache(camera.id);
    }, [camera.id]);

    // respectUserPause: this player renders native <video controls>, so a viewer CAN pause — the
    // picture-watch must not nudge play() back or error a deliberate pause (its nudge is documented
    // safe only on control-less surfaces).
    const state = useHlsLivePlayer({ videoRef, resolveStream, resetKey: camera.id, respectUserPause: true, messages, onError });
    const aspectRatio = useVideoAspectRatio(videoRef, camera.id);

    const isSuspended = state.status === 'error' && state.kind === 'payment';

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
                        <h3 className="font-semibold text-white">{camera.name}</h3>
                        {camera.area_name && (
                            <p className="text-xs text-content-subtle">{camera.area_name}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-1.5 text-sm text-content-subtle transition-colors hover:bg-gray-800 hover:text-white"
                    >
                        Tutup ✕
                    </button>
                </div>
                {/* Dynamic aspect-ratio (measured from the stream) — a 4:3 / 16:10 camera fills its box
                    instead of pillarboxing, the same fix VideoPopup carries. */}
                <div className="relative mx-auto bg-black" style={{ aspectRatio: aspectRatio || 16 / 9, maxHeight: '80vh' }}>
                    <video
                        ref={videoRef}
                        className="h-full w-full"
                        playsInline
                        muted
                        controls
                    />
                    {state.status === 'loading' && !state.needsGesture && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-content-subtle">
                            Memuat stream…
                        </div>
                    )}
                    {/* Muted autoplay refused: surface a real gesture. pointer-events-none on the loading
                        text above keeps the native controls (and this button) tappable. */}
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
                    {isSuspended && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-6 text-center">
                            <span className="text-3xl">⏸️</span>
                            <p className="font-medium text-amber-300">Saldo habis — kamera ditangguhkan. Isi saldo untuk mengaktifkan kembali.</p>
                        </div>
                    )}
                    {state.status === 'error' && !isSuspended && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-6 text-center">
                            <span className="text-3xl">⚠️</span>
                            <p className="text-sm text-red-300">{state.message}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
