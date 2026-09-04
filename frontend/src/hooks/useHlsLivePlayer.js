/*
 * Purpose: The ONE orchestration for an internal live HLS stream — device-adaptive config, a
 *          decoded-frame gate before declaring "playing", live-edge recovery for fatal errors that
 *          arrive after go-live, native-HLS (Safari) fallback, and a single error classifier. Extracted
 *          so TokenLivePlayer / CustomerLivePlayer / MultiViewVideoItem share one battle-tested core
 *          instead of each hand-rolling a thinner, drift-prone copy.
 * Caller: components/playback/TokenLivePlayer, components/customer/CustomerLivePlayer (+ future live tiles).
 * Deps: hlsConfig.getDeviceHLSConfig, publicPopupState.isCodecFailure, nativeHlsPlayback,
 *       livePictureWatch.startLivePictureWatch, liveEdgeRecovery.resumeAtLiveEdgeOrFail (all shared).
 * MainFuncs: useHlsLivePlayer, LIVE_MESSAGES.
 * SideEffects: Creates/destroys one Hls instance + one picture-watch bound to the caller's <video>.
 *
 * WHY A HOOK, NOT A COMPONENT
 * The four live players legitimately differ in CHROME (zoom cluster, suspension card, grid tile) and
 * in how they RESOLVE a stream URL (live grant vs gated /api/stream vs multi-view payload). What must
 * NOT differ is the playback engine: the codec verdict, the "prove a decoded frame" rule, and the
 * live-edge recovery that keeps a stream alive when a segment 404s or the short-lived token expires
 * mid-view. This hook owns exactly that, and takes the differences as inputs.
 *
 * NOT for VideoPopup: that player also carries external-origin CORS→proxy fallback, FLV, MJPEG, ads
 * and the FallbackHandler retry ladder — a different, richer machine. It stays the reference the
 * shared PRIMITIVES here were extracted from; it already imports every one of them, so the actual
 * fixes cannot drift even though its orchestration is its own.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { isCodecFailure } from '../utils/publicPopupState.js';
import { canPlayNativeHls, startNativeHlsPlayback } from '../utils/nativeHlsPlayback.js';
import { getDeviceHLSConfig } from '../utils/hlsConfig.js';
import { startLivePictureWatch } from '../utils/livePictureWatch.js';
import { PLAYHEAD_FROZEN, resumeAtLiveEdgeOrFail } from '../utils/liveEdgeRecovery.js';

/** Default Indonesian copy per error kind. A caller overrides any of these via `messages` / `mapError`. */
export const LIVE_MESSAGES = {
    codec: 'Perangkat ini tidak bisa memutar codec H.265/HEVC kamera tersebut. Coba buka di Safari, atau minta admin mengubah kamera ke H.264.',
    denied: 'Akses live ditolak.',
    payment: 'Kamera ditangguhkan.',
    notfound: 'Kamera tidak ditemukan atau dinonaktifkan.',
    stalled: 'Siaran terhenti sesaat. Coba lagi sebentar lagi.',
    network: 'Stream terputus. Coba lagi sebentar lagi.',
    unsupported: 'Browser tidak mendukung pemutaran HLS.',
    unknown: 'Gagal memuat stream live.',
};

// A FATAL hls.js error (BEFORE go-live) → a kind + the HTTP code it carried, if any.
function classifyFatalHls(data) {
    const httpCode = data.response?.code ?? null;
    if (httpCode === 401 || httpCode === 403) return { kind: 'denied', httpCode };
    if (httpCode === 402) return { kind: 'payment', httpCode };
    if (httpCode === 404) return { kind: 'notfound', httpCode };
    // A fatal media error with NO http code is a decode failure, not a network drop — the common
    // Android/WebView shape for an H.265/HEVC live feed (recordings still play via native MP4).
    if (data.type === 'mediaError' && !httpCode) return { kind: 'codec', httpCode: null };
    return { kind: 'network', httpCode };
}

// A thrown resolveStream() error (the grant / URL fetch) → a kind. `friendly` carries its own message.
function classifyResolveError(error) {
    const httpCode = error?.response?.status ?? null;
    if (httpCode === 401 || httpCode === 403) return { kind: 'denied', httpCode };
    if (httpCode === 402) return { kind: 'payment', httpCode };
    if (httpCode === 404) return { kind: 'notfound', httpCode };
    if (error?.friendly) return { kind: 'unknown', httpCode, message: error.message };
    return { kind: 'unknown', httpCode };
}

const LOADING_STATE = { status: 'loading', kind: null, httpCode: null, message: '' };
const PLAYING_STATE = { status: 'playing', kind: null, httpCode: null, message: '' };

/**
 * @param {Object} opts
 * @param {{current: HTMLVideoElement|null}} opts.videoRef
 * @param {() => Promise<string>} opts.resolveStream - returns the secured HLS URL; throw to fail
 *        (an error's `.response.status` / `.friendly` are honored by the classifier).
 * @param {*} opts.resetKey - changing it (e.g. camera id) tears down and restarts the stream.
 * @param {boolean} [opts.active=true] - gate; keep false to hold playback off until ready.
 * @param {Object<string,string>} [opts.messages] - per-kind copy overrides.
 * @param {({kind,httpCode}) => (string|undefined)} [opts.mapError] - dynamic copy (e.g. embed HTTP code);
 *        return undefined to fall through to `messages` / LIVE_MESSAGES.
 * @param {({kind,httpCode}) => void} [opts.onError] - side effect on the final error (e.g. clearTokenCache).
 * @returns {{status:'loading'|'playing'|'error', kind:string|null, httpCode:number|null, message:string}}
 */
