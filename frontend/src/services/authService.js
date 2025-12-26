import apiClient, { clearCsrfToken, fetchCsrfToken } from './apiClient';

/**
 * Authentication Service
 * 
 * Handles login, logout, token refresh, and session management.
 * Supports progressive delay feedback and account lockout handling.
 * 
 * Requirements: 1.1, 1.6, 3.6, 4.2, 4.5
 */

export const authService = {
    /**
     * Login with username and password
     * Handles progressive delay and account lockout responses
     * 
     * @param {string} username - User's username
     * @param {string} password - User's password
     * @returns {Promise<Object>} Login result with success status and user data or error
     */
    async login(username, password) {
        try {
            // Ensure we have a fresh CSRF token before login
            await fetchCsrfToken();
            
            const response = await apiClient.post('/api/auth/login', {
                username,
                password,
            });

            if (response.data.success) {
                const { accessToken, refreshToken, user } = response.data.data;
                
                // Store tokens
                localStorage.setItem('token', accessToken);
                if (refreshToken) {
                    localStorage.setItem('refreshToken', refreshToken);
                }
                localStorage.setItem('user', JSON.stringify(user));
                
                return { 
                    success: true, 
                    user,
                    // Include password expiry warning if present
                    passwordExpiryWarning: response.data.data.passwordExpiryWarning || null
                };
            }

            return { 
                success: false, 
                message: response.data.message || 'Login failed'
            };
        } catch (error) {
            const response = error.response;
            
            // Handle specific error cases
            if (response?.status === 429) {
                // Rate limited - extract retry-after info
                const retryAfter = response.headers['retry-after'];
                return {
                    success: false,
                    message: 'Too many login attempts. Please try again later.',
                    retryAfter: retryAfter ? parseInt(retryAfter, 10) : 60,
                    isRateLimited: true
                };
            }
            
            if (response?.status === 401) {
                // Check for progressive delay info in response
                const data = response.data || {};
                
                // Account lockout or invalid credentials
                return {
                    success: false,
                    message: data.message || 'Invalid credentials',
                    // Progressive delay info (if server provides it)
                    delay: data.delay || null,
                    attemptsRemaining: data.attemptsRemaining || null,
                    isLocked: data.isLocked || false,
                    lockoutRemaining: data.lockoutRemaining || null
                };
            }
            
            if (response?.status === 403) {
                // CSRF or API key issue
                return {
                    success: false,
                    message: 'Security validation failed. Please refresh the page.',
                    isSecurityError: true
                };
            }

            return {
                success: false,
                message: response?.data?.message || 'Login failed. Please try again.',
            };
        }
    },

    /**
     * Logout and clear all session data
     */
    async logout() {
        try {
            await apiClient.post('/api/auth/logout');
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Always clear local storage and CSRF token
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
            clearCsrfToken();
        }
    },

    /**
     * Refresh access token using refresh token
     * @returns {Promise<Object>} Result with new tokens or error
     */
    async refreshTokens() {
        const refreshToken = localStorage.getItem('refreshToken');
        
        if (!refreshToken) {
            return { success: false, message: 'No refresh token available' };
        }

        try {
            const response = await apiClient.post('/api/auth/refresh', {
                refreshToken: refreshToken
            });

            if (response.data.success) {
                const { accessToken, refreshToken: newRefreshToken } = response.data.data;
                
                localStorage.setItem('token', accessToken);
                localStorage.setItem('refreshToken', newRefreshToken);
                
                return { success: true };
            }

            return { success: false, message: response.data.message };
        } catch (error) {
            // Clear tokens on refresh failure
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
            clearCsrfToken();
            
            return {
                success: false,
                message: error.response?.data?.message || 'Session expired. Please login again.'
            };
        }
    },

    /**
     * Verify current token is valid
     * @returns {Promise<boolean>} True if token is valid
     */
    async verifyToken() {
        try {
            const response = await apiClient.get('/api/auth/verify');
            return response.data.success;
        } catch (error) {
            return false;
        }
    },

    /**
     * Get current user from local storage
     * @returns {Object|null} User object or null
     */
    getCurrentUser() {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    },

    /**
     * Check if user is authenticated (has token)
     * @returns {boolean}
     */
    isAuthenticated() {
        return !!localStorage.getItem('token');
    },

    /**
     * Check if user has refresh token
     * @returns {boolean}
     */
    hasRefreshToken() {
        return !!localStorage.getItem('refreshToken');
    },

    /**
     * Get stored access token
     * @returns {string|null}
     */
    getAccessToken() {
        return localStorage.getItem('token');
    },

    /**
     * Get stored refresh token
     * @returns {string|null}
     */
    getRefreshToken() {
        return localStorage.getItem('refreshToken');
    }
};

export default authService;
