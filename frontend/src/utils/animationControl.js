/**
 * AnimationControl Module
 * Provides utilities for controlling animations based on:
 *   1. Device capability tier (existing) — low-end devices fall back to
 *      static replacements to keep the live CCTV playback smooth.
 *   2. User OS preference (`prefers-reduced-motion: reduce`) — respects
 *      the accessibility setting on Windows, macOS, iOS, Android, and
 *      every modern browser. Critical for users with vestibular
 *      disorders, attention-related conditions, or anyone who simply
 *      doesn't want pulse / spin / bounce while they're trying to read
 *      a live camera feed.
 *
 * IMPORTANT: this module ONLY governs decorative CSS animations
 * (animate-pulse, animate-spin, animate-bounce, ...). It does NOT touch
 * the `<video>` element's playback, the HLS.js segment fetch loop, or
 * the zoom / pan transforms in ZoomableVideo — those are functional, not
 * decorative, and stay on regardless of motion preference.
 *
 * **Validates: Requirements 5.2**
 */

import { useEffect, useState } from 'react';
import { detectDeviceTier } from './deviceDetector';

const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Synchronously check whether the current environment reports a
 * "reduce motion" OS-level preference. Safe to call during render or
 * outside React (e.g., utility functions that pick a class name).
 *
 * Returns false on SSR / older browsers where `window.matchMedia` is
 * undefined — we err on the side of "show animations" so we don't
 * silently strip motion from users who never asked for that.
 *
 * @returns {boolean} True when the user opted into reduced motion.
 */
export const prefersReducedMotion = () => {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia !== 'function') return false;
    try {
        return window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches === true;
    } catch {
        return false;
    }
};

/**
 * Check if animations should be disabled. Returns true if EITHER
 * condition applies:
 *   - Device is low-end (existing performance heuristic), OR
 *   - User opted into reduced motion (new accessibility heuristic).
 *
 * Existing callers that already wired this in (Skeleton, VideoPopup,
 * MultiViewVideoItem, landing components, ...) automatically pick up
 * the new motion preference without any further change at the call
 * site — the live CCTV view, snapshot toast, status pulse, loading
 * spinner, etc. all gracefully fall back to their static variants.
 *
 * @param {Object} options - Optional overrides for testing
 * @param {'low' | 'medium' | 'high'} options.tier - Device tier override
 * @param {boolean} options.reducedMotion - Force reduce-motion preference
 * @returns {boolean} True if animations should be disabled
 */
export const shouldDisableAnimations = (options = {}) => {
    const tier = options.tier ?? detectDeviceTier();
    const reduced = options.reducedMotion ?? prefersReducedMotion();
    return tier === 'low' || reduced === true;
};

/**
 * React hook that returns the current "reduce motion" preference AND
 * subscribes to OS-level changes. Components that want their UI to
 * react LIVE to the user toggling "Reduce motion" in OS settings while
 * the page is open should use this; everything else can stay on the
 * synchronous `shouldDisableAnimations()` because the preference
 * almost never changes mid-session in practice.
 *
 * @returns {boolean} Reactive reduced-motion state.
 */
export const useReducedMotion = () => {
    const [reduced, setReduced] = useState(() => prefersReducedMotion());

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        if (typeof window.matchMedia !== 'function') return undefined;

        const mediaQuery = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
        const onChange = () => setReduced(mediaQuery.matches === true);

        // Pick up an initial value in case the snapshot from useState's
        // initialiser was wrong (race during hydration).
        onChange();

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', onChange);
            return () => mediaQuery.removeEventListener('change', onChange);
        }
        // Safari < 14 fallback — addListener is deprecated but still
        // present in older WebKit. The public CCTV page sees enough
        // iOS-on-old-iPad traffic to make this worth keeping.
        mediaQuery.addListener(onChange);
        return () => mediaQuery.removeListener(onChange);
    }, []);

    return reduced;
};

/**
 * React hook combining the synchronous device-tier check with the
 * reactive OS-level motion preference. Use this when a component
 * wants a single "should I animate?" gate that flips live as the user
 * toggles their setting.
 *
 * Example:
 *   const disableAnimations = useAnimationGate();
 *   return <Spinner className={disableAnimations ? '' : 'animate-spin'} />;
 *
 * @returns {boolean} True when EITHER low-end device OR reduce-motion.
 */
