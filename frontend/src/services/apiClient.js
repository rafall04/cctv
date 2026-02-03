import axios from 'axios';
import { getApiUrl, getApiKey } from '../config/config.js';
import {
    parseApiError,
    getErrorMessage,
    isNetworkError,
    isAuthError,
    isServerError,
    isTimeoutError,
    retryWithBackoff,
    isRetryableError,
    RETRY_CONFIG,
    ERROR_MESSAGES,
} from '../hooks/useApiError';

// Default timeout configuration (30 seconds)
// Requirements: 10.3
const DEFAULT_TIMEOUT = 30000;

// CSRF token storage
let csrfToken = null;
let csrfTokenExpiry = null;

// Notification callback (set by NotificationContext integration)
let notificationCallback = null;

// Retry callback for timeout errors (allows UI to offer retry option)
let timeoutRetryCallback = null;

/**
 * Set the notification callback for error handling
 * This should be called from the app initialization with the notification context
 * @param {Function} callback - Function to show notifications (type, title, message)
 */
export function setNotificationCallback(callback) {
    notificationCallback = callback;
}

/**
 * Set the timeout retry callback
 * This allows the UI to offer a retry option when timeout errors occur
 * @param {Function} callback - Function to handle timeout retry (receives retryFn)
 */
export function setTimeoutRetryCallback(callback) {
    timeoutRetryCallback = callback;
}

/**
 * Show error notification if callback is set
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
function showErrorNotification(title, message) {
    if (notificationCallback) {
        notificationCallback('error', title, message);
    }
}

/**
 * Show warning notification if callback is set
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
function showWarningNotification(title, message) {
    if (notificationCallback) {
        notificationCallback('warning', title, message);
    }
}

// Create axios instance with config from central config
// Get API URL and Key from central config
const API_URL = getApiUrl();
const API_KEY = getApiKey();

const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
        ...(API_KEY && { 'X-API-Key': API_KEY }),
    },
    withCredentials: true, // CRITICAL: Required for CSRF cookie and session
    timeout: DEFAULT_TIMEOUT, // Default timeout for all requests
});

/**
 * Fetch CSRF token from server
 * @returns {Promise<string|null>} CSRF token or null on failure
 */
export async function fetchCsrfToken() {
    try {
        const response = await axios.get(`${API_URL}/api/auth/csrf`, {
            withCredentials: true,
            headers: {
                'X-API-Key': API_KEY,
            },
        });
        
        if (response.data.success) {
            csrfToken = response.data.data.token;
            // Set expiry time (subtract 60 seconds for safety margin)
            const expiresIn = (response.data.data.expiresIn - 60) * 1000;
            csrfTokenExpiry = Date.now() + expiresIn;
            return csrfToken;
        }
        return null;
    } catch (error) {
        console.error('Failed to fetch CSRF token:', error);
        return null;
    }
}

/**
 * Get current CSRF token, refreshing if expired
 * @returns {Promise<string|null>} CSRF token
 */
export async function getCsrfToken() {
    // Check if token exists and is not expired
    if (csrfToken && csrfTokenExpiry && Date.now() < csrfTokenExpiry) {
        return csrfToken;
    }
    // Fetch new token
    return await fetchCsrfToken();
}

/**
 * Clear CSRF token (call on logout)
 */
export function clearCsrfToken() {
    csrfToken = null;
    csrfTokenExpiry = null;
}

/**
 * Check if request method is state-changing (requires CSRF)
 * @param {string} method - HTTP method
 * @returns {boolean}
 */
function isStateChangingMethod(method) {
    return ['post', 'put', 'delete', 'patch'].includes(method?.toLowerCase());
}

