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
        // Drop the cache when the fetch fails: a cached REJECTED promise is handed back to every
        // later caller, so one flaky request would keep map mode broken for the whole visit.
        mapViewPromise = import('../components/MapView').catch((error) => {
            mapViewPromise = null;
            throw error;
        });
    }

    return mapViewPromise;
}

export default preloadLandingMapView;
