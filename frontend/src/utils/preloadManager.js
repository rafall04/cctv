/**
 * PreloadManager Module
 * Handles preloading of HLS.js module for faster stream initialization
 */

/** @type {typeof import('hls.js').default | null} */
let hlsModule = null;

/** @type {Promise<typeof import('hls.js').default> | null} */
let preloadPromise = null;

/**
 * Preload HLS.js module in background
 * Returns cached module if already loaded, or waits for ongoing load
 * @returns {Promise<typeof import('hls.js').default>} HLS.js module
 */
export const preloadHls = async () => {
    if (hlsModule) {
        return hlsModule;
    }
    
    if (preloadPromise) {
        return preloadPromise;
    }
    
    preloadPromise = import('hls.js')
        .then((module) => {
            hlsModule = module.default;
            return hlsModule;
        })
        .catch((error) => {
            preloadPromise = null;
            throw error;
        });
    
    return preloadPromise;
};

/** @type {typeof import('flv.js').default | null} */
let flvModule = null;

/** @type {Promise<typeof import('flv.js').default> | null} */
let flvPreloadPromise = null;

/**
 * Preload flv.js module on demand. Only external_flv cameras need it, so keeping it a dynamic
 * import keeps the (large) flv.js library out of the bundle for the HLS-only majority of viewers.
 * @returns {Promise<typeof import('flv.js').default>} flv.js module
 */
export const preloadFlv = async () => {
    if (flvModule) {
        return flvModule;
    }

    if (flvPreloadPromise) {
        return flvPreloadPromise;
    }

    flvPreloadPromise = import('flv.js')
        .then((module) => {
            flvModule = module.default;
            return flvModule;
        })
        .catch((error) => {
            flvPreloadPromise = null;
            throw error;
        });

    return flvPreloadPromise;
};

/**
 * Reset preload state (for testing)
 */
export const resetPreloadState = () => {
    hlsModule = null;
    preloadPromise = null;
    flvModule = null;
    flvPreloadPromise = null;
};

export default {
    preloadHls,
    preloadFlv,
    resetPreloadState,
};
