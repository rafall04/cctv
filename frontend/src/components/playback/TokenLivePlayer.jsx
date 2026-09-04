/*
 * Purpose: Lean live-only HLS player for a PLAYBACK TOKEN holder — mints a live stream_access grant
 *          from the token (cookie) and plays the live feed, with the same codec/native-HLS handling
 *          as the customer portal player.
 * Caller: pages/Playback.jsx (modal), when a token that allows live is active.
 * Deps: streamTokenService.getLiveGrant (playback-token → live grant), lazy hls.js.
 * MainFuncs: TokenLivePlayer.
 * SideEffects: Creates/destroys an Hls instance bound to the <video> element.
 *
 * WHY NOT REUSE CustomerLivePlayer: that one resolves the HLS URL through the canViewLive-gated
 * /api/stream/:id + /token endpoints, which a non-account token holder is not entitled to. The live
 * grant here returns the URL AND the token together, so this player never touches those gated paths.
 */

import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getLiveGrant, buildSecureStreamUrl } from '../../services/streamTokenService';
import { isCodecFailure } from '../../utils/publicPopupState.js';
import { canPlayNativeHls, startNativeHlsPlayback } from '../../utils/nativeHlsPlayback.js';
import { getDeviceHLSConfig } from '../../utils/hlsConfig.js';

