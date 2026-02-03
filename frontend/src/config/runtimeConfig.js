/**
 * Runtime Configuration Loader
 * 
 * Loads configuration from backend at runtime
 * Allows deployment without rebuild when domain/IP changes
 * 
 * Usage:
 *   import { getApiUrl, loadRuntimeConfig } from './config/runtimeConfig';
 *   
 *   // Load config once at app startup
 *   await loadRuntimeConfig();
 *   
 *   // Get API URL
 *   const apiUrl = getApiUrl();
 */

let runtimeConfig = null;
let loadPromise = null;

/**
 * Load runtime configuration from backend
 * 
 * @returns {Promise<Object>} Configuration object
 */
export const loadRuntimeConfig = async () => {
    // Return cached config if already loaded
    if (runtimeConfig) {
        return runtimeConfig;
    }
    
    // Return existing promise if already loading
    if (loadPromise) {
        return loadPromise;
    }
    
    // Start loading
    loadPromise = (async () => {
        try {
            // Try to load from backend
            const response = await fetch('/api/config/public', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });
            
            if (!response.ok) {
                throw new Error(`Failed to load config: ${response.status}`);
            }
            
            const config = await response.json();
            
            console.log('✅ Runtime config loaded from backend:', config);
            
            runtimeConfig = {
                apiUrl: config.apiUrl,
                frontendDomain: config.frontendDomain,
                serverIp: config.serverIp,
                portPublic: config.portPublic,
                protocol: config.protocol,
                wsProtocol: config.wsProtocol,
                source: 'backend',
            };
            
            return runtimeConfig;
        } catch (error) {
            console.warn('⚠️ Failed to load runtime config from backend:', error.message);
            console.warn('⚠️ Falling back to .env configuration');
            
            // Fallback to .env
            runtimeConfig = {
                apiUrl: import.meta.env.VITE_API_URL || window.location.origin,
                frontendDomain: import.meta.env.VITE_FRONTEND_DOMAIN || window.location.hostname,
                serverIp: '',
                portPublic: window.location.port || '800',
                protocol: window.location.protocol.replace(':', ''),
                wsProtocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
                source: 'env',
            };
            
            return runtimeConfig;
        } finally {
            loadPromise = null;
        }
    })();
    
    return loadPromise;
};

/**
 * Get API URL
 * 
 * @returns {string} Backend API URL
 */
export const getApiUrl = () => {
    if (!runtimeConfig) {
        console.warn('⚠️ Runtime config not loaded yet! Call loadRuntimeConfig() first');
        // Return fallback
        return import.meta.env.VITE_API_URL || window.location.origin;
    }
    
    return runtimeConfig.apiUrl;
};

/**
 * Get frontend domain
 * 
 * @returns {string} Frontend domain
 */
export const getFrontendDomain = () => {
    if (!runtimeConfig) {
        return import.meta.env.VITE_FRONTEND_DOMAIN || window.location.hostname;
    }
    
    return runtimeConfig.frontendDomain;
};

/**
 * Get server IP
 * 
 * @returns {string} Server IP address
 */
export const getServerIp = () => {
    if (!runtimeConfig) {
        return '';
    }
    
    return runtimeConfig.serverIp;
};

/**
 * Get protocol
 * 
 * @returns {string} Protocol (http or https)
 */
export const getProtocol = () => {
    if (!runtimeConfig) {
        return window.location.protocol.replace(':', '');
    }
    
    return runtimeConfig.protocol;
};

/**
 * Get WebSocket protocol
 * 
 * @returns {string} WebSocket protocol (ws or wss)
 */
export const getWsProtocol = () => {
    if (!runtimeConfig) {
        return window.location.protocol === 'https:' ? 'wss' : 'ws';
    }
    
    return runtimeConfig.wsProtocol;
};

/**
 * Get configuration source
 * 
 * @returns {string} 'backend' or 'env'
 */
export const getConfigSource = () => {
    if (!runtimeConfig) {
        return 'unknown';
    }
    
    return runtimeConfig.source;
};

/**
 * Check if runtime config is loaded
 * 
 * @returns {boolean}
 */
export const isConfigLoaded = () => {
    return runtimeConfig !== null;
};

/**
 * Reset runtime config (for testing)
 */
export const resetConfig = () => {
    runtimeConfig = null;
    loadPromise = null;
};

/**
 * Get full runtime config object
 * 
 * @returns {Object|null} Configuration object or null if not loaded
 */
export const getRuntimeConfig = () => {
    return runtimeConfig;
};
