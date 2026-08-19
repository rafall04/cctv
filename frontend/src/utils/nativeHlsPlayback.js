/**
 * Purpose: Play HLS through the browser's own player (no hls.js) WITH the same codec verdict the
 *          hls.js path already gets.
 * Caller: VideoPopup, MultiViewVideoItem, CustomerLivePlayer — the `canPlayType(...)` branch.
 * Deps: HTML media element APIs only.
 * MainFuncs: canPlayNativeHls, isCodecMediaError, startNativeHlsPlayback.
 * SideEffects: Sets video.src and adds listeners; all removed by the returned stop().
 *
 * WHY THIS EXISTS
 * ---------------
 * All three players fixed codec detection on their hls.js branch and left the native branch as
 * three lines that set `src`, call `play()`, and listen for nothing:
 *
 *     video.src = url;
 *     video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
 *
 * That branch runs precisely where hls.js cannot: iOS Safari and the WebViews, including the
 * in-app browser this deployment's audience actually uses. `isCodecFailure` reads hls.js error
 * objects, so on this path nothing was ever asked and nothing was ever reported — a device that
 * cannot decode the stream got a black rectangle and silence.
 *
 * The native equivalent of that verdict is on the element itself. `MediaError.code` 4
 * (MEDIA_ERR_SRC_NOT_SUPPORTED) means the browser refused the resource outright; 3
 * (MEDIA_ERR_DECODE) means it accepted it and then failed to decode. Both are "this device cannot
 * play this stream", which is the message the viewer needs; 1 (ABORTED) and 2 (NETWORK) are not.
 */

const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export function canPlayNativeHls(video) {
    return Boolean(video?.canPlayType?.('application/vnd.apple.mpegurl'));
}

/** Is this element-level error a verdict about the codec rather than the network? */
export function isCodecMediaError(mediaError) {
    const code = mediaError?.code;
    return code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED;
}

/**
 * Start native HLS playback and report failures instead of swallowing them.
 * Returns a stop() that detaches every listener it added.
 */
export function startNativeHlsPlayback(video, url, { onCodecFailure, onError, isStale = () => false } = {}) {
    if (!video || !url) return () => {};

    const play = () => {
        if (isStale()) return;
        // Rejection here is an autoplay-policy refusal, not a stream fault: the controls are
        // there and the viewer can start it. Diagnosing it as a stream error would be a lie.
        video.play?.()?.catch?.(() => {});
    };

    const handleError = () => {
        if (isStale()) return;
        if (isCodecMediaError(video.error)) {
            onCodecFailure?.(video.error);
            return;
        }
        onError?.(video.error);
    };

    video.addEventListener('loadedmetadata', play);
    video.addEventListener('error', handleError);
    video.src = url;

    return () => {
        video.removeEventListener('loadedmetadata', play);
        video.removeEventListener('error', handleError);
    };
}
