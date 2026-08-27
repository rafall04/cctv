/**
 * HLS Configuration Module
 * Provides device-adaptive HLS.js configurations based on device tier
 * 
 * RESILIENT LIVE MODE - Cushion against packet-loss bursts on weak links
 * - lowLatencyMode: false (server must also run hlsVariant: fmp4, NOT lowLatency)
 * - liveSyncDurationCount: 3 (~6s behind live edge — rides out jitter/loss, e.g. Telkomsel->Cloudflare SIN)
 * - Standard buffer lengths for smooth playback
 * - Balanced timeouts for reliability
 * 
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
 */

/**
 * HLS configuration presets for each device tier
 * STANDARD HLS MODE: Prioritizing stability and smooth playback
 */
import { getDeviceCapabilities } from './deviceDetector.js';

const HLS_CONFIGS = {
    low: {
        // Worker ENABLED for all tiers (offload parsing to background thread)
        // This prevents UI freeze on low-end devices
        enableWorker: true,
        // STANDARD HLS: Stability over latency
        lowLatencyMode: false,
        // BALANCED buffers - increased from aggressive optimization for stability
        backBufferLength: 5,
        maxBufferLength: 12,
        maxMaxBufferLength: 18,
        // 12MB max buffer size (increased from 10MB for better stability)
        maxBufferSize: 12 * 1000 * 1000,
        maxBufferHole: 0.5,
        // AUTO quality - let HLS.js decide
        startLevel: -1,
        // RIDE-OUT BUFFER: start ~3 segments (~6s) behind live edge to absorb
        // packet-loss bursts on weak links (e.g. Telkomsel->SIN). lowLatencyMode stays false.
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 9,
        // Balanced timeouts for reliability
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 30000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 30000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
    },
    medium: {
        enableWorker: true,
        lowLatencyMode: false,
        // BALANCED buffers - increased from aggressive optimization for stability
        backBufferLength: 10,
        maxBufferLength: 18,
        maxMaxBufferLength: 25,
        maxBufferSize: 18 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1,
        // RIDE-OUT BUFFER: start ~3 segments (~6s) behind live edge to absorb
        // packet-loss bursts on weak links (e.g. Telkomsel->SIN). lowLatencyMode stays false.
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 9,
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 30000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 30000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
    },
    high: {
        enableWorker: true,
        lowLatencyMode: false,
        // BALANCED buffers - increased from aggressive optimization for stability
        backBufferLength: 15,
        maxBufferLength: 25,
        maxMaxBufferLength: 35,
        maxBufferSize: 25 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1,
        // RIDE-OUT BUFFER: start ~3 segments (~6s) behind live edge to absorb
        // packet-loss bursts on weak links (e.g. Telkomsel->SIN). lowLatencyMode stays false.
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 9,
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 30000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 30000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
    },
};

/**
 * Mobile-specific configuration overrides
 * SIMPLIFIED: Only adjust buffer sizes for mobile
 */
const MOBILE_OVERRIDES = {
    maxBufferLength: (tierValue) => Math.min(tierValue, 12),
};

/**
 * Mobile phone config - BALANCED for stability
 */
/*
 * Timeout pemuatan SENGAJA tidak di-override di sini, dan itu perubahan 2026-08-26.
 *
 * Preset ponsel ini TIDAK PERNAH AKTIF sejak ditulis - ketiga pemanggilnya meneruskan
 * `isMobile: false` yang di-hardcode, jadi seluruh blok ini kode mati. Artinya nilai 10 dtk
 * yang dulu ada di sini tidak pernah teruji di lapangan sama sekali, sedangkan 30 dtk milik
 * tier-nya sudah berjalan di produksi bertahun-tahun. Menyalakan preset ini SEKALIGUS
 * memangkas timeout jadi sepertiganya berarti mengirim dua perubahan sebagai satu, ke armada
 * yang justru paling rentan: pengguna seluler Indonesia, yang jalur Cloudflare-nya ke SIN
 * sudah terukur menambah latensi.
 *
 * Yang jelas menguntungkan ponsel adalah buffer yang lebih kecil (RAM, baterai, data), dan
 * itu yang dipertahankan. Timeout-nya mewarisi tier - kalau nanti mau diperpendek, kirim
 * sebagai perubahan tersendiri dengan pengukurannya.
 */
const MOBILE_PHONE_CONFIG = {
    maxBufferLength: 10,
    maxMaxBufferLength: 15,
    maxBufferSize: 10 * 1000 * 1000,
    startLevel: -1,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 9,
};

/**
 * Mobile tablet config - BALANCED for stability
 */
const MOBILE_TABLET_CONFIG = {
    maxBufferLength: 15,
    maxMaxBufferLength: 22,
    maxBufferSize: 15 * 1000 * 1000,
    startLevel: -1,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 9,
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
 * Konfigurasi HLS untuk perangkat YANG SEDANG DIPAKAI - satu-satunya bentuk yang sebaiknya
 * dipanggil komponen pemutar.
 *
 * Sebelum ini setiap pemutar menyusun opsinya sendiri, dan ketiganya meneruskan
 * `isMobile: false` yang di-hardcode - sehingga seluruh preset ponsel di atas tidak pernah
 * jalan satu kali pun. Membiarkan pemanggil mendeklarasikan sendiri perangkatnya berarti
 * cacat itu bisa kembali kapan saja; di sini ia tidak bisa.
 *
 * @param {Object} overrides - override khusus pemanggil (opsional)
 * @returns {Object} konfigurasi hls.js
 */
export const getDeviceHLSConfig = (overrides = {}) => {
    const { tier, isMobile, mobileDeviceType } = getDeviceCapabilities();
    return getHLSConfig(tier, { isMobile, mobileDeviceType, overrides });
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
