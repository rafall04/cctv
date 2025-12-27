/**
 * PreloadManager Module
 * Handles preloading of HLS.js module for faster stream initialization
 * 
 * Features:
 * - Singleton pattern for HLS.js caching
 * - Status tracking (idle, loading, loaded, error)
 * - Preload promise caching to prevent duplicate loads
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */

/**
 * Preload status enum
 * @type {'idle' | 'loading' | 'loaded' | 'error'}
 */
let preloadStatus = 'idle';

/**
 * Cached HLS.js module (singleton)
 * @type {typeof import('hls.js').default | null}
 */
let hlsModule = null;

/**
 * Cached preload promise to prevent duplicate loads
 * @type {Promise<typeof import('hls.js').default> | null}
 */
let preloadPromise = null;

/**
 * Error that occurred during preload (if any)
 * @type {Error | null}
 */
let preloadError = null;

/**
 * Timestamp when preload started
 * @type {number | null}
 */
let preloadStartTime = null;

/**
 * Timestamp when preload completed
 * @type {number | null}
 */
let preloadEndTime = null;

/**
 * Preload HLS.js module in background
 * Returns cached module if already loaded, or waits for ongoing load
 * 
 * @returns {Promise<typeof import('hls.js').default>} HLS.js module
 * @throws {Error} If preload fails
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */
export const preloadHls = async () => {
    // Return cached module if already loaded
    if (hlsModule) {
        return hlsModule;
    }
    
    // Return existing promise if load is in progress
    if (preloadPromise) {
        return preloadPromise;
    }
    
    // Start new preload
    preloadStatus = 'loading';
    preloadStartTime = performance.now();
    preloadError = null;
    
    preloadPromise = import('hls.js')
        .then((module) => {
            hlsModule = module.default;
            preloadStatus = 'loaded';
            preloadEndTime = performance.now();
            return hlsModule;
        })
        .catch((error) => {
            preloadStatus = 'error';
            preloadError = error;
            preloadEndTime = performance.now();
            // Clear promise so retry is possible
            preloadPromise = null;
            throw error;
        });
    
    return preloadPromise;
};

/**
 * Check if HLS.js is already preloaded
 * @returns {boolean} True if HLS.js module is cached
 */
export const isPreloaded = () => {
    return hlsModule !== null;
};

/**
 * Get current preload status
 * @returns {'idle' | 'loading' | 'loaded' | 'error'} Current status
 */
export const getPreloadStatus = () => {
    return preloadStatus;
};

/**
 * Get the preloaded HLS.js module
 * Returns null if not yet loaded
 * @returns {typeof import('hls.js').default | null} HLS.js module or null
 */
export const getPreloadedHls = () => {
    return hlsModule;
};

/**
 * Get preload error if any
 * @returns {Error | null} Error that occurred during preload
 */
export const getPreloadError = () => {
    return preloadError;
};

/**
 * Get preload duration in milliseconds
 * Returns -1 if preload hasn't completed
 * @returns {number} Duration in ms or -1
 */
export const getPreloadDuration = () => {
    if (preloadStartTime === null || preloadEndTime === null) {
        return -1;
    }
    return preloadEndTime - preloadStartTime;
};

/**
 * Reset preload state (mainly for testing)
 * Clears cached module and resets status
 */
export const resetPreloadState = () => {
    hlsModule = null;
    preloadPromise = null;
    preloadStatus = 'idle';
    preloadError = null;
    preloadStartTime = null;
    preloadEndTime = null;
};

/**
 * Get HLS.js module, preloading if necessary
 * Convenience function that ensures HLS.js is available
 * 
 * @returns {Promise<typeof import('hls.js').default>} HLS.js module
 */
export const getHls = async () => {
    if (hlsModule) {
        return hlsModule;
    }
    return preloadHls();
};

/**
 * Check if HLS.js is supported in current browser
 * Uses cached module if available, otherwise does a quick check
 * 
 * @returns {Promise<boolean>} True if HLS.js is supported
 */
export const isHlsSupported = async () => {
    try {
        const Hls = await getHls();
        return Hls.isSupported();
    } catch {
        return false;
    }
};

export default {
    preloadHls,
    isPreloaded,
    getPreloadStatus,
    getPreloadedHls,
    getPreloadError,
    getPreloadDuration,
    resetPreloadState,
    getHls,
    isHlsSupported,
};
