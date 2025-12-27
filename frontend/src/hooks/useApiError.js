import { useCallback } from 'react';

/**
 * useApiError Hook
 * 
 * Custom hook for standardized API error handling.
 * Maps HTTP status codes to user-friendly messages and detects error types.
 * 
 * Requirements: 2.6, 2.7, 10.4, 10.5, 10.6
 */

/**
 * Error message mapping for HTTP status codes and error types
 */
export const ERROR_MESSAGES = {
    // Network errors
    NETWORK_ERROR: 'Unable to connect to server. Please check your connection.',
    TIMEOUT_ERROR: 'Request timed out. Please try again.',
    
    // Auth errors
    INVALID_CREDENTIALS: 'Invalid username or password. Please check your credentials.',
    SESSION_EXPIRED: 'Your session has expired. Please log in again.',
    ACCOUNT_LOCKED: 'Account temporarily locked. Try again in {time}.',
    RATE_LIMITED: 'Too many attempts. Please wait {time} before trying again.',
    
    // HTTP status errors
    400: 'Invalid request. Please check your input.',
    401: 'Your session has expired. Please log in again.',
    403: "You don't have permission to perform this action.",
    404: 'The requested resource was not found.',
    409: 'A conflict occurred. The resource may already exist.',
    422: 'Invalid data provided. Please check your input.',
    429: 'Too many requests. Please wait before trying again.',
    500: 'Server error occurred. Please try again later.',
    502: 'Server is temporarily unavailable. Please try again later.',
    503: 'Service unavailable. Please try again later.',
    504: 'Request timed out. Please try again.',
    
    // Default
    DEFAULT: 'An unexpected error occurred. Please try again.',
};

/**
 * Get user-friendly error message from HTTP status code
 * @param {number} status - HTTP status code
 * @returns {string} User-friendly error message
 */
export function getErrorMessageByStatus(status) {
    if (status === null || status === undefined) {
        return ERROR_MESSAGES.NETWORK_ERROR;
    }
    return ERROR_MESSAGES[status] || ERROR_MESSAGES.DEFAULT;
}

/**
 * Check if error is a network error (no response from server)
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if network error
 */
export function isNetworkError(error) {
    if (!error) return false;
    
    // Axios network error (no response)
    if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') {
        return true;
    }
    
    // No response object means network failure
    if (error.request && !error.response) {
        return true;
    }
    
    // Check for common network error messages
    const message = error.message?.toLowerCase() || '';
    if (
        message.includes('network error') ||
        message.includes('failed to fetch') ||
        message.includes('net::err_') ||
        message.includes('econnrefused') ||
        message.includes('enotfound')
    ) {
        return true;
    }
    
    return false;
}

/**
 * Check if error is a timeout error
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if timeout error
 */
export function isTimeoutError(error) {
    if (!error) return false;
    
    // Axios timeout
    if (error.code === 'ECONNABORTED' && error.message?.includes('timeout')) {
        return true;
    }
    
    // HTTP 504 Gateway Timeout
    if (error.response?.status === 504) {
        return true;
    }
    
    // Check message
    const message = error.message?.toLowerCase() || '';
    if (message.includes('timeout')) {
        return true;
    }
    
    return false;
}

/**
 * Check if error is an authentication error (401)
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if auth error
 */
export function isAuthError(error) {
    if (!error) return false;
    return error.response?.status === 401;
}

/**
 * Check if error is a forbidden error (403)
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if forbidden error
 */
export function isForbiddenError(error) {
    if (!error) return false;
    return error.response?.status === 403;
}

/**
 * Check if error is a not found error (404)
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if not found error
 */
export function isNotFoundError(error) {
    if (!error) return false;
    return error.response?.status === 404;
}

/**
 * Check if error is a validation error (400, 422)
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if validation error
 */
export function isValidationError(error) {
    if (!error) return false;
    const status = error.response?.status;
    return status === 400 || status === 422;
}

/**
 * Check if error is a server error (5xx)
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if server error
 */
export function isServerError(error) {
    if (!error) return false;
    const status = error.response?.status;
    return status >= 500 && status < 600;
}

/**
 * Check if error is a rate limit error (429)
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if rate limit error
 */
export function isRateLimitError(error) {
    if (!error) return false;
    return error.response?.status === 429;
}

