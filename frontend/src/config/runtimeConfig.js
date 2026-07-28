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

export const normalizeApiBaseUrl = (url) => {
    const normalized = String(url || '').trim().replace(/\/$/, '');

    if (!normalized || normalized === '/api') {
        return '';
    }

    return normalized;
};

function getFallbackApiUrl() {
    if (import.meta.env.DEV) {
        return normalizeApiBaseUrl(import.meta.env.VITE_API_URL || '');
    }

    return '';
}

const warmedOrigins = new Set();

/**
 * Warm the connection to the API origin as soon as it is known.
 *
 * Camera thumbnails — the landing page's LCP image — are served from the API host, which in
 * production is a different subdomain than the SPA. Without this, the DNS + TCP + TLS handshake
 * is paid inside the first thumbnail request. The API host is only known after /api/config/public
 * resolves, so a static <link> in index.html cannot express it; emitting here still lands well
 * before the grid mounts. Two preconnects are deliberate: <img> loads are no-CORS and use a
 * different connection-pool entry than the crossorigin fetches apiClient makes.
 *
 * No-op for same-origin deployments (apiUrl empty) and for an origin already warmed.
 */
function preconnectApiOrigin(apiUrl) {
    if (!apiUrl || typeof document === 'undefined' || typeof window === 'undefined') {
        return;
    }

    let origin;
    try {
        origin = new URL(apiUrl, window.location.href).origin;
    } catch {
        return;
    }

    if (origin === window.location.origin || warmedOrigins.has(origin)) {
        return;
    }
    warmedOrigins.add(origin);

    const hints = [
        { rel: 'preconnect', crossOrigin: null },
        { rel: 'preconnect', crossOrigin: 'anonymous' },
        { rel: 'dns-prefetch', crossOrigin: null },
    ];

    for (const hint of hints) {
        const link = document.createElement('link');
        link.rel = hint.rel;
        link.href = origin;
        if (hint.crossOrigin) {
            link.crossOrigin = hint.crossOrigin;
        }
        document.head.appendChild(link);
    }
}

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
                apiUrl: normalizeApiBaseUrl(config.apiUrl),
                frontendDomain: config.frontendDomain,
                serverIp: config.serverIp,
                portPublic: config.portPublic,
                protocol: config.protocol,
                wsProtocol: config.wsProtocol,
                appVersion: config.appVersion || 'unknown',
                buildId: config.buildId || 'unknown',
                source: 'backend',
            };

            preconnectApiOrigin(runtimeConfig.apiUrl);

            return runtimeConfig;
        } catch (error) {
            console.warn('⚠️ Failed to load runtime config from backend:', error.message);
            console.warn('⚠️ Falling back to .env configuration');

            // In production, prefer current-origin relative routing instead of a baked-in host.
            runtimeConfig = {
                apiUrl: getFallbackApiUrl(),
                frontendDomain: import.meta.env.VITE_FRONTEND_DOMAIN || window.location.hostname,
                serverIp: '',
                portPublic: window.location.port || '800',
                protocol: window.location.protocol.replace(':', ''),
                wsProtocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
                appVersion: import.meta.env.VITE_APP_VERSION || 'unknown',
                buildId: import.meta.env.VITE_BUILD_ID || 'env-fallback',
                source: 'env',
            };

            preconnectApiOrigin(runtimeConfig.apiUrl);

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
        if (import.meta.env.MODE !== 'test') {
            console.warn('⚠️ Runtime config not loaded yet! Call loadRuntimeConfig() first');
        }
        return getFallbackApiUrl();
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
    warmedOrigins.clear();
};

/**
 * Get full runtime config object
 * 
 * @returns {Object|null} Configuration object or null if not loaded
 */
export const getRuntimeConfig = () => {
    return runtimeConfig;
};
