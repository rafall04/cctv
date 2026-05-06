/*
 * Purpose: Preload and cache the public landing MapView chunk before the user opens map mode.
 * Caller: LandingPage prewarm effects and LandingCamerasSection lazy MapView import.
 * Deps: Dynamic import for components/MapView.
 * MainFuncs: preloadLandingMapView.
 * SideEffects: Starts a client-side chunk request for MapView when called.
 */

let mapViewPromise = null;

export function preloadLandingMapView() {
    if (!mapViewPromise) {
        mapViewPromise = import('../components/MapView');
    }

    return mapViewPromise;
}

export default preloadLandingMapView;