/**
 * Parse API error and return structured error object
 * @param {Error|Object} error - Error object
 * @returns {Object} Structured API error
 */
export function parseApiError(error) {
    if (!error) {
        return {
            status: null,
            message: ERROR_MESSAGES.DEFAULT,
            code: 'UNKNOWN_ERROR',
            details: null,
            isNetworkError: false,
            isAuthError: false,
            isValidationError: false,
            isServerError: false,
            isTimeoutError: false,
            isForbiddenError: false,
            isNotFoundError: false,
            isRateLimitError: false,
        };
    }

    const networkErr = isNetworkError(error);
    const timeoutErr = isTimeoutError(error);
    const authErr = isAuthError(error);
    const forbiddenErr = isForbiddenError(error);
    const notFoundErr = isNotFoundError(error);
    const validationErr = isValidationError(error);
    const serverErr = isServerError(error);
    const rateLimitErr = isRateLimitError(error);

    const status = error.response?.status || null;
    
    // Determine message
    let message;
    if (networkErr) {
        message = timeoutErr ? ERROR_MESSAGES.TIMEOUT_ERROR : ERROR_MESSAGES.NETWORK_ERROR;
    } else if (error.response?.data?.message) {
        // Use server-provided message if available
        message = error.response.data.message;
    } else {
        message = getErrorMessageByStatus(status);
    }

    // Extract error code from response
    const code = error.response?.data?.code || error.code || 'UNKNOWN_ERROR';
    
    // Extract details from response
    const details = error.response?.data?.details || error.response?.data?.errors || null;

    return {
        status,
        message,
        code,
        details,
        isNetworkError: networkErr,
        isAuthError: authErr,
        isValidationError: validationErr,
        isServerError: serverErr,
        isTimeoutError: timeoutErr,
        isForbiddenError: forbiddenErr,
        isNotFoundError: notFoundErr,
        isRateLimitError: rateLimitErr,
    };
}

/**
 * Get user-friendly error message from any error
 * @param {Error|Object} error - Error object
 * @returns {string} User-friendly error message
 */
export function getErrorMessage(error) {
    const parsed = parseApiError(error);
    return parsed.message;
}

/**
 * Retry configuration constants
 * Requirements: 10.7
 */
export const RETRY_CONFIG = {
    MAX_RETRIES: 3,
    BASE_DELAY: 1000, // 1 second
    MAX_DELAY: 4000,  // 4 seconds (1s, 2s, 4s pattern)
};

/**
 * Calculate exponential backoff delay
 * Delays: 1s, 2s, 4s (capped at MAX_DELAY)
 * 
 * @param {number} retryCount - Current retry attempt (0-indexed)
 * @returns {number} Delay in milliseconds
 */
export function getRetryDelay(retryCount) {
    // Handle negative or invalid values
    const count = Math.max(0, Math.floor(retryCount));
    // Calculate delay: 1000 * 2^retryCount, capped at MAX_DELAY
    const delay = RETRY_CONFIG.BASE_DELAY * Math.pow(2, count);
    return Math.min(delay, RETRY_CONFIG.MAX_DELAY);
}

/**
 * Check if an error is retryable
 * Network errors and server errors (5xx) are retryable
 * Auth errors (401), forbidden (403), validation errors (4xx) are not retryable
 * 
 * @param {Error|Object} error - Error object
 * @returns {boolean} True if error is retryable
 */
export function isRetryableError(error) {
    if (!error) return false;
    
    // Network errors are retryable
    if (isNetworkError(error)) return true;
    
    // Timeout errors are retryable
    if (isTimeoutError(error)) return true;
    
    // Server errors (5xx) are retryable
    if (isServerError(error)) return true;
    
    // Auth, forbidden, validation, not found errors are NOT retryable
    if (isAuthError(error)) return false;
    if (isForbiddenError(error)) return false;
    if (isValidationError(error)) return false;
    if (isNotFoundError(error)) return false;
    if (isRateLimitError(error)) return false;
    
    return false;
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * Max 3 retries with delays: 1s, 2s, 4s
 * 
 * Requirements: 10.7
 * 
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {Function} options.onRetry - Callback called before each retry (retryCount, delay, error)
 * @param {Function} options.shouldRetry - Custom function to determine if error is retryable
 * @returns {Promise<any>} Result of the function
 * @throws {Error} Last error after all retries exhausted
 */
export async function retryWithBackoff(fn, options = {}) {
    const {
        maxRetries = RETRY_CONFIG.MAX_RETRIES,
        onRetry = null,
        shouldRetry = isRetryableError,
    } = options;

    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Check if we've exhausted retries
            if (attempt >= maxRetries) {
                throw error;
            }
            
            // Check if error is retryable
            if (!shouldRetry(error)) {
                throw error;
            }
            
            // Calculate delay for this retry
            const delay = getRetryDelay(attempt);
            
            // Call onRetry callback if provided
            if (onRetry) {
                onRetry(attempt, delay, error);
            }
            
            // Wait before retrying
            await sleep(delay);
        }
    }
    
    // Should not reach here, but throw last error just in case
    throw lastError;
}

