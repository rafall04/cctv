/**
 * Error Recovery Module
 * Handles HLS errors with exponential backoff and graceful recovery
 * 
 * **Property 6: Exponential Backoff Recovery**
 * For any network error recovery attempt, the delay between retries SHALL follow
 * exponential backoff pattern: delay(n) = min(1000 * 2^n, 8000) milliseconds.
 * 
 * **Validates: Requirements 3.1, 3.2, 3.4**
 */

/**
 * Maximum delay for exponential backoff (8 seconds)
 */
export const MAX_BACKOFF_DELAY = 8000;

/**
 * Base delay for exponential backoff (1 second)
 */
export const BASE_BACKOFF_DELAY = 1000;

/**
 * Default maximum retry attempts
 */
export const DEFAULT_MAX_RETRIES = 4;

/**
 * Error types that can be handled
 */
export const ErrorTypes = {
    NETWORK: 'networkError',
    MEDIA: 'mediaError',
    FATAL: 'fatalError',
};

/**
 * Recovery status
 */
export const RecoveryStatus = {
    SUCCESS: 'success',
    RETRY: 'retry',
    FAILED: 'failed',
};

/**
 * Calculate exponential backoff delay
 * Formula: min(1000 * 2^retryCount, 8000)
 * 
 * @param {number} retryCount - Current retry attempt (0-indexed)
 * @returns {number} Delay in milliseconds (1000, 2000, 4000, 8000 max)
 */
export const getBackoffDelay = (retryCount) => {
    // Ensure retryCount is a non-negative integer
    const count = Math.max(0, Math.floor(retryCount));
    
    // Calculate exponential delay: 1000 * 2^count
    const delay = BASE_BACKOFF_DELAY * Math.pow(2, count);
    
    // Cap at maximum delay
    return Math.min(delay, MAX_BACKOFF_DELAY);
};

/**
 * Handle network error with exponential backoff retry
 * 
 * @param {Object} hls - HLS.js instance
 * @param {number} retryCount - Current retry attempt
 * @param {number} maxRetries - Maximum retry attempts (default: 4)
 * @returns {Promise<{status: string, delay: number, retryCount: number}>}
 */
export const handleNetworkError = async (hls, retryCount, maxRetries = DEFAULT_MAX_RETRIES) => {
    // Check if we've exceeded max retries
    if (retryCount >= maxRetries) {
        return {
            status: RecoveryStatus.FAILED,
            delay: 0,
            retryCount,
            message: 'Max retries exceeded',
        };
    }
    
    // Calculate backoff delay
    const delay = getBackoffDelay(retryCount);
    
    // Wait for backoff delay
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Attempt to restart loading
    if (hls && typeof hls.startLoad === 'function') {
        try {
            hls.startLoad();
            return {
                status: RecoveryStatus.RETRY,
                delay,
                retryCount: retryCount + 1,
                message: `Retrying after ${delay}ms delay`,
            };
        } catch (error) {
            return {
                status: RecoveryStatus.FAILED,
                delay,
                retryCount,
                message: `Failed to restart load: ${error.message}`,
            };
        }
    }
    
    return {
        status: RecoveryStatus.FAILED,
        delay: 0,
        retryCount,
        message: 'Invalid HLS instance',
    };
};

/**
 * Handle media error with recovery attempt
 * First tries recoverMediaError(), then falls back to reload
 * 
 * @param {Object} hls - HLS.js instance
 * @returns {Promise<{status: string, method: string}>}
 */
export const handleMediaError = async (hls) => {
    if (!hls) {
        return {
            status: RecoveryStatus.FAILED,
            method: 'none',
            message: 'Invalid HLS instance',
        };
    }
    
    // First attempt: recoverMediaError
    if (typeof hls.recoverMediaError === 'function') {
        try {
            hls.recoverMediaError();
            return {
                status: RecoveryStatus.SUCCESS,
                method: 'recoverMediaError',
                message: 'Media error recovered',
            };
        } catch (error) {
            // Fall through to swap audio codec
        }
    }
    
    // Second attempt: swap audio codec (for audio-related media errors)
    if (typeof hls.swapAudioCodec === 'function' && typeof hls.recoverMediaError === 'function') {
        try {
            hls.swapAudioCodec();
            hls.recoverMediaError();
            return {
                status: RecoveryStatus.SUCCESS,
                method: 'swapAudioCodec',
                message: 'Media error recovered with audio codec swap',
            };
        } catch (error) {
            // Fall through to failed
        }
    }
    
    return {
        status: RecoveryStatus.FAILED,
        method: 'none',
        message: 'Unable to recover from media error',
    };
};

