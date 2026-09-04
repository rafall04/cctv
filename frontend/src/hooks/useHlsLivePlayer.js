/*
 * Purpose: The ONE orchestration for an internal live HLS stream — device-adaptive config, a
 *          decoded-frame gate before declaring "playing", live-edge recovery for fatal errors that
 *          arrive after go-live, a freeze/stall watchdog on BOTH engines, internal warmup-404 retry,
 *          tap-to-play recovery when muted autoplay is refused, and a single error classifier. Extracted
 *          so TokenLivePlayer / CustomerLivePlayer share one battle-tested core instead of each
 *          hand-rolling a thinner, drift-prone copy.
 * Caller: components/playback/TokenLivePlayer, components/customer/CustomerLivePlayer (+ future live tiles).
 * Deps: hlsConfig.getDeviceHLSConfig, publicPopupState.isCodecFailure, nativeHlsPlayback,
 *       livePictureWatch.startLivePictureWatch, liveEdgeRecovery.resumeAtLiveEdgeOrFail (all shared).
 * MainFuncs: useHlsLivePlayer, LIVE_MESSAGES.
 * SideEffects: Creates/destroys one Hls instance + one picture-watch (+ optional native stop) bound to
 *              the caller's <video>; one pending warmup-retry timer.
 *
 * WHY A HOOK, NOT A COMPONENT
 * The four live players legitimately differ in CHROME (zoom cluster, suspension card, grid tile) and
 * in how they RESOLVE a stream URL (live grant vs gated /api/stream vs multi-view payload). What must
 * NOT differ is the playback engine: the codec verdict, the "prove a decoded frame" rule, the live-edge
 * recovery, and the freeze watchdog that keeps a stream from sitting on a frozen frame under a LIVE
 * badge. This hook owns exactly that, and takes the differences as inputs.
 *
 * NOT for VideoPopup: that player also carries external-origin CORS→proxy fallback, FLV, MJPEG, ads
 * and the FallbackHandler retry ladder — a different, richer machine. It stays the reference the
 * shared PRIMITIVES here were extracted from; it already imports every one of them.
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

// An in-stream fatal 404 on manifest/level is a warming MediaMTX camera, retried a few times.
const WARMUP_MAX_RETRY = 3;
const WARMUP_RETRY_DELAY_MS = 1200;
// A fatal MEDIA_ERROR with no codec detail may be a recoverable pipeline hiccup — recover before
// pronouncing 'codec', exactly as VideoPopup/MultiViewVideoItem do.
const MEDIA_MAX_RECOVERY = 2;

// A FATAL hls.js error (BEFORE go-live) → a kind + the HTTP code it carried, if any.
// NOTE: an in-stream 404 is NEVER 'notfound' — the stream URL was already resolved, so the camera
// exists; a 404 here is a warming/transient upstream, classified 'network' (retryable copy). Only the
// GRANT fetch (classifyResolveError) turns a 404 into 'notfound'.
function classifyFatalHls(data) {
    const httpCode = data.response?.code ?? null;
    if (httpCode === 401 || httpCode === 403) return { kind: 'denied', httpCode };
    if (httpCode === 402) return { kind: 'payment', httpCode };
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

const LOADING_STATE = { status: 'loading', kind: null, httpCode: null, message: '', needsGesture: false };
const PLAYING_STATE = { status: 'playing', kind: null, httpCode: null, message: '', needsGesture: false };

/**
 * @param {Object} opts
 * @param {{current: HTMLVideoElement|null}} opts.videoRef
 * @param {() => Promise<string>} opts.resolveStream - returns the secured HLS URL; throw to fail
 *        (an error's `.response.status` / `.friendly` are honored by the classifier).
 * @param {*} opts.resetKey - changing it (e.g. camera id) tears down and restarts the stream.
 * @param {boolean} [opts.active=true] - gate; keep false to hold playback off until ready.
 * @param {boolean} [opts.respectUserPause=false] - set on a surface that renders a real pause control
 *        (native <video controls>). Stops the picture-watch from nudging play() / erroring a pause the
 *        VIEWER chose. Leave false for control-less surfaces (ZoomableVideo) where "paused" is never intended.
 * @param {Object<string,string>} [opts.messages] - per-kind copy overrides.
 * @param {({kind,httpCode}) => (string|undefined)} [opts.mapError] - dynamic copy; return undefined to fall through.
 * @param {({kind,httpCode}) => void} [opts.onError] - side effect on the final error (e.g. clearTokenCache).
 * @returns {{status:'loading'|'playing'|'error', kind:string|null, httpCode:number|null, message:string, needsGesture:boolean}}
 */
