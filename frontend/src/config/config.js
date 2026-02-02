/**
 * Frontend Configuration
 * Central configuration file for all environment variables
 * 
 * All values are loaded from .env file via import.meta.env
 * No hardcoded values - everything configurable via .env
 * 
 * CRITICAL: All API URLs must be configured in .env file
 * - Development: VITE_API_URL=http://localhost:3000
 * - Production: VITE_API_URL=https://api.your-domain.com
 */

/**
 * Get API Base URL from environment variable
 * @returns {string} Backend API URL
 * @throws {Error} If VITE_API_URL is not configured
 */
export const getApiUrl = () => {
    const url = import.meta.env.VITE_API_URL;
    
    if (!url) {
        console.error('❌ VITE_API_URL not configured in .env file!');
        console.error('Please create frontend/.env file with:');
        console.error('  VITE_API_URL=http://localhost:3000  (development)');
        console.error('  VITE_API_URL=https://api.your-domain.com  (production)');
        throw new Error('API URL not configured. Please set VITE_API_URL in .env file.');
    }
    
    return url;
};

/**
 * Get API Key from environment variable
 * @returns {string} API Key for authentication
 */
export const getApiKey = () => {
    return import.meta.env.VITE_API_KEY || '';
};

/**
 * Check if running in development mode
 * @returns {boolean}
 */
export const isDevelopment = () => {
    return import.meta.env.DEV;
};

/**
 * Check if running in production mode
 * @returns {boolean}
 */
export const isProduction = () => {
    return import.meta.env.PROD;
};

/**
 * Get environment mode
 * @returns {string} 'development' or 'production'
 */
export const getMode = () => {
    return import.meta.env.MODE;
};

/**
 * Configuration object
 * All values loaded from .env file - no hardcoded defaults
 */
export const config = {
    api: {
        baseUrl: getApiUrl(),
        key: getApiKey(),
    },
    frontend: {
        domain: import.meta.env.VITE_FRONTEND_DOMAIN || 'localhost:5173',
    },
    env: {
        isDevelopment: isDevelopment(),
        isProduction: isProduction(),
        mode: getMode(),
    },
};

export default config;
