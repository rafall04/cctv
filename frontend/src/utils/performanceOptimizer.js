/**
 * Performance Optimizer Module
 * Utilities untuk optimasi performa di device low-end
 * 
 * Fitur:
 * - Reduce motion untuk animasi
 * - Throttle re-renders
 * - Memory-aware stream limits
 * - Lazy component loading helpers
 */

import { detectDeviceTier, getDeviceRAM, isMobileDevice } from './deviceDetector';

/**
 * Check if device prefers reduced motion (accessibility + performance)
 * @returns {boolean}
 */
export const prefersReducedMotion = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
};

/**
 * Get optimized refresh interval based on device tier
 * Low-end: 60s, Medium: 30s, High: 15s
 * @returns {number} Interval in milliseconds
 */
export const getOptimalRefreshInterval = () => {
    const tier = detectDeviceTier();
    switch (tier) {
        case 'low': return 60000;    // 60 detik
        case 'medium': return 30000; // 30 detik
        case 'high': return 15000;   // 15 detik
        default: return 30000;
    }
};

/**
 * Get optimized skeleton count for loading state
 * Reduce skeleton count on low-end devices
 * @returns {number}
 */
export const getSkeletonCount = () => {
    const tier = detectDeviceTier();
    switch (tier) {
        case 'low': return 2;
        case 'medium': return 3;
        case 'high': return 6;
        default: return 3;
    }
};

/**
 * Check if heavy features should be disabled
 * @returns {boolean}
 */
export const shouldDisableHeavyFeatures = () => {
    const tier = detectDeviceTier();
    const ram = getDeviceRAM();
    return tier === 'low' || ram <= 2;
};

/**
 * Get optimized CSS classes based on device tier
 * Removes heavy effects on low-end devices
 * @param {Object} classes - Object with normal and light versions
 * @returns {string}
 */
export const getOptimizedClasses = (classes) => {
    const { normal, light } = classes;
    return shouldDisableHeavyFeatures() ? light : normal;
};

/**
 * Backdrop blur class - disabled on low-end
 * @returns {string}
 */
export const getBackdropClass = () => {
    return shouldDisableHeavyFeatures() ? '' : 'backdrop-blur-sm';
};

/**
 * Get transition class - simplified on low-end
 * @param {string} normalTransition - Full transition class
 * @returns {string}
 */
export const getTransitionClass = (normalTransition = 'transition-all duration-200') => {
    if (shouldDisableHeavyFeatures()) {
        return ''; // No transition on low-end
    }
    return normalTransition;
};

/**
 * Get shadow class - simplified on low-end
 * @param {string} normalShadow - Full shadow class
 * @returns {string}
 */
export const getShadowClass = (normalShadow = 'shadow-lg') => {
    if (shouldDisableHeavyFeatures()) {
        return 'shadow-sm'; // Lighter shadow
    }
    return normalShadow;
};

/**
 * Check if clock should update every second
 * On low-end, update every 10 seconds instead
 * @returns {number} Update interval in ms
 */
export const getClockUpdateInterval = () => {
    const tier = detectDeviceTier();
    return tier === 'low' ? 10000 : 1000;
};

/**
 * Get debounce delay for search input
 * Longer delay on low-end to reduce re-renders
 * @returns {number} Delay in ms
 */
export const getSearchDebounceDelay = () => {
    const tier = detectDeviceTier();
    switch (tier) {
        case 'low': return 500;
        case 'medium': return 300;
        case 'high': return 150;
        default: return 300;
    }
};

/**
 * Check if map should use simplified markers
 * @returns {boolean}
 */
export const shouldUseSimplifiedMarkers = () => {
    return shouldDisableHeavyFeatures() || isMobileDevice();
};

/**
 * Get maximum cameras to render in grid
 * Pagination for low-end devices
 * @returns {number}
 */
export const getMaxGridCameras = () => {
    const tier = detectDeviceTier();
    switch (tier) {
        case 'low': return 6;      // Max 6 cards
        case 'medium': return 12;  // Max 12 cards
        case 'high': return 24;    // Max 24 cards
        default: return 12;
    }
};

/**
 * Check if video should autoplay
 * Disabled on low-end mobile to save battery/data
 * @returns {boolean}
 */
export const shouldAutoplayVideo = () => {
    const tier = detectDeviceTier();
    const mobile = isMobileDevice();
    
    // No autoplay on low-end mobile
    if (tier === 'low' && mobile) return false;
    
    return true;
};

/**
 * Get image loading strategy
 * @returns {'lazy' | 'eager'}
 */
export const getImageLoadingStrategy = () => {
    return 'lazy'; // Always lazy load images
};

/**
 * Performance config object for components
 * @returns {Object}
 */
export const getPerformanceConfig = () => {
    const tier = detectDeviceTier();
    const isLowEnd = tier === 'low';
    
    return {
        tier,
        isLowEnd,
        disableAnimations: isLowEnd,
        disableBackdropBlur: isLowEnd,
        disableTransitions: isLowEnd,
        reducedShadows: isLowEnd,
        clockInterval: getClockUpdateInterval(),
        refreshInterval: getOptimalRefreshInterval(),
        searchDebounce: getSearchDebounceDelay(),
        skeletonCount: getSkeletonCount(),
        maxGridCameras: getMaxGridCameras(),
        useSimplifiedMarkers: shouldUseSimplifiedMarkers(),
        autoplayVideo: shouldAutoplayVideo(),
    };
};

export default {
    prefersReducedMotion,
    getOptimalRefreshInterval,
    getSkeletonCount,
    shouldDisableHeavyFeatures,
    getOptimizedClasses,
    getBackdropClass,
    getTransitionClass,
    getShadowClass,
    getClockUpdateInterval,
    getSearchDebounceDelay,
    shouldUseSimplifiedMarkers,
    getMaxGridCameras,
    shouldAutoplayVideo,
    getImageLoadingStrategy,
    getPerformanceConfig,
};