export const useAnimationGate = () => {
    const reduced = useReducedMotion();
    // Device tier is pinned at boot — no need to subscribe to changes;
    // a tier flip would require a page reload anyway.
    const tier = detectDeviceTier();
    return tier === 'low' || reduced === true;
};

/**
 * Get animation class based on device tier + motion preference.
 * Returns the animation class if animations are enabled, empty string
 * otherwise.
 *
 * @param {string} animationClass - The animation class to conditionally apply
 * @param {Object} options - Optional overrides for testing
 * @returns {string} The animation class or empty string
 */
export const getAnimationClass = (animationClass, options = {}) => {
    const { forceDisable = false } = options;

    if (forceDisable) {
        return '';
    }

    const disable = shouldDisableAnimations(options);
    return disable ? '' : animationClass;
};

/**
 * Get multiple animation classes based on the same gate.
 *
 * @param {string[]} animationClasses - Array of animation classes
 * @param {Object} options - Optional overrides for testing
 * @returns {string} Space-separated animation classes or empty string
 */
export const getAnimationClasses = (animationClasses, options = {}) => {
    const disable = shouldDisableAnimations(options);
    return disable ? '' : animationClasses.join(' ');
};

/**
 * Get static loading indicator class for low-end / reduced-motion.
 * Returns a static class instead of the animated one when animations
 * are gated off.
 *
 * @param {string} animatedClass - The animated class (e.g., 'animate-spin')
 * @param {string} staticClass - The static fallback class (e.g., 'opacity-75')
 * @param {Object} options - Optional overrides for testing
 * @returns {string} Either the animated or static class
 */
export const getLoadingIndicatorClass = (animatedClass, staticClass = '', options = {}) => {
    const disable = shouldDisableAnimations(options);
    return disable ? staticClass : animatedClass;
};

/**
 * Animation class mappings for common loading states.
 * Each animation has both an animated variant (for capable devices /
 * default motion preference) and a static fallback (for low-end /
 * reduce-motion). The static variant is chosen to keep the SEMANTIC
 * indicator visible — a paused spinner still shows that something is
 * loading, just without the kinetic distraction.
 */
export const ANIMATION_MAPPINGS = {
    spin: {
        animated: 'animate-spin',
        static: '', // No animation, just static — paused spinner still reads as "loading"
    },
    pulse: {
        animated: 'animate-pulse',
        static: 'opacity-75', // Static opacity instead of pulsing — keeps element visible
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
        static: '', // No shimmer effect — skeleton stays a flat grey block
    },
};

/**
 * Get the appropriate animation or static class based on the gate.
 *
 * @param {'spin' | 'pulse' | 'bounce' | 'ping' | 'shimmer'} animationType - Type of animation
 * @param {Object} options - Optional overrides for testing
 * @returns {string} The appropriate class for the device tier + motion preference
 */
export const getAdaptiveAnimationClass = (animationType, options = {}) => {
    const mapping = ANIMATION_MAPPINGS[animationType];
    if (!mapping) {
        return '';
    }

    const disable = shouldDisableAnimations(options);
    return disable ? mapping.static : mapping.animated;
};

/**
 * Create a gated animation config object.
 * Useful for components that need multiple animation states.
 *
 * @param {Object} options - Optional overrides for testing
 * @returns {Object} Animation configuration object
 */
export const createAnimationConfig = (options = {}) => {
    const disable = shouldDisableAnimations(options);

    return {
        disableAnimations: disable,
        spin: disable ? '' : 'animate-spin',
        pulse: disable ? 'opacity-75' : 'animate-pulse',
        bounce: disable ? '' : 'animate-bounce',
        ping: disable ? '' : 'animate-ping',
        shimmer: disable ? '' : 'animate-[shimmer_2s_infinite]',
    };
};

export default {
    prefersReducedMotion,
    shouldDisableAnimations,
    useReducedMotion,
    useAnimationGate,
    getAnimationClass,
    getAnimationClasses,
    getLoadingIndicatorClass,
    getAdaptiveAnimationClass,
    createAnimationConfig,
    ANIMATION_MAPPINGS,
};