/**
 * Create a retry handler with pre-configured options
 * 
 * @param {Object} options - Retry options
 * @returns {Object} Retry handler with execute method
 */
export function createRetryHandler(options = {}) {
    const {
        maxRetries = RETRY_CONFIG.MAX_RETRIES,
        onRetry = null,
        onSuccess = null,
        onFailure = null,
        shouldRetry = isRetryableError,
    } = options;

    let currentAttempt = 0;

    return {
        /**
         * Execute a function with retry logic
         * @param {Function} fn - Async function to execute
         * @returns {Promise<any>} Result of the function
         */
        async execute(fn) {
            currentAttempt = 0;
            
            try {
                const result = await retryWithBackoff(fn, {
                    maxRetries,
                    shouldRetry,
                    onRetry: (attempt, delay, error) => {
                        currentAttempt = attempt + 1;
                        if (onRetry) {
                            onRetry(attempt, delay, error);
                        }
                    },
                });
                
                if (onSuccess) {
                    onSuccess(result);
                }
                
                return result;
            } catch (error) {
                if (onFailure) {
                    onFailure(error, currentAttempt);
                }
                throw error;
            }
        },

        /**
         * Get current attempt count
         * @returns {number} Current attempt number
         */
        getAttemptCount() {
            return currentAttempt;
        },

        /**
         * Reset the handler
         */
        reset() {
            currentAttempt = 0;
        },
    };
}

/**
 * useApiError Hook
 * 
 * Provides methods for handling API errors consistently.
 * 
 * @returns {Object} API error handling methods
 */
export function useApiError() {
    /**
     * Handle an API error and return structured error info
     */
    const handleError = useCallback((error) => {
        return parseApiError(error);
    }, []);

    /**
     * Get user-friendly message from error
     */
    const getErrorMessageFn = useCallback((error) => {
        return getErrorMessage(error);
    }, []);

    /**
     * Check if error is a network error
     */
    const isNetworkErrorFn = useCallback((error) => {
        return isNetworkError(error);
    }, []);

    /**
     * Check if error is an auth error
     */
    const isAuthErrorFn = useCallback((error) => {
        return isAuthError(error);
    }, []);

    /**
     * Check if error is a validation error
     */
    const isValidationErrorFn = useCallback((error) => {
        return isValidationError(error);
    }, []);

    /**
     * Check if error is a server error
     */
    const isServerErrorFn = useCallback((error) => {
        return isServerError(error);
    }, []);

    /**
     * Check if error is a timeout error
     */
    const isTimeoutErrorFn = useCallback((error) => {
        return isTimeoutError(error);
    }, []);

    /**
     * Check if error is a forbidden error
     */
    const isForbiddenErrorFn = useCallback((error) => {
        return isForbiddenError(error);
    }, []);

    /**
     * Check if error is a not found error
     */
    const isNotFoundErrorFn = useCallback((error) => {
        return isNotFoundError(error);
    }, []);

    /**
     * Check if error is a rate limit error
     */
    const isRateLimitErrorFn = useCallback((error) => {
        return isRateLimitError(error);
    }, []);

    return {
        handleError,
        getErrorMessage: getErrorMessageFn,
        isNetworkError: isNetworkErrorFn,
        isAuthError: isAuthErrorFn,
        isValidationError: isValidationErrorFn,
        isServerError: isServerErrorFn,
        isTimeoutError: isTimeoutErrorFn,
        isForbiddenError: isForbiddenErrorFn,
        isNotFoundError: isNotFoundErrorFn,
        isRateLimitError: isRateLimitErrorFn,
    };
}

export default useApiError;
