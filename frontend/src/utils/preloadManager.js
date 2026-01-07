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

/**
 * Reset preload state (for testing)
 */
export const resetPreloadState = () => {
    hlsModule = null;
    preloadPromise = null;
};

export default {
    preloadHls,
    resetPreloadState,
};
