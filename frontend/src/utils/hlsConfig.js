/**
 * HLS Configuration Module
 * Provides device-adaptive HLS.js configurations based on device tier
 * 
 * RAM MODE OPTIMIZED - Tuned for instant playback from RAM disk
 * - Reduced buffer lengths for faster startup
 * - liveSyncDurationCount: 2 (minimal latency)
 * - Aggressive timeouts for quick failure detection
 * 
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
 */

/**
 * HLS configuration presets for each device tier
 * RAM MODE: Optimized for instant playback from /dev/shm
 */
const HLS_CONFIGS = {
    low: {
        // Worker disabled for CPU savings on low-end devices
        enableWorker: false,
        // Stability over latency
        lowLatencyMode: false,
        // MINIMAL buffers for instant startup from RAM
        backBufferLength: 5,
        maxBufferLength: 8,
        maxMaxBufferLength: 15,
        // 25MB max buffer size
        maxBufferSize: 25 * 1000 * 1000,
        maxBufferHole: 0.5,
        // AUTO quality - let HLS.js decide
        startLevel: -1,
        // INSTANT STARTUP: Minimal sync duration
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 3,
        // Shorter timeout for faster failure detection
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 2,
        fragLoadingRetryDelay: 800,
        levelLoadingTimeOut: 8000,
        levelLoadingMaxRetry: 2,
        levelLoadingRetryDelay: 800,
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 800,
    },
    medium: {
        enableWorker: true,
        lowLatencyMode: false,
        // REDUCED buffers for faster startup
        backBufferLength: 8,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        maxBufferSize: 40 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1,
        // INSTANT STARTUP
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 3,
        fragLoadingTimeOut: 8000,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 600,
        levelLoadingTimeOut: 6000,
        levelLoadingMaxRetry: 2,
        levelLoadingRetryDelay: 600,
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 600,
    },
    high: {
        enableWorker: true,
        lowLatencyMode: false,
        // OPTIMIZED buffers for RAM disk
        backBufferLength: 10,
        maxBufferLength: 12,
        maxMaxBufferLength: 25,
        maxBufferSize: 50 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1,
        // INSTANT STARTUP
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 3,
        fragLoadingTimeOut: 6000,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 500,
        levelLoadingTimeOut: 5000,
        levelLoadingMaxRetry: 2,
        levelLoadingRetryDelay: 500,
        manifestLoadingTimeOut: 5000,
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 500,
    },
};

/**
 * Mobile-specific configuration overrides
 * SIMPLIFIED: Only adjust buffer sizes for mobile
 */
const MOBILE_OVERRIDES = {
    maxBufferLength: (tierValue) => Math.min(tierValue, 20),
};

/**
 * Mobile phone config - RAM MODE optimized
 */
const MOBILE_PHONE_CONFIG = {
    maxBufferLength: 8,
    maxMaxBufferLength: 15,
    maxBufferSize: 20 * 1000 * 1000,
    startLevel: -1,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 3,
    fragLoadingTimeOut: 10000,
    fragLoadingRetryDelay: 800,
    levelLoadingTimeOut: 8000,
    manifestLoadingTimeOut: 8000,
};

/**
 * Mobile tablet config - RAM MODE optimized
 */
const MOBILE_TABLET_CONFIG = {
    maxBufferLength: 10,
    maxMaxBufferLength: 20,
    maxBufferSize: 30 * 1000 * 1000,
    startLevel: -1,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 3,
    fragLoadingTimeOut: 8000,
    fragLoadingRetryDelay: 600,
    levelLoadingTimeOut: 6000,
    manifestLoadingTimeOut: 6000,
};

/**
 * Get HLS configuration for a specific device tier
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @param {Object} options - Additional options
 * @param {boolean} options.isMobile - Whether device is mobile
 * @param {'phone' | 'tablet' | 'desktop'} options.mobileDeviceType - Mobile device type
 * @param {Object} options.overrides - Custom configuration overrides
 * @returns {Object} HLS.js configuration object
 */
export const getHLSConfig = (tier, options = {}) => {
    const { isMobile = false, mobileDeviceType = 'desktop', overrides = {} } = options;
    
    // Get base config for tier (default to medium if invalid tier)
    const baseConfig = { ...(HLS_CONFIGS[tier] || HLS_CONFIGS.medium) };
    
    // Apply mobile-specific configurations (simplified)
    if (isMobile) {
        if (mobileDeviceType === 'phone') {
            Object.assign(baseConfig, MOBILE_PHONE_CONFIG);
        } else if (mobileDeviceType === 'tablet') {
            Object.assign(baseConfig, MOBILE_TABLET_CONFIG);
        } else {
            baseConfig.maxBufferLength = MOBILE_OVERRIDES.maxBufferLength(baseConfig.maxBufferLength);
        }
    }
    
    // Apply custom overrides
    return { ...baseConfig, ...overrides };
};

/**
 * Get mobile-optimized HLS configuration
 * Convenience function for mobile devices
 * @param {'phone' | 'tablet'} deviceType - Mobile device type
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @returns {Object} Mobile-optimized HLS.js configuration
 */
export const getMobileHLSConfig = (deviceType, tier = 'medium') => {
    return getHLSConfig(tier, {
        isMobile: true,
        mobileDeviceType: deviceType,
    });
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
    getMobileHLSConfig,
    getConfigValue,
    shouldEnableWorker,
    getMaxBufferLength,
    getAvailableTiers,
    isValidTier,
    HLS_CONFIGS,
    MOBILE_PHONE_CONFIG,
    MOBILE_TABLET_CONFIG,
};

// Named exports for direct imports
export { HLS_CONFIGS, MOBILE_PHONE_CONFIG, MOBILE_TABLET_CONFIG };
