/**
 * AnimationControl Module
 * Provides utilities for controlling animations based on device capabilities
 * 
 * On low-end devices, animations are disabled to improve performance and reduce
 * CPU/GPU usage during loading states.
 * 
 * **Validates: Requirements 5.2**
 */

import { detectDeviceTier } from './deviceDetector';

/**
 * Check if animations should be disabled based on device tier
 * @param {Object} options - Optional overrides for testing
 * @param {'low' | 'medium' | 'high'} options.tier - Device tier override
 * @returns {boolean} True if animations should be disabled
 */
export const shouldDisableAnimations = (options = {}) => {
    const tier = options.tier ?? detectDeviceTier();
    return tier === 'low';
};

/**
 * Get animation class based on device tier
 * Returns the animation class if animations are enabled, empty string otherwise
 * 
 * @param {string} animationClass - The animation class to conditionally apply (e.g., 'animate-spin', 'animate-pulse')
 * @param {Object} options - Optional overrides for testing
 * @param {'low' | 'medium' | 'high'} options.tier - Device tier override
 * @param {boolean} options.forceDisable - Force disable animations regardless of tier
 * @returns {string} The animation class or empty string
 */
export const getAnimationClass = (animationClass, options = {}) => {
    const { tier, forceDisable = false } = options;
    
    if (forceDisable) {
        return '';
    }
    
    const disableAnimations = shouldDisableAnimations({ tier });
    return disableAnimations ? '' : animationClass;
};

/**
 * Get multiple animation classes based on device tier
 * Returns the animation classes if animations are enabled, empty string otherwise
 * 
 * @param {string[]} animationClasses - Array of animation classes to conditionally apply
 * @param {Object} options - Optional overrides for testing
 * @returns {string} Space-separated animation classes or empty string
 */
export const getAnimationClasses = (animationClasses, options = {}) => {
    const disableAnimations = shouldDisableAnimations(options);
    return disableAnimations ? '' : animationClasses.join(' ');
};

/**
 * Get static loading indicator class for low-end devices
 * Returns a static class instead of animated one for low-end devices
 * 
 * @param {string} animatedClass - The animated class (e.g., 'animate-spin')
 * @param {string} staticClass - The static fallback class (e.g., 'opacity-75')
 * @param {Object} options - Optional overrides for testing
 * @returns {string} Either the animated or static class
 */
export const getLoadingIndicatorClass = (animatedClass, staticClass = '', options = {}) => {
    const disableAnimations = shouldDisableAnimations(options);
    return disableAnimations ? staticClass : animatedClass;
};

/**
 * Animation class mappings for common loading states
 * Provides static alternatives for low-end devices
 */
export const ANIMATION_MAPPINGS = {
    spin: {
        animated: 'animate-spin',
        static: '', // No animation, just static
    },
    pulse: {
        animated: 'animate-pulse',
        static: 'opacity-75', // Static opacity instead of pulsing
    },
    bounce: {
        animated: 'animate-bounce',
        static: '', // No animation
    },
    ping: {
        animated: 'animate-ping',
        static: '', // No animation
    },
    shimmer: {
        animated: 'animate-[shimmer_2s_infinite]',
        static: '', // No shimmer effect
    },
};

/**
 * Get the appropriate animation or static class based on device tier
 * 
 * @param {'spin' | 'pulse' | 'bounce' | 'ping' | 'shimmer'} animationType - Type of animation
 * @param {Object} options - Optional overrides for testing
 * @returns {string} The appropriate class for the device tier
 */
export const getAdaptiveAnimationClass = (animationType, options = {}) => {
    const mapping = ANIMATION_MAPPINGS[animationType];
    if (!mapping) {
        return '';
    }
    
    const disableAnimations = shouldDisableAnimations(options);
    return disableAnimations ? mapping.static : mapping.animated;
};

/**
 * Create a device-aware animation config object
 * Useful for components that need multiple animation states
 * 
 * @param {Object} options - Optional overrides for testing
 * @returns {Object} Animation configuration object
 */
export const createAnimationConfig = (options = {}) => {
    const disableAnimations = shouldDisableAnimations(options);
    
    return {
        disableAnimations,
        spin: disableAnimations ? '' : 'animate-spin',
        pulse: disableAnimations ? 'opacity-75' : 'animate-pulse',
        bounce: disableAnimations ? '' : 'animate-bounce',
        ping: disableAnimations ? '' : 'animate-ping',
        shimmer: disableAnimations ? '' : 'animate-[shimmer_2s_infinite]',
    };
};

export default {
    shouldDisableAnimations,
    getAnimationClass,
    getAnimationClasses,
    getLoadingIndicatorClass,
    getAdaptiveAnimationClass,
    createAnimationConfig,
    ANIMATION_MAPPINGS,
};
