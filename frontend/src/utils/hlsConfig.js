/**
 * HLS Configuration Module
 * Provides device-adaptive HLS.js configurations based on device tier
 * 
 * Configuration differences by tier:
 * - Low: enableWorker=false, maxBufferLength=15s, conservative settings
 * - Medium: enableWorker=true, maxBufferLength=25s, balanced settings
 * - High: enableWorker=true, maxBufferLength=30s, optimal settings
 * 
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
 */

/**
 * HLS configuration presets for each device tier
 */
const HLS_CONFIGS = {
    low: {
        // Worker disabled for CPU savings on low-end devices
        enableWorker: false,
        // Stability over latency
        lowLatencyMode: false,
        // Minimal back buffer to save memory
        backBufferLength: 10,
        // Small forward buffer (15s max)
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        // 30MB max buffer size
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        // Start with lowest quality for faster initial load
        startLevel: 0,
        // Conservative bandwidth estimation (300kbps)
        abrEwmaDefaultEstimate: 300000,
        // Conservative bandwidth usage
        abrBandWidthFactor: 0.7,
        abrBandWidthUpFactor: 0.5,
        // Longer timeout for slow connections
        fragLoadingTimeOut: 30000,
        // Fewer retries to fail faster
        fragLoadingMaxRetry: 4,
        // Longer delay between retries
        fragLoadingRetryDelay: 2000,
        // Level loading settings
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 2000,
    },
    medium: {
        // Worker enabled for better performance
        enableWorker: true,
        lowLatencyMode: false,
        // Moderate back buffer
        backBufferLength: 20,
        // Medium forward buffer (25s)
        maxBufferLength: 25,
        maxMaxBufferLength: 45,
        // 45MB max buffer size
        maxBufferSize: 45 * 1000 * 1000,
        maxBufferHole: 0.5,
        // Auto quality selection
        startLevel: -1,
        // Moderate bandwidth estimation (500kbps)
        abrEwmaDefaultEstimate: 500000,
        // Balanced bandwidth usage
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.6,
        // Standard timeout
        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1500,
        levelLoadingTimeOut: 12000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1500,
    },
    high: {
        // Worker enabled for optimal performance
        enableWorker: true,
        lowLatencyMode: false,
        // Large back buffer for smooth seeking
        backBufferLength: 30,
        // Large forward buffer (30s)
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        // 60MB max buffer size
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        // Auto quality selection
        startLevel: -1,
        // Higher bandwidth estimation (1Mbps)
        abrEwmaDefaultEstimate: 1000000,
        // Aggressive bandwidth usage
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.7,
        // Shorter timeout for faster failure detection
        fragLoadingTimeOut: 20000,
        // More retries for reliability
        fragLoadingMaxRetry: 6,
        // Shorter delay between retries
        fragLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 5,
        levelLoadingRetryDelay: 1000,
    },
};

/**
 * Mobile-specific configuration overrides
 * Applied on top of tier-based config for mobile devices
 */
const MOBILE_OVERRIDES = {
    // Smaller initial buffer for faster start on mobile
    maxBufferLength: (tierValue) => Math.min(tierValue, 20),
    // More conservative ABR on mobile networks
    abrBandWidthFactor: (tierValue) => Math.min(tierValue, 0.7),
    abrBandWidthUpFactor: (tierValue) => Math.min(tierValue, 0.5),
};

/**
 * Get HLS configuration for a specific device tier
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @param {Object} options - Additional options
 * @param {boolean} options.isMobile - Whether device is mobile
 * @param {Object} options.overrides - Custom configuration overrides
 * @returns {Object} HLS.js configuration object
 */
export const getHLSConfig = (tier, options = {}) => {
    const { isMobile = false, overrides = {} } = options;
    
    // Get base config for tier (default to medium if invalid tier)
    const baseConfig = { ...(HLS_CONFIGS[tier] || HLS_CONFIGS.medium) };
    
    // Apply mobile overrides if on mobile device
    if (isMobile) {
        baseConfig.maxBufferLength = MOBILE_OVERRIDES.maxBufferLength(baseConfig.maxBufferLength);
        baseConfig.abrBandWidthFactor = MOBILE_OVERRIDES.abrBandWidthFactor(baseConfig.abrBandWidthFactor);
        baseConfig.abrBandWidthUpFactor = MOBILE_OVERRIDES.abrBandWidthUpFactor(baseConfig.abrBandWidthUpFactor);
    }
    
    // Apply custom overrides
    return { ...baseConfig, ...overrides };
};

/**
 * Get specific configuration value for a tier
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @param {string} key - Configuration key
 * @returns {*} Configuration value
 */
export const getConfigValue = (tier, key) => {
    const config = HLS_CONFIGS[tier] || HLS_CONFIGS.medium;
    return config[key];
};

/**
 * Check if worker should be enabled for a tier
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @returns {boolean} Whether worker should be enabled
 */
export const shouldEnableWorker = (tier) => {
    return tier !== 'low';
};

/**
 * Get maximum buffer length for a tier
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @returns {number} Maximum buffer length in seconds
 */
export const getMaxBufferLength = (tier) => {
    const config = HLS_CONFIGS[tier] || HLS_CONFIGS.medium;
    return config.maxBufferLength;
};

/**
 * Get all available tier names
 * @returns {string[]} Array of tier names
 */
export const getAvailableTiers = () => {
    return Object.keys(HLS_CONFIGS);
};

/**
 * Validate if a tier name is valid
 * @param {string} tier - Tier name to validate
 * @returns {boolean} Whether tier is valid
 */
export const isValidTier = (tier) => {
    return tier in HLS_CONFIGS;
};

export default {
    getHLSConfig,
    getConfigValue,
    shouldEnableWorker,
    getMaxBufferLength,
    getAvailableTiers,
    isValidTier,
    HLS_CONFIGS,
};
