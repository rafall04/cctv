/**
 * FallbackHandler Module
 * 
 * Modul untuk menangani error dan auto-retry pada stream loading.
 * Implements automatic recovery dengan retry limits dan network restore detection.
 * 
 * Features:
 * - Error-type specific retry delays (3s network, 5s server)
 * - Auto-retry with max 3 attempts
 * - Network restore listener for automatic reconnection
 * - Manual retry support after auto-retry exhausted
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { ErrorType } from './streamLoaderTypes.js';

/**
 * Fallback configuration constants
 */
export const FALLBACK_CONFIG = {
    MAX_AUTO_RETRIES: 3,           // Maximum automatic retry attempts
    NETWORK_RETRY_DELAY: 5000,     // 5 seconds for network errors
    SERVER_RETRY_DELAY: 8000,      // 8 seconds for server errors
    TIMEOUT_RETRY_DELAY: 5000,     // 5 seconds for timeout errors
    DEFAULT_RETRY_DELAY: 5000,     // Default delay for unknown errors
    INITIAL_RETRY_DELAY: 3000,     // Minimum 3 seconds before first retry (new)
};

/**
 * Get retry delay based on error type.
 * Network errors: 3 seconds
 * Server errors: 5 seconds
 * Timeout errors: 3 seconds
 * 
 * @param {string} errorType - Error type (network, server, timeout, media, unknown)
 * @returns {number} Retry delay in milliseconds
 * 
 * **Validates: Requirements 6.1**
 * **Property 7: Auto-Retry Delay**
 */
export const getRetryDelay = (errorType) => {
    switch (errorType) {
        case ErrorType.NETWORK:
        case 'network':
            return FALLBACK_CONFIG.NETWORK_RETRY_DELAY;
        case ErrorType.SERVER:
        case 'server':
            return FALLBACK_CONFIG.SERVER_RETRY_DELAY;
        case ErrorType.TIMEOUT:
        case 'timeout':
            return FALLBACK_CONFIG.TIMEOUT_RETRY_DELAY;
        case ErrorType.MEDIA:
        case 'media':
            return FALLBACK_CONFIG.NETWORK_RETRY_DELAY;
        default:
            return FALLBACK_CONFIG.DEFAULT_RETRY_DELAY;
    }
};

/**
 * Create a FallbackHandler instance.
 * Manages auto-retry logic and network restore detection for stream loading.
 * 
 * @param {Object} options - Configuration options
 * @param {number} [options.maxAutoRetries=3] - Maximum auto-retry attempts
 * @param {Function} [options.onAutoRetry] - Callback when auto-retry is triggered
 * @param {Function} [options.onAutoRetryExhausted] - Callback when all auto-retries exhausted
 * @param {Function} [options.onNetworkRestore] - Callback when network is restored
 * @param {Function} [options.onManualRetryRequired] - Callback when manual retry is needed
 * @returns {Object} FallbackHandler instance
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
 */