export default function TokenLivePlayer({ camera, onClose }) {
    const dialogRef = useRef(null);
    useFocusTrap(dialogRef, { onEscape: onClose });
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const nativeStopRef = useRef(null);
    const [state, setState] = useState({ status: 'loading', message: '' });

    useEffect(() => {
        let cancelled = false;

        async function start() {
            try {
                setState({ status: 'loading', message: '' });

                // One call returns both the HLS URL and the short-lived stream_access token; the
                // backend has already verified this token covers the camera and allows live.
                const { token, streamUrl } = await getLiveGrant(camera.id);
                if (!streamUrl) {
                    throw Object.assign(new Error('Stream live tidak tersedia'), { friendly: true });
                }
                const securedUrl = buildSecureStreamUrl(streamUrl, token);

                const video = videoRef.current;
                if (cancelled || !video) return;

                const { default: Hls } = await import('hls.js');
                if (cancelled) return;

                if (Hls.isSupported()) {
                    // Reuse the SAME device-adaptive, mobile-resilient config VideoPopup uses — the
                    // minimal inline config here defaulted hls.js to a 10s manifest timeout, which
                    // times out on the Indonesian mobile → Cloudflare-SIN path (manifestLoadError).
                    // getDeviceHLSConfig gives 30s manifest/level/frag timeouts + retries + adaptive
                    // buffers, so the token live player is as robust as the normal live popup.
                    const hls = new Hls(getDeviceHLSConfig());
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
                        if (cancelled) return;
                        // BEFORE the fatal guard: hls.js reports a codec refusal non-fatally and then
                        // never emits MANIFEST_PARSED. Same defect+predicate as VideoPopup /
                        // MultiViewVideoItem / CustomerLivePlayer.
                        if (isCodecFailure(data)) {
                            setState({
                                status: 'error',
                                message: 'Perangkat ini tidak bisa memutar codec H.265/HEVC kamera tersebut. Coba buka di Safari, atau minta admin mengubah kamera ke H.264.',
                            });
                            hls.destroy();
                            hlsRef.current = null;
                            return;
                        }
                        if (!data.fatal) return;
                        const httpCode = data.response?.code;
                        if (httpCode === 401 || httpCode === 403) {
                            setState({ status: 'error', message: 'Akses live ditolak. Token mungkin dicabut atau tidak mengizinkan live.' });
                        } else if (httpCode === 402) {
                            setState({ status: 'error', message: 'Kamera ditangguhkan.' });
                        } else if (data.type === 'mediaError' && !httpCode) {
                            // A FATAL media error with no HTTP code is a decode failure, not a network drop.
                            // For an H.265/HEVC camera this is the common case on Android Chrome/WebView:
                            // hls.js/MSE cannot decode HEVC (native MP4 playback can, which is why recordings
                            // play but live does not). isCodecFailure misses some HEVC shapes on purpose
                            // (bufferAppendError was excluded to avoid killing healthy streams), so catch the
                            // fatal ones here and tell the truth instead of blaming the network.
                            setState({
                                status: 'error',
                                message: 'Perangkat ini tidak bisa memutar codec video kamera ini untuk siaran langsung (kemungkinan H.265/HEVC). Buka di Safari/iPhone, atau minta admin menyetel kamera ke H.264 untuk live.',
                            });
                        } else {
                            const rc = data.response?.code;
                            if (rc) {
                                setState({ status: 'error', message: `Stream terputus (${data.details} · HTTP ${rc}). Coba lagi sebentar lagi.` });
                            } else {
                                // hls.js gave no HTTP code (network/CORS). The stream host is only
                                // reachable from the field, so probe the manifest directly to capture
                                // the REAL response the device sees — a Cloudflare/proxy block (HTTP
                                // 4xx/5xx + body) vs a CORS/connection failure (fetch throws).
                                fetch(securedUrl, { cache: 'no-store' })
                                    .then(async (r) => {
                                        const body = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 60);
                                        if (!cancelled) setState({ status: 'error', message: `DIAG ${data.details}: HTTP ${r.status}${r.headers.get('cf-ray') ? ' CF' : ''} · ${body}` });
                                    })
                                    .catch((e) => { if (!cancelled) setState({ status: 'error', message: `DIAG ${data.details}: ${String(e).slice(0, 55)}` }); });
                            }
                        }
                        hls.destroy();
                        hlsRef.current = null;
                    });
                } else if (canPlayNativeHls(video)) {
                    // Safari/iOS native HLS — the rewritten playlist keeps the token flowing to child
                    // playlists and segments. hls.js is not involved, so isCodecFailure can't run here.
                    video.addEventListener('loadedmetadata', () => {
                        if (!cancelled) setState({ status: 'playing', message: '' });
                    }, { once: true });
                    nativeStopRef.current = startNativeHlsPlayback(video, securedUrl, {
                        isStale: () => cancelled,
                        onCodecFailure: () => setState({
                            status: 'error',
                            message: 'Perangkat ini tidak bisa memutar codec H.265/HEVC kamera tersebut. Coba buka di Safari, atau minta admin mengubah kamera ke H.264.',
                        }),
                        onError: () => setState({ status: 'error', message: 'Stream tidak dapat diputar di perangkat ini.' }),
                    });
                } else {
                    setState({ status: 'error', message: 'Browser tidak mendukung pemutaran HLS.' });
                }
            } catch (error) {
                if (cancelled) return;
                const httpStatus = error?.response?.status;
                if (httpStatus === 403 || httpStatus === 401) {
                    setState({ status: 'error', message: 'Token ini tidak mengizinkan live untuk kamera ini.' });
                } else if (httpStatus === 402) {
                    setState({ status: 'error', message: 'Kamera ditangguhkan.' });
                } else if (httpStatus === 404) {
                    setState({ status: 'error', message: 'Kamera tidak ditemukan atau dinonaktifkan.' });
                } else {
                    setState({ status: 'error', message: error.friendly ? error.message : 'Gagal memuat stream live.' });
                }
            }
        }

        start();
        return () => {
            cancelled = true;
            nativeStopRef.current?.();
            nativeStopRef.current = null;
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [camera.id]);

    return (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={`Live ${camera.name}`}
                className="w-full max-w-3xl overflow-hidden rounded-card bg-black shadow-e2"
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
                <div className="relative aspect-video bg-black">
                    <video
                        ref={videoRef}
                        className="h-full w-full"
                        playsInline
                        muted
                        controls
                    />
                    {state.status === 'loading' && (
                        <div className="absolute inset-0 flex items-center justify-center text-sm text-content-subtle">
                            Memuat stream live…
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
