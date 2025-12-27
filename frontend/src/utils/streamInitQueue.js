/**
 * StreamInitQueue Module
 * Manages stream initialization queue for low-end devices
 * 
 * On low-end devices, only 1 stream can initialize at a time to prevent
 * CPU overload and improve reliability. Additional streams are queued
 * and initialized sequentially.
 * 
 * **Validates: Requirements 5.4**
 */

import { detectDeviceTier } from './deviceDetector';

/**
 * Get maximum concurrent initializations based on device tier
 * @param {Object} options - Optional overrides for testing
 * @param {'low' | 'medium' | 'high'} options.tier - Device tier override
 * @returns {number} Maximum concurrent initializations
 */
export const getMaxConcurrentInits = (options = {}) => {
    const tier = options.tier ?? detectDeviceTier();
    
    // Low-end devices: only 1 concurrent initialization
    // Medium/High: allow 2 concurrent initializations
    switch (tier) {
        case 'low':
            return 1;
        case 'medium':
            return 2;
        case 'high':
            return 2;
        default:
            return 1;
    }
};

/**
 * Check if device should use queued initialization
 * @param {Object} options - Optional overrides for testing
 * @returns {boolean} True if queued initialization should be used
 */
export const shouldUseQueuedInit = (options = {}) => {
    const tier = options.tier ?? detectDeviceTier();
    return tier === 'low';
};

/**
 * Create a stream initialization queue
 * Manages sequential initialization for low-end devices
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.maxConcurrent - Override max concurrent inits
 * @param {number} options.delayBetweenInits - Delay between initializations (ms)
 * @returns {Object} Queue manager instance
 */
export const createStreamInitQueue = (options = {}) => {
    const {
        maxConcurrent: maxConcurrentOverride,
        delayBetweenInits = 200,
    } = options;

    // Internal state
    const queue = [];
    let activeCount = 0;
    let isProcessing = false;
    let abortController = null;

    /**
     * Get the maximum concurrent initializations
     */
    const getMaxConcurrent = () => {
        if (maxConcurrentOverride !== undefined) {
            return maxConcurrentOverride;
        }
        return getMaxConcurrentInits();
    };

    /**
     * Process the next item in the queue
     */
    const processNext = async () => {
        if (queue.length === 0 || activeCount >= getMaxConcurrent()) {
            isProcessing = false;
            return;
        }

        isProcessing = true;
        const { initFn, resolve, reject, id } = queue.shift();
        activeCount++;

        try {
            // Check if cancelled
            if (abortController?.signal.aborted) {
                reject(new Error('Queue cancelled'));
                activeCount--;
                processNext();
                return;
            }

            const result = await initFn();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            activeCount--;
            
            // Add delay between initializations for low-end devices
            if (queue.length > 0 && delayBetweenInits > 0) {
                await new Promise(r => setTimeout(r, delayBetweenInits));
            }
            
            processNext();
        }
    };

    /**
     * Add an initialization task to the queue
     * @param {Function} initFn - Async function to initialize the stream
     * @param {string|number} id - Optional identifier for the task
     * @returns {Promise} Resolves when initialization completes
     */
    const enqueue = (initFn, id = null) => {
        return new Promise((resolve, reject) => {
            queue.push({ initFn, resolve, reject, id });
            
            // Start processing if not already
            if (!isProcessing && activeCount < getMaxConcurrent()) {
                processNext();
            }
        });
    };

    /**
     * Get current queue length
     * @returns {number} Number of items waiting in queue
     */
    const getQueueLength = () => queue.length;

    /**
     * Get number of active initializations
     * @returns {number} Number of currently initializing streams
     */
    const getActiveCount = () => activeCount;

    /**
     * Check if queue is empty and no active initializations
     * @returns {boolean} True if idle
     */
    const isIdle = () => queue.length === 0 && activeCount === 0;

    /**
     * Check if at capacity
     * @returns {boolean} True if at max concurrent initializations
     */
    const isAtCapacity = () => activeCount >= getMaxConcurrent();

    /**
     * Cancel all pending initializations
     */
    const cancel = () => {
        if (abortController) {
            abortController.abort();
        }
        abortController = new AbortController();
        
        // Reject all pending items
        while (queue.length > 0) {
            const { reject } = queue.shift();
            reject(new Error('Queue cancelled'));
        }
    };

    /**
     * Clear the queue without cancelling active initializations
     */
    const clear = () => {
        while (queue.length > 0) {
            const { reject } = queue.shift();
            reject(new Error('Queue cleared'));
        }
    };

    /**
     * Reset the queue state
     */
    const reset = () => {
        cancel();
        activeCount = 0;
        isProcessing = false;
        abortController = null;
    };

    // Initialize abort controller
    abortController = new AbortController();

    return {
        enqueue,
        getQueueLength,
        getActiveCount,
        getMaxConcurrent,
        isIdle,
        isAtCapacity,
        cancel,
        clear,
        reset,
    };
};

/**
 * Global stream initialization queue instance
 * Shared across all components for coordinated initialization
 */
let globalQueue = null;

/**
 * Get or create the global stream initialization queue
 * @param {Object} options - Configuration options
 * @returns {Object} Global queue instance
 */
export const getGlobalStreamInitQueue = (options = {}) => {
    if (!globalQueue) {
        globalQueue = createStreamInitQueue(options);
    }
    return globalQueue;
};

/**
 * Reset the global queue
 */
export const resetGlobalStreamInitQueue = () => {
    if (globalQueue) {
        globalQueue.reset();
        globalQueue = null;
    }
};

/**
 * Validate queue behavior for property-based testing
 * @param {Object} queue - Queue instance
 * @param {number} expectedMax - Expected max concurrent
 * @returns {boolean} True if queue respects limits
 */
export const validateQueueLimits = (queue, expectedMax) => {
    return queue.getActiveCount() <= expectedMax;
};

export default {
    getMaxConcurrentInits,
    shouldUseQueuedInit,
    createStreamInitQueue,
    getGlobalStreamInitQueue,
    resetGlobalStreamInitQueue,
    validateQueueLimits,
};
