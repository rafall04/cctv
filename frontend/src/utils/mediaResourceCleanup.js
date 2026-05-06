/*
 * Purpose: Centralize public video cleanup for HLS/FLV engines, abort controllers, and media elements.
 * Caller: VideoPopup, VideoPlayer, and focused media lifecycle tests.
 * Deps: Browser HTMLMediaElement APIs.
 * MainFuncs: cleanupMediaResources.
 * SideEffects: Aborts pending requests, destroys media engines, clears refs, and may reset video source.
 */

function clearRef(ref, cleanup) {
    if (!ref?.current) {
        return;
    }

    cleanup(ref.current);
    ref.current = null;
}

export function cleanupMediaResources({
    abortControllerRef = null,
    hlsRef = null,
    flvRef = null,
    videoElement = null,
    resetVideo = true,
} = {}) {
    clearRef(abortControllerRef, (controller) => {
        controller.abort?.();
    });

    clearRef(hlsRef, (hls) => {
        hls.destroy?.();
    });

    clearRef(flvRef, (flv) => {
        flv.destroy?.();
    });

    if (!resetVideo || !videoElement) {
        return;
    }

    videoElement.pause?.();
    videoElement.removeAttribute?.('src');
    videoElement.load?.();
}

export default cleanupMediaResources;