/**
 * Handle fatal error - destroy HLS instance and notify
 * 
 * @param {Object} hls - HLS.js instance
 * @param {Function} onDestroy - Callback when HLS is destroyed
 * @returns {{status: string, message: string}}
 */
export const handleFatalError = (hls, onDestroy = null) => {
    if (hls && typeof hls.destroy === 'function') {
        try {
            hls.destroy();
            if (typeof onDestroy === 'function') {
                onDestroy();
            }
            return {
                status: RecoveryStatus.FAILED,
                message: 'Fatal error - HLS instance destroyed',
            };
        } catch (error) {
            return {
                status: RecoveryStatus.FAILED,
                message: `Fatal error - destroy failed: ${error.message}`,
            };
        }
    }
    
    return {
        status: RecoveryStatus.FAILED,
        message: 'Fatal error - invalid HLS instance',
    };
};

/**
 * Create an error recovery handler with state management
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 4)
 * @param {Function} options.onRetry - Callback on retry attempt
 * @param {Function} options.onRecovery - Callback on successful recovery
 * @param {Function} options.onFailed - Callback when recovery fails
 * @returns {Object} Error recovery handler
 */
export const createErrorRecoveryHandler = (options = {}) => {
    const {
        maxRetries = DEFAULT_MAX_RETRIES,
        onRetry = null,
        onRecovery = null,
        onFailed = null,
    } = options;
    
    let retryCount = 0;
    let isRecovering = false;
    
    return {
        /**
         * Get current retry count
         */
        getRetryCount: () => retryCount,
        
        /**
         * Check if currently recovering
         */
        isRecovering: () => isRecovering,
        
        /**
         * Reset retry count
         */
        reset: () => {
            retryCount = 0;
            isRecovering = false;
        },
        
        /**
         * Handle HLS error event
         * @param {Object} hls - HLS.js instance
         * @param {Object} data - Error event data
         */
        handleError: async (hls, data) => {
            if (isRecovering) {
                return { status: 'recovering', message: 'Already recovering' };
            }
            
            if (!data || !data.fatal) {
                // Non-fatal error, no action needed
                return { status: 'ignored', message: 'Non-fatal error' };
            }
            
            isRecovering = true;
            
            try {
                // Determine error type and handle accordingly
                switch (data.type) {
                    case 'networkError': {
                        if (typeof onRetry === 'function') {
                            onRetry(retryCount, getBackoffDelay(retryCount));
                        }
                        
                        const result = await handleNetworkError(hls, retryCount, maxRetries);
                        
                        if (result.status === RecoveryStatus.RETRY) {
                            retryCount = result.retryCount;
                            if (typeof onRecovery === 'function') {
                                onRecovery('network', result);
                            }
                        } else if (result.status === RecoveryStatus.FAILED) {
                            if (typeof onFailed === 'function') {
                                onFailed('network', result);
                            }
                        }
                        
                        isRecovering = false;
                        return result;
                    }
                    
                    case 'mediaError': {
                        const result = await handleMediaError(hls);
                        
                        if (result.status === RecoveryStatus.SUCCESS) {
                            retryCount = 0; // Reset on successful recovery
                            if (typeof onRecovery === 'function') {
                                onRecovery('media', result);
                            }
                        } else {
                            if (typeof onFailed === 'function') {
                                onFailed('media', result);
                            }
                        }
                        
                        isRecovering = false;
                        return result;
                    }
                    
                    default: {
                        // Fatal or unknown error
                        const result = handleFatalError(hls, () => {
                            if (typeof onFailed === 'function') {
                                onFailed('fatal', { message: 'Fatal error' });
                            }
                        });
                        
                        isRecovering = false;
                        return result;
                    }
                }
            } catch (error) {
                isRecovering = false;
                return {
                    status: RecoveryStatus.FAILED,
                    message: `Error during recovery: ${error.message}`,
                };
            }
        },
    };
};

export default {
    getBackoffDelay,
    handleNetworkError,
    handleMediaError,
    handleFatalError,
    createErrorRecoveryHandler,
    ErrorTypes,
    RecoveryStatus,
    MAX_BACKOFF_DELAY,
    BASE_BACKOFF_DELAY,
    DEFAULT_MAX_RETRIES,
};
