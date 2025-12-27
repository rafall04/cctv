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
 * Common audio configuration for all tiers
 * Ensures audio track is properly handled
 */
const AUDIO_CONFIG = {
    // Enable audio track switching
    audioCodecs: ['mp4a.40.2', 'mp4a.40.5', 'mp4a.40.29', 'opus'],
    // Don't skip audio-only segments
    testBandwidth: true,
    // Enable audio track selection
    enableSoftwareAES: true,
};

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
        // Audio settings
        ...AUDIO_CONFIG,
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
        // Audio settings
        ...AUDIO_CONFIG,
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
        // Audio settings
        ...AUDIO_CONFIG,
    },
};

/**
 * Mobile-specific configuration overrides
 * Applied on top of tier-based config for mobile devices
 * **Validates: Requirements 7.1, 7.2**
 */
const MOBILE_OVERRIDES = {
    // Smaller initial buffer for faster start on mobile
    maxBufferLength: (tierValue) => Math.min(tierValue, 20),
    // More conservative ABR on mobile networks
    abrBandWidthFactor: (tierValue) => Math.min(tierValue, 0.7),
    abrBandWidthUpFactor: (tierValue) => Math.min(tierValue, 0.5),
};

/**
 * Mobile-specific HLS configuration for phones
 * Uses smaller segments and more conservative settings
 * **Validates: Requirements 7.1, 7.2**
 */
const MOBILE_PHONE_CONFIG = {
    // Smaller buffer for faster initial load
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    // Smaller buffer size for memory constraints
    maxBufferSize: 25 * 1000 * 1000, // 25MB
    // Start with lowest quality for faster initial load
    startLevel: 0,
    // More conservative bandwidth estimation
    abrEwmaDefaultEstimate: 250000, // 250kbps
    abrBandWidthFactor: 0.6,
    abrBandWidthUpFactor: 0.4,
    // Longer timeouts for mobile networks
    fragLoadingTimeOut: 35000,
    fragLoadingRetryDelay: 2500,
};

/**
 * Mobile-specific HLS configuration for tablets
 * Balanced between phone and desktop settings
 */
const MOBILE_TABLET_CONFIG = {
    maxBufferLength: 20,
    maxMaxBufferLength: 40,
    maxBufferSize: 35 * 1000 * 1000, // 35MB
    startLevel: -1, // Auto for tablets
    abrEwmaDefaultEstimate: 400000, // 400kbps
    abrBandWidthFactor: 0.7,
    abrBandWidthUpFactor: 0.5,
    fragLoadingTimeOut: 30000,
    fragLoadingRetryDelay: 2000,
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
    
    // Apply mobile-specific configurations
    // **Validates: Requirements 7.1, 7.2**
    if (isMobile) {
        // Apply device-type specific mobile config
        if (mobileDeviceType === 'phone') {
            Object.assign(baseConfig, MOBILE_PHONE_CONFIG);
        } else if (mobileDeviceType === 'tablet') {
            Object.assign(baseConfig, MOBILE_TABLET_CONFIG);
        } else {
            // Generic mobile overrides
            baseConfig.maxBufferLength = MOBILE_OVERRIDES.maxBufferLength(baseConfig.maxBufferLength);
            baseConfig.abrBandWidthFactor = MOBILE_OVERRIDES.abrBandWidthFactor(baseConfig.abrBandWidthFactor);
            baseConfig.abrBandWidthUpFactor = MOBILE_OVERRIDES.abrBandWidthUpFactor(baseConfig.abrBandWidthUpFactor);
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
