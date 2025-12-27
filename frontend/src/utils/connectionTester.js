/**
 * ConnectionTester Module
 * 
 * Modul untuk menguji konektivitas ke MediaMTX sebelum memulai stream.
 * Implements connection pre-check with timeout using AbortController.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

// Default timeout for connection tests (5 seconds per requirement 3.4)
export const DEFAULT_TIMEOUT = 5000;

/**
 * @typedef {Object} ConnectionTestResult
 * @property {boolean} reachable - Whether the server is reachable
 * @property {number} latency - Connection latency in milliseconds (-1 if failed)
 * @property {string} [error] - Error message if connection failed
 */

/**
 * Test connection to a server using a lightweight HEAD request.
 * Uses AbortController for timeout handling.
 * 
 * @param {string} url - The URL to test connection to
 * @param {number} [timeout=5000] - Timeout in milliseconds (default: 5000ms)
 * @returns {Promise<ConnectionTestResult>} Connection test result
 * 
 * Requirements:
 * - 3.1: Verify MediaMTX server is reachable before stream loading
 * - 3.2: Display server offline message if unreachable
 * - 3.3: Use lightweight HEAD request
 * - 3.4: Timeout after 5 seconds
 */
export const testConnection = async (url, timeout = DEFAULT_TIMEOUT) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const startTime = performance.now();
    
    try {
        // Use HEAD request for lightweight check (Requirement 3.3)
        // Note: mode 'no-cors' returns opaque response, so we can't check status
        // A successful fetch (even 404) means the server is reachable
        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            mode: 'cors', // Use cors mode to get actual response status
        });
        
        clearTimeout(timeoutId);
        const latency = performance.now() - startTime;
        
        // Server is reachable if we got any response (even 404 on base path is OK)
        // 404 on /hls/ is expected - there's no index file, but server is up
        return {
            reachable: true,
            latency,
        };
    } catch (error) {
        clearTimeout(timeoutId);
        const latency = performance.now() - startTime;
        
        // If it's a CORS error, the server is still reachable
        // CORS errors happen when server responds but blocks cross-origin
        if (error.name === 'TypeError' && error.message.includes('CORS')) {
            return {
                reachable: true,
                latency,
            };
        }
        
        // Determine error message based on error type
        let errorMessage;
        if (error.name === 'AbortError') {
            errorMessage = 'Connection timeout';
        } else if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            errorMessage = 'Server unreachable';
        } else {
            errorMessage = error.message || 'Connection failed';
        }
        
        return {
            reachable: false,
            latency: -1,
            error: errorMessage,
        };
    }
};

/**
 * Simple helper to check if a server is reachable.
 * 
 * @param {string} url - The URL to check
 * @param {number} [timeout=5000] - Timeout in milliseconds
 * @returns {Promise<boolean>} True if server is reachable
 */
export const isServerReachable = async (url, timeout = DEFAULT_TIMEOUT) => {
    const result = await testConnection(url, timeout);
    return result.reachable;
};

/**
 * Test connection to MediaMTX HLS endpoint.
 * Constructs the proper URL for testing MediaMTX availability.
 * 
 * @param {string} baseUrl - Base URL of MediaMTX HLS server (e.g., 'http://localhost:8888')
 * @param {string} [streamPath] - Optional stream path to test specific stream
 * @param {number} [timeout=5000] - Timeout in milliseconds
 * @returns {Promise<ConnectionTestResult>} Connection test result
 */
export const testMediaMTXConnection = async (baseUrl, streamPath = '', timeout = DEFAULT_TIMEOUT) => {
    // If streamPath is provided, test the specific stream manifest
    const url = streamPath ? `${baseUrl}/${streamPath}/index.m3u8` : baseUrl;
    return testConnection(url, timeout);
};

// Export default object for convenience
export default {
    testConnection,
    isServerReachable,
    testMediaMTXConnection,
    DEFAULT_TIMEOUT,
};