export function useHlsLivePlayer({ videoRef, resolveStream, resetKey, active = true, respectUserPause = false, messages, mapError, onError }) {
    const [state, setState] = useState(LOADING_STATE);
    // Bumped to re-run the effect for a warmup-404 retry (a fresh resolve + hls instance).
    const [retryTick, setRetryTick] = useState(0);
    const warmupRetriesRef = useRef(0);
    const mediaRecoveriesRef = useRef(0);

    // Latest callbacks live in refs so the run effect depends ONLY on resetKey/active/retryTick — a
    // caller that re-creates resolveStream every render must not tear the stream down every render.
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

    // A new source starts its retry budgets fresh.
    useEffect(() => { warmupRetriesRef.current = 0; mediaRecoveriesRef.current = 0; }, [resetKey]);

    useEffect(() => {
        if (!active) return undefined;

        let cancelled = false;
        let stopWatch = null;
        let stopNative = null;
        let warmupTimer = null;
        let hls = null;
        let HlsClass = null;
        // A LOCAL flag, never React state: the ERROR handler closes over this synchronously to decide
        // "recover at the live edge" vs "fresh verdict". React state would be stale inside the closure.
        let live = false;

        const isStale = () => cancelled;

        // Nudge playback; surface a tap-to-play affordance if the browser refuses muted autoplay
        // (data-saver / low-power / strict WebView) — pre-live only, so a real decode failure still wins.
        const requestPlay = (el = videoRef.current) => {
            const played = el?.play?.();
            if (played?.catch) {
                played.catch((err) => {
                    if (!cancelled && !live && err?.name === 'NotAllowedError') {
                        setState((prev) => (prev.status === 'playing' || prev.needsGesture ? prev : { ...prev, needsGesture: true }));
                    }
                });
            }
        };

        const goPlaying = () => {
            if (cancelled) return;
            live = true;
            setState((prev) => (prev.status === 'playing' ? prev : PLAYING_STATE));
        };

        const fail = ({ kind, httpCode = null, message }) => {
            if (cancelled) return;
            stopWatch?.();
            stopNative?.();
            setState({ status: 'error', kind, httpCode, message: message || messageFor(kind, httpCode), needsGesture: false });
            onErrorRef.current?.({ kind, httpCode });
        };

        // Decoded-frame gate + ongoing watch: declares "playing" only once a real frame exists, and
        // keeps watching so a decoder/upstream that dies mid-stream can't leave a black rectangle marked
        // LIVE. respectUserPause disables the post-live paused-nudge on a surface with a real pause control.
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
                // The watch's paused-branch nudge/give-up is documented safe ONLY where no pause control
                // exists. A surface WITH one (native controls) must not have its viewer's pause fought.
                ...(respectUserPause ? { pausedNudgeMs: Infinity, pausedGiveUpMs: Infinity } : {}),
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
                        // EXCEPT auth/billing: seeking the live edge can't fix a 401/402/403, and a
                        // mid-watch 402 (balance depleted) must still surface as 'payment' (the amber
                        // "top up" card), not a generic 'stalled'. Everything else is a live-edge recovery.
                        const authCode = data.fatal ? data.response?.code : null;
                        if (authCode === 401 || authCode === 402 || authCode === 403) {
                            const { kind, httpCode } = classifyFatalHls(data);
                            fail({ kind, httpCode });
                            return;
                        }
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

                    // Warmup 404: an internal on-demand camera opened cold can 404 on the manifest/level
                    // until MediaMTX produces the first playlist. Retry a few times (fresh instance)
                    // instead of hard-failing — the camera is fine, merely warming up.
                    const isWarmup404 = data.response?.code === 404
                        && (data.details === 'manifestLoadError' || data.details === 'levelLoadError');
                    if (isWarmup404 && warmupRetriesRef.current < WARMUP_MAX_RETRY) {
                        warmupRetriesRef.current += 1;
                        stopWatch?.();
                        hls.destroy();
                        hls = null;
                        setState(LOADING_STATE);
                        warmupTimer = setTimeout(() => { if (!cancelled) setRetryTick((t) => t + 1); }, WARMUP_RETRY_DELAY_MS);
                        return;
                    }

                    // A fatal MEDIA_ERROR with no HTTP code MIGHT be a recoverable pipeline hiccup — a
                    // bufferAppendError on a cold decoder, which isCodecFailure deliberately does NOT
                    // catch (it kills healthy streams). Try recoverMediaError first (like the reference
                    // players); only a decode that survives that (real H.265/HEVC) becomes 'codec'.
                    if (data.type === 'mediaError' && !data.response?.code) {
                        if (mediaRecoveriesRef.current < MEDIA_MAX_RECOVERY) {
                            mediaRecoveriesRef.current += 1;
                            hls.recoverMediaError();
                            return;
                        }
                        fail({ kind: 'codec' });
                        hls.destroy();
                        hls = null;
                        return;
                    }

                    const { kind, httpCode } = classifyFatalHls(data);
                    fail({ kind, httpCode });
                    hls.destroy();
                    hls = null;
                });
            } else if (canPlayNativeHls(video)) {
                // Safari/iOS native HLS. hls.js isn't involved, so isCodecFailure can't run — this path
                // reads the codec verdict off the element (startNativeHlsPlayback). The picture-watch
                // runs here TOO: its decoded-frame counters are unreliable on Safari (hasPicture then
                // leans on dimensions), but its currentTime-based FREEZE detector works fine and is the
                // only thing that catches a silently-stalled native live feed — parity with VideoPopup.
                stopNative = startNativeHlsPlayback(video, securedUrl, {
                    isStale,
                    // After go-live, a decode/element error is a recoverable stall, NEVER a codec
                    // dead-end — the device just decoded this feed. Mirrors the hls.js post-live rule.
                    onCodecFailure: () => fail({ kind: live ? 'stalled' : 'codec' }),
                    onError: () => fail({ kind: live ? 'stalled' : 'network' }),
                });
                startWatch();
            } else {
                fail({ kind: 'unsupported' });
            }
        }

        run();

        return () => {
            cancelled = true;
            if (warmupTimer) clearTimeout(warmupTimer);
            stopWatch?.();
            stopNative?.();
            if (hls) {
                hls.destroy();
                hls = null;
            }
        };
    }, [resetKey, active, retryTick, respectUserPause, messageFor, videoRef]);

    return state;
}

export default useHlsLivePlayer;