export function useHlsLivePlayer({ videoRef, resolveStream, resetKey, active = true, messages, mapError, onError }) {
    const [state, setState] = useState(LOADING_STATE);

    // Latest callbacks live in refs so the run effect depends ONLY on resetKey/active — a caller that
    // re-creates resolveStream every render must not tear the stream down every render.
    const resolveStreamRef = useRef(resolveStream);
    const messagesRef = useRef(messages);
    const mapErrorRef = useRef(mapError);
    const onErrorRef = useRef(onError);
    resolveStreamRef.current = resolveStream;
    messagesRef.current = messages;
    mapErrorRef.current = mapError;
    onErrorRef.current = onError;

    const messageFor = useCallback((kind, httpCode) => {
        const custom = mapErrorRef.current?.({ kind, httpCode });
        if (custom) return custom;
        const table = messagesRef.current ? { ...LIVE_MESSAGES, ...messagesRef.current } : LIVE_MESSAGES;
        return table[kind] || table.unknown;
    }, []);

    useEffect(() => {
        if (!active) return undefined;

        let cancelled = false;
        let stopWatch = null;
        let hls = null;
        let HlsClass = null;
        // A LOCAL flag, never React state: the ERROR handler closes over this synchronously to decide
        // "recover at the live edge" vs "fresh verdict". React state would be stale inside the closure.
        let live = false;

        const isStale = () => cancelled;
        const requestPlay = (el = videoRef.current) => { el?.play?.().catch(() => {}); };

        const goPlaying = () => {
            if (cancelled) return;
            live = true;
            setState((prev) => (prev.status === 'playing' ? prev : PLAYING_STATE));
        };

        const fail = ({ kind, httpCode = null, message }) => {
            if (cancelled) return;
            stopWatch?.();
            setState({ status: 'error', kind, httpCode, message: message || messageFor(kind, httpCode) });
            onErrorRef.current?.({ kind, httpCode });
        };

        // Decoded-frame gate + ongoing watch: declares "playing" only once a real frame exists, and
        // keeps watching so a decoder that dies mid-stream can't leave a black rectangle marked LIVE.
        const startWatch = () => {
            stopWatch = startLivePictureWatch(videoRef.current, {
                isStale,
                onPicture: goPlaying,
                onNoPicture: (amatan) => fail({ kind: amatan?.everHadPicture ? 'stalled' : 'codec' }),
                onFrozen: () => resumeAtLiveEdgeOrFail(
                    { fatal: true, details: PLAYHEAD_FROZEN },
                    { hls, video: videoRef.current, HlsErrorTypes: HlsClass?.ErrorTypes, requestPlay, onGiveUp: () => fail({ kind: 'stalled' }) },
                ),
                requestPlay,
            });
        };

        async function run() {
            setState(LOADING_STATE);

            let securedUrl;
            try {
                securedUrl = await resolveStreamRef.current();
            } catch (error) {
                const { kind, httpCode, message } = classifyResolveError(error);
                fail({ kind, httpCode, message });
                return;
            }
            if (cancelled) return;
            if (!securedUrl) { fail({ kind: 'unknown' }); return; }

            const video = videoRef.current;
            if (!video) return;

            const mod = await import('hls.js');
            if (cancelled) return;
            HlsClass = mod.default;

            if (HlsClass.isSupported()) {
                hls = new HlsClass(getDeviceHLSConfig());
                hls.loadSource(securedUrl);
                hls.attachMedia(video);
                // Once — before any MANIFEST_PARSED — so a device that takes bytes then fails to
                // decode is still watched toward a verdict instead of loading forever.
                startWatch();

                hls.on(HlsClass.Events.MANIFEST_PARSED, () => { if (!cancelled) requestPlay(video); });

                hls.on(HlsClass.Events.ERROR, (_evt, data) => {
                    if (cancelled) return;
                    // After go-live a fatal error is a live-edge recovery, NEVER a fresh codec verdict:
                    // the device just decoded this stream. resumeAtLiveEdgeOrFail ignores non-fatals.
                    if (live) {
                        resumeAtLiveEdgeOrFail(data, {
                            hls, video, HlsErrorTypes: HlsClass.ErrorTypes, requestPlay,
                            onGiveUp: () => fail({ kind: 'stalled' }),
                        });
                        return;
                    }
                    // BEFORE the fatal guard: hls.js reports a codec refusal non-fatally, drops the
                    // level, then never emits MANIFEST_PARSED — ignoring it loads forever.
                    if (isCodecFailure(data)) {
                        fail({ kind: 'codec' });
                        hls.destroy();
                        hls = null;
                        return;
                    }
                    if (!data.fatal) return;
                    const { kind, httpCode } = classifyFatalHls(data);
                    fail({ kind, httpCode });
                    hls.destroy();
                    hls = null;
                });
            } else if (canPlayNativeHls(video)) {
                // Safari/iOS native HLS. hls.js isn't involved, so isCodecFailure can't run — this
                // path reads the codec verdict off the element itself (startNativeHlsPlayback), and
                // its frame counters are unreliable, so it declares playing on loadedmetadata.
                video.addEventListener('loadedmetadata', () => { if (!cancelled) goPlaying(); }, { once: true });
                stopWatch = startNativeHlsPlayback(video, securedUrl, {
                    isStale,
                    onCodecFailure: () => fail({ kind: 'codec' }),
                    onError: () => fail({ kind: 'network' }),
                });
            } else {
                fail({ kind: 'unsupported' });
            }
        }

        run();

        return () => {
            cancelled = true;
            stopWatch?.();
            stopWatch = null;
            if (hls) {
                hls.destroy();
                hls = null;
            }
        };
    }, [resetKey, active, messageFor, videoRef]);

    return state;
}

export default useHlsLivePlayer;
