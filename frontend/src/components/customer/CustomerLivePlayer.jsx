/*
 * Purpose: Lean live-only HLS player for the customer portal — fetches ownership-gated
 *          stream URLs, attaches the per-camera stream token, and surfaces suspension (402).
 * Caller: pages/customer/MyCameras.jsx (modal).
 * Deps: streamService (gated /api/stream/:id), streamTokenService (?token=), lazy hls.js.
 * MainFuncs: CustomerLivePlayer.
 * SideEffects: Creates/destroys an Hls instance bound to the <video> element.
 */

import { useEffect, useRef, useState } from 'react';
import streamService from '../../services/streamService';
import { getSecureStreamUrl, buildSecureStreamUrl, clearTokenCache } from '../../services/streamTokenService';

export default function CustomerLivePlayer({ camera, onClose }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [state, setState] = useState({ status: 'loading', message: '' });

    useEffect(() => {
        let cancelled = false;

        async function start() {
            try {
                setState({ status: 'loading', message: '' });

                const streamResponse = await streamService.getStreamUrls(camera.id, undefined, {
                    skipGlobalErrorNotification: true,
                });
                const hlsUrl = streamResponse?.data?.streams?.hls;
                if (!hlsUrl) {
                    throw Object.assign(new Error('Stream tidak tersedia'), { friendly: true });
                }

                // Non-community cameras require a camera-bound token; harmless for
                // community class too, so always attach it in the portal.
                const { token } = await getSecureStreamUrl(camera.id);
                const securedUrl = buildSecureStreamUrl(hlsUrl, token);

                const video = videoRef.current;
                if (cancelled || !video) return;

                const { default: Hls } = await import('hls.js');
                if (cancelled) return;

                if (Hls.isSupported()) {
                    const hls = new Hls({
                        enableWorker: true,
                        lowLatencyMode: false,
                        backBufferLength: 10,
                        maxBufferLength: 15,
                        liveSyncDurationCount: 2,
                        manifestLoadingMaxRetry: 2,
                    });
                    hlsRef.current = hls;
                    hls.loadSource(securedUrl);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        if (!cancelled) {
                            setState({ status: 'playing', message: '' });
                            video.play().catch(() => {});
                        }
                    });
                    hls.on(Hls.Events.ERROR, (_event, data) => {
                        if (cancelled || !data.fatal) return;
                        const httpCode = data.response?.code;
                        if (httpCode === 402) {
                            setState({ status: 'suspended', message: 'Saldo habis — kamera ditangguhkan.' });
                        } else if (httpCode === 401 || httpCode === 403) {
                            clearTokenCache(camera.id);
                            setState({ status: 'error', message: 'Akses stream ditolak. Muat ulang halaman.' });
                        } else {
                            setState({ status: 'error', message: 'Stream terputus. Coba lagi sebentar lagi.' });
                        }
                        hls.destroy();
                        hlsRef.current = null;
                    });
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    // Safari/iOS native HLS — the rewritten playlist keeps the token
                    // flowing to child playlists and segments.
                    video.src = securedUrl;
                    video.addEventListener('loadedmetadata', () => {
                        if (!cancelled) {
                            setState({ status: 'playing', message: '' });
                            video.play().catch(() => {});
                        }
                    }, { once: true });
                    video.addEventListener('error', () => {
                        if (!cancelled) {
                            setState({ status: 'error', message: 'Stream tidak dapat diputar di perangkat ini.' });
                        }
                    }, { once: true });
                } else {
                    setState({ status: 'error', message: 'Browser tidak mendukung pemutaran HLS.' });
                }
            } catch (error) {
                if (cancelled) return;
                const httpStatus = error?.response?.status;
                if (httpStatus === 402) {
                    setState({ status: 'suspended', message: 'Saldo habis — kamera ditangguhkan. Isi saldo untuk mengaktifkan kembali.' });
                } else if (httpStatus === 403 || httpStatus === 404) {
                    setState({ status: 'error', message: 'Kamera tidak ditemukan atau bukan milik akun ini.' });
                } else {
                    setState({ status: 'error', message: error.friendly ? error.message : 'Gagal memuat stream.' });
                }
            }
        }

        start();
        return () => {
            cancelled = true;
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [camera.id]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
            <div
                className="w-full max-w-3xl overflow-hidden rounded-2xl bg-gray-900 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3">
                    <div>
                        <h3 className="font-semibold text-white">{camera.name}</h3>
                        {camera.area_name && (
                            <p className="text-xs text-gray-400">{camera.area_name}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
                    >
                        Tutup ✕
                    </button>
                </div>
                <div className="relative aspect-video bg-black">
                    <video
                        ref={videoRef}
                        className="h-full w-full"
                        playsInline
                        muted
                        controls
                    />
                    {state.status === 'loading' && (
                        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-300">
                            Memuat stream…
                        </div>
                    )}
                    {state.status === 'suspended' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-6 text-center">
                            <span className="text-3xl">⏸️</span>
                            <p className="font-medium text-amber-300">{state.message}</p>
                        </div>
                    )}
                    {state.status === 'error' && (
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