export const createFallbackHandler = (options = {}) => {
    const {
        maxAutoRetries = FALLBACK_CONFIG.MAX_AUTO_RETRIES,
        onAutoRetry = null,
        onAutoRetryExhausted = null,
        onNetworkRestore = null,
        onManualRetryRequired = null,
    } = options;

    // Internal state
    let autoRetryCount = 0;
    let retryTimeoutId = null;
    let isWaitingForRetry = false;
    let lastErrorType = null;
    let networkRestoreCallback = onNetworkRestore;
    let isListeningForNetworkRestore = false;

    // Callbacks
    let autoRetryCallback = onAutoRetry;
    let autoRetryExhaustedCallback = onAutoRetryExhausted;
    let manualRetryRequiredCallback = onManualRetryRequired;

    /**
     * Network online event handler
     */
    const handleNetworkOnline = () => {
        if (networkRestoreCallback) {
            networkRestoreCallback();
        }
    };

    /**
     * Start listening for network restore events.
     * 
     * @returns {void}
     * 
     * **Validates: Requirements 6.5**
     */
    const startNetworkRestoreListener = () => {
        if (isListeningForNetworkRestore) {
            return;
        }

        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('online', handleNetworkOnline);
            isListeningForNetworkRestore = true;
        }
    };

    /**
     * Stop listening for network restore events.
     * 
     * @returns {void}
     */
    const stopNetworkRestoreListener = () => {
        if (!isListeningForNetworkRestore) {
            return;
        }

        if (typeof window !== 'undefined' && window.removeEventListener) {
            window.removeEventListener('online', handleNetworkOnline);
            isListeningForNetworkRestore = false;
        }
    };

    /**
     * Check if auto-retry should be attempted.
     * Returns true if retry count is below max limit.
     * 
     * @returns {boolean} True if auto-retry should be attempted
     * 
     * **Validates: Requirements 6.2, 6.4**
     * **Property 6: Auto-Retry Limit**
     */
    const shouldAutoRetry = () => {
        return autoRetryCount < maxAutoRetries;
    };

    /**
     * Get the current auto-retry count.
     * 
     * @returns {number} Current auto-retry count
     */
    const getAutoRetryCount = () => {
        return autoRetryCount;
    };

    /**
     * Get the maximum auto-retry limit.
     * 
     * @returns {number} Maximum auto-retry attempts
     */
    const getMaxAutoRetries = () => {
        return maxAutoRetries;
    };

    /**
     * Get remaining auto-retry attempts.
     * 
     * @returns {number} Remaining auto-retry attempts
     */
    const getRemainingRetries = () => {
        return Math.max(0, maxAutoRetries - autoRetryCount);
    };

    /**
     * Handle an error and trigger auto-retry if appropriate.
     * 
     * @param {Object} error - StreamError object
     * @param {Function} retryFn - Function to call for retry
     * @returns {Object} Result of error handling
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
     */
    const handleError = (error, retryFn) => {
        const errorType = error?.type || 'unknown';
        lastErrorType = errorType;

        // Clear any pending retry
        clearPendingRetry();

        // Check if we should auto-retry
        if (shouldAutoRetry()) {
            // Use longer delay for first retry to give server time to respond
            const baseDelay = getRetryDelay(errorType);
            const delay = autoRetryCount === 0 
                ? Math.max(baseDelay, FALLBACK_CONFIG.INITIAL_RETRY_DELAY) 
                : baseDelay;
            
            autoRetryCount++;
            isWaitingForRetry = true;

            // Notify about auto-retry
            if (autoRetryCallback) {
                autoRetryCallback({
                    attempt: autoRetryCount,
                    maxAttempts: maxAutoRetries,
                    delay,
                    errorType,
                });
            }

            // Schedule retry
            retryTimeoutId = setTimeout(() => {
                isWaitingForRetry = false;
                if (typeof retryFn === 'function') {
                    retryFn();
                }
            }, delay);

            return {
                action: 'auto-retry',
                attempt: autoRetryCount,
                delay,
                remainingRetries: getRemainingRetries(),
            };
        }

        // Auto-retries exhausted
        isWaitingForRetry = false;

        if (autoRetryExhaustedCallback) {
            autoRetryExhaustedCallback({
                totalAttempts: autoRetryCount,
                lastErrorType: errorType,
            });
        }

        if (manualRetryRequiredCallback) {
            manualRetryRequiredCallback({
                errorType,
                message: 'Automatic retries exhausted. Please retry manually.',
            });
        }

        // Start listening for network restore after exhausting retries
        if (errorType === 'network' || errorType === ErrorType.NETWORK) {
            startNetworkRestoreListener();
        }

        return {
            action: 'manual-retry-required',
            totalAttempts: autoRetryCount,
            errorType,
        };
    };

    /**
     * Clear any pending retry timeout.
     * 
     * @returns {void}
     */
    const clearPendingRetry = () => {
        if (retryTimeoutId !== null) {
            clearTimeout(retryTimeoutId);
            retryTimeoutId = null;
        }
        isWaitingForRetry = false;
    };

    /**
     * Reset the handler state.
     * Should be called after successful stream load.
     * 
     * @returns {void}
     * 
     * **Validates: Requirements 6.3**
     */
    const reset = () => {
        clearPendingRetry();
        autoRetryCount = 0;
        lastErrorType = null;
        stopNetworkRestoreListener();
    };

    /**
     * Check if currently waiting for a retry.
     * 
     * @returns {boolean} True if waiting for retry
     */
    const isWaitingForAutoRetry = () => {
        return isWaitingForRetry;
    };

    /**
     * Get the last error type that was handled.
     * 
     * @returns {string|null} Last error type or null
     */
    const getLastErrorType = () => {
        return lastErrorType;
    };

    /**
     * Register a callback for network restore events.
     * 
     * @param {Function} callback - Callback function
     * @returns {void}
     * 
     * **Validates: Requirements 6.5**
     */
    const onNetworkRestoreEvent = (callback) => {
        networkRestoreCallback = callback;
    };

    /**
     * Register a callback for auto-retry events.
     * 
     * @param {Function} callback - Callback function
     * @returns {void}
     */
    const onAutoRetryEvent = (callback) => {
        autoRetryCallback = callback;
    };

    /**
     * Register a callback for when auto-retries are exhausted.
     * 
     * @param {Function} callback - Callback function
     * @returns {void}
     */
    const onAutoRetryExhaustedEvent = (callback) => {
        autoRetryExhaustedCallback = callback;
    };

    /**
     * Register a callback for when manual retry is required.
     * 
     * @param {Function} callback - Callback function
     * @returns {void}
     */
    const onManualRetryRequiredEvent = (callback) => {
        manualRetryRequiredCallback = callback;
    };

    /**
     * Get estimated time to next retry.
     * 
     * @param {string} errorType - Error type for delay calculation
     * @returns {number} Estimated time in milliseconds
     * 
     * **Validates: Requirements 8.5**
     */
    const getEstimatedRetryTime = (errorType) => {
        if (!shouldAutoRetry()) {
            return -1; // No auto-retry available
        }
        return getRetryDelay(errorType || lastErrorType || 'unknown');
    };

    /**
     * Destroy the handler and clean up resources.
     * 
     * @returns {void}
     */
    const destroy = () => {
        clearPendingRetry();
        stopNetworkRestoreListener();
        autoRetryCount = 0;
        lastErrorType = null;
        autoRetryCallback = null;
        autoRetryExhaustedCallback = null;
        networkRestoreCallback = null;
        manualRetryRequiredCallback = null;
    };

    return {
        // Core methods
        handleError,
        shouldAutoRetry,
        reset,
        destroy,

        // State getters
        getAutoRetryCount,
        getMaxAutoRetries,
        getRemainingRetries,
        isWaitingForAutoRetry,
        getLastErrorType,
        getEstimatedRetryTime,

        // Utility methods
        clearPendingRetry,

        // Event registration
        onNetworkRestore: onNetworkRestoreEvent,
        onAutoRetry: onAutoRetryEvent,
        onAutoRetryExhausted: onAutoRetryExhaustedEvent,
        onManualRetryRequired: onManualRetryRequiredEvent,

        // Network listener control
        startNetworkRestoreListener,
        stopNetworkRestoreListener,
    };
};

/**
 * Create a fresh handler for testing purposes.
 * 
 * @param {Object} options - Configuration options
 * @returns {Object} Fresh FallbackHandler instance
 */
export const createFreshHandler = (options = {}) => {
    return createFallbackHandler(options);
};

export default {
    getRetryDelay,
    createFallbackHandler,
    createFreshHandler,
    FALLBACK_CONFIG,
};
