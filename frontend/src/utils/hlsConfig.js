/**
 * HLS Configuration Module
 * Provides device-adaptive HLS.js configurations based on device tier
 * 
 * SMOOTH SYNCHRONIZED MODE - Balance between sync and stability
 * - liveSyncDurationCount: 2 (4s buffer, eliminates freeze while maintaining sync)
 * - Standard buffer lengths for smooth playback
 * - Balanced timeouts for reliability
 * 
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
 */

/**
 * HLS configuration presets for each device tier
 * STANDARD HLS MODE: Prioritizing stability and smooth playback
 */
const HLS_CONFIGS = {
    low: {
        // Worker disabled for CPU savings on low-end devices
        enableWorker: false,
        // STANDARD HLS: Stability over latency
        lowLatencyMode: false,
        // SAFE buffers for smooth playback
        backBufferLength: 10,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        // 30MB max buffer size
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        // AUTO quality - let HLS.js decide
        startLevel: -1,
        // SMOOTH PLAYBACK: 2 segments buffer (4s) - eliminates freeze, maintains sync
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 5,
        // Balanced timeouts for reliability
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
    },
    medium: {
        enableWorker: true,
        lowLatencyMode: false,
        // BALANCED buffers for smooth playback
        backBufferLength: 20,
        maxBufferLength: 25,
        maxMaxBufferLength: 45,
        maxBufferSize: 45 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1,
        // SMOOTH PLAYBACK: 2 segments buffer (4s) - eliminates freeze, maintains sync
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 5,
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
    },
    high: {
        enableWorker: true,
        lowLatencyMode: false,
        // OPTIMAL buffers for smooth playback
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1,
        // SMOOTH PLAYBACK: 2 segments buffer (4s) - eliminates freeze, maintains sync
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 5,
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
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
 * Mobile phone config - SMOOTH PLAYBACK optimized
 */
const MOBILE_PHONE_CONFIG = {
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    maxBufferSize: 25 * 1000 * 1000,
    startLevel: -1,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 5,
    fragLoadingTimeOut: 10000,
    fragLoadingRetryDelay: 1000,
    levelLoadingTimeOut: 10000,
    manifestLoadingTimeOut: 10000,
};

/**
 * Mobile tablet config - SMOOTH PLAYBACK optimized
 */
const MOBILE_TABLET_CONFIG = {
    maxBufferLength: 20,
    maxMaxBufferLength: 40,
    maxBufferSize: 35 * 1000 * 1000,
    startLevel: -1,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 5,
    fragLoadingTimeOut: 10000,
    fragLoadingRetryDelay: 1000,
    levelLoadingTimeOut: 10000,
    manifestLoadingTimeOut: 10000,
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
