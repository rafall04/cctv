/*
 * Purpose: Preload and cache the public video popup chunk before the user opens a camera.
 * Caller: Landing camera cards and public landing stream intent handlers.
 * Deps: Dynamic import for components/MultiView/VideoPopup.
 * MainFuncs: preloadPublicVideoPopup.
 * SideEffects: Starts a client-side chunk request for VideoPopup when called.
 */

let videoPopupPromise = null;

export function preloadPublicVideoPopup() {
    if (!videoPopupPromise) {
        videoPopupPromise = import('../components/MultiView/VideoPopup');
    }

    return videoPopupPromise;
}

export default preloadPublicVideoPopup;
