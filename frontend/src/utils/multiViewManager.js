/**
 * MultiViewManager Module
 * Manages multiple video streams with optimized performance
 * 
 * Features:
 * - Staggered stream initialization (100ms delay between streams)
 * - Device-based stream limits (2 for low-end, 3 for medium/high)
 * - Error isolation (one stream error doesn't affect others)
 * - Proper cleanup on exit
 * 
 * **Validates: Requirements 4.5, 8.1, 8.3, 8.5**
 */

import { detectDeviceTier, getMaxConcurrentStreams } from './deviceDetector';

/**
 * Default stagger delay between stream initializations (ms)
 */
export const DEFAULT_STAGGER_DELAY = 100;

/**
 * Stream status enum
 */
export const StreamStatus = {
    IDLE: 'idle',
    INITIALIZING: 'initializing',
    PLAYING: 'playing',
    PAUSED: 'paused',
    ERROR: 'error',
    DESTROYED: 'destroyed',
};

/**
 * Create a delay promise
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get maximum allowed streams based on device tier
 * @param {Object} options - Optional overrides for testing
 * @param {'low' | 'medium' | 'high'} options.tier - Device tier override
 * @returns {number} Maximum concurrent streams
 */
export const getStreamLimit = (options = {}) => {
    const tier = options.tier ?? detectDeviceTier();
    return getMaxConcurrentStreams(tier);
};

/**
 * Check if adding a stream would exceed the limit
 * @param {number} currentCount - Current number of streams
 * @param {Object} options - Optional overrides
 * @returns {boolean} True if limit would be exceeded
 */
export const wouldExceedLimit = (currentCount, options = {}) => {
    const limit = getStreamLimit(options);
    return currentCount >= limit;
};

/**
 * Initialize streams with staggered timing
 * Prevents CPU spike by adding delay between each stream start
 * 
 * @param {Array<Object>} cameras - Array of camera objects to initialize
 * @param {Function} initFn - Function to initialize a single stream (camera) => Promise
 * @param {Object} options - Configuration options
 * @param {number} options.delayMs - Delay between initializations (default: 100ms)
 * @param {Function} options.onProgress - Called after each stream init (index, camera) => void
 * @param {Function} options.onError - Called on stream init error (camera, error) => void
 * @param {AbortSignal} options.signal - AbortSignal to cancel initialization
 * @returns {Promise<Array<{camera: Object, success: boolean, error?: Error}>>}
 */
export const staggeredInitialize = async (cameras, initFn, options = {}) => {
    const {
        delayMs = DEFAULT_STAGGER_DELAY,
        onProgress,
        onError,
        signal,
    } = options;

    const results = [];

    for (let i = 0; i < cameras.length; i++) {
        // Check if cancelled
        if (signal?.aborted) {
            break;
        }

        const camera = cameras[i];

        // Add delay between streams (not before first one)
        if (i > 0) {
            await delay(delayMs);
        }

        // Check again after delay
        if (signal?.aborted) {
            break;
        }

        try {
            await initFn(camera);
            results.push({ camera, success: true });
            onProgress?.(i, camera);
        } catch (error) {
            // Error isolation: continue with other streams
            results.push({ camera, success: false, error });
            onError?.(camera, error);
        }
    }

    return results;
};

/**
 * Create a MultiView stream manager instance
 * Manages stream lifecycle with proper isolation and cleanup
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.maxStreams - Override max streams (uses device tier if not provided)
 * @param {number} options.staggerDelay - Delay between stream inits (default: 100ms)
 * @returns {Object} MultiView manager instance
 */