// Request interceptor - Add security headers
apiClient.interceptors.request.use(
    async (config) => {
        // Add API key to all requests
        if (API_KEY) {
            config.headers['X-API-Key'] = API_KEY;
        }
        
        // JWT tokens are in HttpOnly cookies - automatically sent by browser
        // No need to manually attach Authorization header
        
        // Add CSRF token for state-changing requests
        if (isStateChangingMethod(config.method)) {
            const csrf = await getCsrfToken();
            if (csrf) {
                config.headers['X-CSRF-Token'] = csrf;
            }
        }
        
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor - Handle auth errors and enhanced error handling
apiClient.interceptors.response.use(
    (response) => {
        return response;
    },
    async (error) => {
        const originalRequest = error.config;
        
        // Parse the error for structured handling
        const parsedError = parseApiError(error);
        
        // Handle timeout errors
        // Requirements: 10.3
        if (isTimeoutError(error)) {
            showErrorNotification('Request Timeout', ERROR_MESSAGES.TIMEOUT_ERROR);
            
            // Offer retry option if callback is set
            if (timeoutRetryCallback && originalRequest && !originalRequest._timeoutRetry) {
                originalRequest._timeoutRetry = true;
                const retryFn = () => apiClient(originalRequest);
                timeoutRetryCallback(retryFn, originalRequest);
            }
            
            // Attach parsed error info
            error.parsedError = parsedError;
            return Promise.reject(error);
        }
        
        // Handle network errors (not timeout)
        if (isNetworkError(error) && !isTimeoutError(error)) {
            showErrorNotification('Connection Error', ERROR_MESSAGES.NETWORK_ERROR);
            error.parsedError = parsedError;
            return Promise.reject(error);
        }
        
        // Handle 401 Unauthorized - Redirect to login
        // Requirements: 10.4
        // Skip redirect for login endpoint - it handles its own 401 errors (invalid credentials)
        if (error.response?.status === 401 && !originalRequest.url?.includes('/api/auth/login')) {
            // Check if this is a token refresh failure
            if (originalRequest.url?.includes('/api/auth/refresh')) {
                // Refresh failed, clear auth and redirect
                localStorage.removeItem('user');
                clearCsrfToken();
                
                // Show session expired notification
                showErrorNotification('Session Expired', 'Your session has expired. Please log in again.');
                
                if (window.location.pathname.startsWith('/admin')) {
                    window.location.href = '/admin/login?expired=true';
                }
                return Promise.reject(error);
            }
            
            // Try to refresh token automatically (refresh token in HttpOnly cookie)
            if (!originalRequest._retry) {
                originalRequest._retry = true;
                
                try {
                    const response = await apiClient.post('/api/auth/refresh');
                    
                    if (response.data.success) {
                        // Tokens refreshed in cookies, retry original request
                        return apiClient(originalRequest);
                    }
                } catch (refreshError) {
                    // Refresh failed, clear auth
                    localStorage.removeItem('user');
                    clearCsrfToken();
                    
                    // Show session expired notification
                    showErrorNotification('Session Expired', 'Your session has expired. Please log in again.');
                    
                    if (window.location.pathname.startsWith('/admin')) {
                        window.location.href = '/admin/login?expired=true';
                    }
                    return Promise.reject(refreshError);
                }
            }
            
            // No retry or retry failed
            localStorage.removeItem('user');
            clearCsrfToken();
            
            // Show session expired notification
            showErrorNotification('Session Expired', 'Your session has expired. Please log in again.');
            
            if (window.location.pathname.startsWith('/admin')) {
                window.location.href = '/admin/login?expired=true';
            }
        }
        
        // Handle 403 Forbidden (API key or CSRF issues)
        if (error.response?.status === 403) {
            const message = error.response?.data?.message || '';
            
            // If CSRF token is invalid, try to refresh it
            if (message.toLowerCase().includes('csrf') && !originalRequest._csrfRetry) {
                originalRequest._csrfRetry = true;
                clearCsrfToken();
                
                // Fetch new CSRF token and retry
                const newCsrf = await fetchCsrfToken();
                if (newCsrf) {
                    originalRequest.headers['X-CSRF-Token'] = newCsrf;
                    return apiClient(originalRequest);
                }
            }
        }
        
        // Attach parsed error info to the error object for consumers
        error.parsedError = parsedError;
        
        return Promise.reject(error);
    }
);

/**
 * Make an API request with automatic retry for retryable errors
 * Uses exponential backoff: 1s, 2s, 4s (max 3 retries)
 * 
 * Requirements: 10.7
 * 
 * @param {Object} config - Axios request config
 * @param {Object} options - Retry options
 * @param {boolean} options.enableRetry - Enable retry logic (default: true)
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 * @param {Function} options.onRetry - Callback before each retry
 * @returns {Promise<any>} Response data
 */
export async function apiRequest(config, options = {}) {
    const {
        enableRetry = true,
        maxRetries = RETRY_CONFIG.MAX_RETRIES,
        onRetry = null,
    } = options;

    if (!enableRetry) {
        return apiClient(config);
    }

    return retryWithBackoff(
        () => apiClient(config),
        {
            maxRetries,
            shouldRetry: isRetryableError,
            onRetry: (attempt, delay, error) => {
                console.log(`API request retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
                if (onRetry) {
                    onRetry(attempt, delay, error);
                }
            },
        }
    );
}

/**
 * GET request with retry support
 * @param {string} url - Request URL
 * @param {Object} config - Axios config
 * @param {Object} retryOptions - Retry options
 * @returns {Promise<any>}
 */
export function apiGet(url, config = {}, retryOptions = {}) {
    return apiRequest({ ...config, method: 'get', url }, retryOptions);
}

/**
 * POST request with retry support
 * @param {string} url - Request URL
 * @param {any} data - Request body
 * @param {Object} config - Axios config
 * @param {Object} retryOptions - Retry options
 * @returns {Promise<any>}
 */
export function apiPost(url, data, config = {}, retryOptions = {}) {
    return apiRequest({ ...config, method: 'post', url, data }, retryOptions);
}

/**
 * PUT request with retry support
 * @param {string} url - Request URL
 * @param {any} data - Request body
 * @param {Object} config - Axios config
 * @param {Object} retryOptions - Retry options
 * @returns {Promise<any>}
 */
export function apiPut(url, data, config = {}, retryOptions = {}) {
    return apiRequest({ ...config, method: 'put', url, data }, retryOptions);
}

/**
 * DELETE request with retry support
 * @param {string} url - Request URL
 * @param {Object} config - Axios config
 * @param {Object} retryOptions - Retry options
 * @returns {Promise<any>}
 */
export function apiDelete(url, config = {}, retryOptions = {}) {
    return apiRequest({ ...config, method: 'delete', url }, retryOptions);
}

export default apiClient;
