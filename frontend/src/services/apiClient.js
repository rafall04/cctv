import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://api-cctv.raf.my.id';
const API_KEY = import.meta.env.VITE_API_KEY || '';

// CSRF token storage
let csrfToken = null;
let csrfTokenExpiry = null;

const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true, // Required for CSRF cookie
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
        
        // Add JWT token if available
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        
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

// Response interceptor - Handle auth errors
apiClient.interceptors.response.use(
    (response) => {
        return response;
    },
    async (error) => {
        const originalRequest = error.config;
        
        // Handle 401 Unauthorized
        if (error.response?.status === 401) {
            // Check if this is a token refresh failure
            if (originalRequest.url?.includes('/api/auth/refresh')) {
                // Refresh failed, clear auth and redirect
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                localStorage.removeItem('user');
                clearCsrfToken();
                
                if (window.location.pathname.startsWith('/admin')) {
                    window.location.href = '/admin/login';
                }
                return Promise.reject(error);
            }
            
            // Try to refresh token if we have a refresh token
            const refreshToken = localStorage.getItem('refreshToken');
            if (refreshToken && !originalRequest._retry) {
                originalRequest._retry = true;
                
                try {
                    const response = await apiClient.post('/api/auth/refresh', {
                        refreshToken: refreshToken
                    });
                    
                    if (response.data.success) {
                        const { accessToken, refreshToken: newRefreshToken } = response.data.data;
                        localStorage.setItem('token', accessToken);
                        localStorage.setItem('refreshToken', newRefreshToken);
                        
                        // Retry original request with new token
                        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
                        return apiClient(originalRequest);
                    }
                } catch (refreshError) {
                    // Refresh failed, clear auth
                    localStorage.removeItem('token');
                    localStorage.removeItem('refreshToken');
                    localStorage.removeItem('user');
                    clearCsrfToken();
                    
                    if (window.location.pathname.startsWith('/admin')) {
                        window.location.href = '/admin/login';
                    }
                    return Promise.reject(refreshError);
                }
            }
            
            // No refresh token or retry failed
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
            clearCsrfToken();
            
            if (window.location.pathname.startsWith('/admin')) {
                window.location.href = '/admin/login';
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
        
        return Promise.reject(error);
    }
);

export default apiClient;