export const createMultiViewManager = (options = {}) => {
    const {
        maxStreams: maxStreamsOverride,
        staggerDelay = DEFAULT_STAGGER_DELAY,
    } = options;

    // Internal state
    const streams = new Map(); // cameraId -> { camera, hlsInstance, status, error }
    let isInitializing = false;
    let abortController = null;

    /**
     * Get the maximum number of streams allowed
     */
    const getMaxStreams = () => {
        if (maxStreamsOverride !== undefined) {
            return maxStreamsOverride;
        }
        return getStreamLimit();
    };

    /**
     * Check if a camera can be added
     */
    const canAddStream = (cameraId) => {
        if (streams.has(cameraId)) {
            return false; // Already exists
        }
        return streams.size < getMaxStreams();
    };

    /**
     * Add a stream to the manager
     * @param {Object} camera - Camera object with id and streams
     * @returns {boolean} True if added successfully
     */
    const addStream = (camera) => {
        if (!canAddStream(camera.id)) {
            return false;
        }

        streams.set(camera.id, {
            camera,
            hlsInstance: null,
            status: StreamStatus.IDLE,
            error: null,
        });

        return true;
    };

    /**
     * Remove a stream from the manager
     * @param {number} cameraId - Camera ID to remove
     * @returns {boolean} True if removed
     */
    const removeStream = (cameraId) => {
        const stream = streams.get(cameraId);
        if (!stream) {
            return false;
        }

        // Cleanup HLS instance if exists
        if (stream.hlsInstance) {
            try {
                stream.hlsInstance.destroy();
            } catch (e) {
                // Ignore cleanup errors
            }
        }

        streams.delete(cameraId);
        return true;
    };

    /**
     * Get all active streams
     * @returns {Array<Object>} Array of camera objects
     */
    const getActiveStreams = () => {
        return Array.from(streams.values()).map(s => s.camera);
    };

    /**
     * Get stream count
     * @returns {number} Number of active streams
     */
    const getStreamCount = () => streams.size;

    /**
     * Update stream status
     * @param {number} cameraId - Camera ID
     * @param {string} status - New status
     * @param {Error} error - Optional error
     */
    const updateStreamStatus = (cameraId, status, error = null) => {
        const stream = streams.get(cameraId);
        if (stream) {
            stream.status = status;
            stream.error = error;
        }
    };

    /**
     * Set HLS instance for a stream
     * @param {number} cameraId - Camera ID
     * @param {Object} hlsInstance - HLS.js instance
     */
    const setHlsInstance = (cameraId, hlsInstance) => {
        const stream = streams.get(cameraId);
        if (stream) {
            stream.hlsInstance = hlsInstance;
        }
    };

    /**
     * Get stream info
     * @param {number} cameraId - Camera ID
     * @returns {Object|null} Stream info or null
     */
    const getStreamInfo = (cameraId) => {
        return streams.get(cameraId) || null;
    };

    /**
     * Initialize all streams with staggered timing
     * @param {Function} initFn - Function to initialize a stream
     * @param {Object} initOptions - Options for initialization
     * @returns {Promise<Array>} Results of initialization
     */
    const initializeAll = async (initFn, initOptions = {}) => {
        if (isInitializing) {
            return [];
        }

        isInitializing = true;
        abortController = new AbortController();

        const cameras = getActiveStreams();
        
        try {
            const results = await staggeredInitialize(cameras, initFn, {
                delayMs: staggerDelay,
                signal: abortController.signal,
                onError: (camera, error) => {
                    updateStreamStatus(camera.id, StreamStatus.ERROR, error);
                },
                ...initOptions,
            });

            return results;
        } finally {
            isInitializing = false;
            abortController = null;
        }
    };

    /**
     * Cancel ongoing initialization
     */
    const cancelInitialization = () => {
        if (abortController) {
            abortController.abort();
        }
    };

    /**
     * Cleanup all streams and resources
     * Ensures all HLS instances are properly destroyed
     */
    const cleanup = () => {
        // Cancel any ongoing initialization
        cancelInitialization();

        // Destroy all HLS instances
        for (const [cameraId, stream] of streams) {
            if (stream.hlsInstance) {
                try {
                    stream.hlsInstance.destroy();
                } catch (e) {
                    // Ignore cleanup errors - error isolation
                }
            }
            stream.status = StreamStatus.DESTROYED;
        }

        // Clear all streams
        streams.clear();
    };

    /**
     * Check if manager has any streams
     * @returns {boolean} True if has streams
     */
    const hasStreams = () => streams.size > 0;

    /**
     * Check if at max capacity
     * @returns {boolean} True if at max streams
     */
    const isAtCapacity = () => streams.size >= getMaxStreams();

    return {
        // Stream management
        addStream,
        removeStream,
        getActiveStreams,
        getStreamCount,
        getMaxStreams,
        canAddStream,
        hasStreams,
        isAtCapacity,

        // Stream state
        updateStreamStatus,
        setHlsInstance,
        getStreamInfo,

        // Initialization
        initializeAll,
        cancelInitialization,

        // Cleanup
        cleanup,
    };
};

/**
 * Validate stream limit enforcement
 * Used for property-based testing
 * 
 * @param {number} streamCount - Number of streams
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @returns {boolean} True if within limits
 */
export const validateStreamLimit = (streamCount, tier) => {
    const limit = getMaxConcurrentStreams(tier);
    return streamCount <= limit;
};

/**
 * Validate cleanup completeness
 * Used for property-based testing
 * 
 * @param {Object} manager - MultiView manager instance
 * @returns {boolean} True if properly cleaned up
 */
export const validateCleanup = (manager) => {
    return manager.getStreamCount() === 0 && !manager.hasStreams();
};

export default {
    DEFAULT_STAGGER_DELAY,
    StreamStatus,
    delay,
    getStreamLimit,
    wouldExceedLimit,
    staggeredInitialize,
    createMultiViewManager,
    validateStreamLimit,
    validateCleanup,
};
