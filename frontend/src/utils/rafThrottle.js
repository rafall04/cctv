/**
 * RAF Throttle Utility
 * 
 * Provides requestAnimationFrame-based throttling for high-frequency events
 * like zoom/pan operations. Ensures maximum 60fps (16.67ms minimum interval).
 * 
 * @module rafThrottle
 */

/**
 * Creates a RAF-throttled version of a callback function.
 * The callback will be called at most once per animation frame (~60fps).
 * 
 * @param {Function} callback - The function to throttle
 * @returns {Object} Object with throttled function and cancel method
 * 
 * @example
 * const { throttled, cancel } = createRAFThrottle((x, y) => {
 *     element.style.transform = `translate(${x}px, ${y}px)`;
 * });
 * 
 * element.addEventListener('mousemove', (e) => throttled(e.clientX, e.clientY));
 * // On cleanup: cancel();
 */
export function createRAFThrottle(callback) {
    let rafId = null;
    let lastArgs = null;
    let lastCallTime = 0;
    
    const MIN_INTERVAL = 16.67; // ~60fps
    
    const throttled = (...args) => {
        lastArgs = args;
        
        // If already scheduled, just update args
        if (rafId !== null) {
            return;
        }
        
        const now = performance.now();
        const timeSinceLastCall = now - lastCallTime;
        
        // If enough time has passed, execute immediately
        if (timeSinceLastCall >= MIN_INTERVAL) {
            lastCallTime = now;
            callback(...lastArgs);
            lastArgs = null;
            return;
        }
        
        // Schedule for next frame
        rafId = requestAnimationFrame(() => {
            rafId = null;
            lastCallTime = performance.now();
            if (lastArgs !== null) {
                callback(...lastArgs);
                lastArgs = null;
            }
        });
    };
    
    const cancel = () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        lastArgs = null;
    };
    
    return { throttled, cancel };
}

/**
 * Creates a RAF-throttled transform updater for zoom/pan operations.
 * Optimized specifically for CSS transform updates.
 * 
 * @param {HTMLElement} element - The element to apply transforms to
 * @returns {Object} Object with update and cancel methods
 * 
 * @example
 * const transformer = createTransformThrottle(wrapperElement);
 * transformer.update(2, 10, -5); // scale=2, panX=10%, panY=-5%
 * // On cleanup: transformer.cancel();
 */
export function createTransformThrottle(element) {
    let rafId = null;
    let pendingTransform = null;
    let lastUpdateTime = 0;
    
    const MIN_INTERVAL = 16.67; // ~60fps
    
    const applyTransform = () => {
        if (element && pendingTransform) {
            const { scale, panX, panY } = pendingTransform;
            element.style.transform = `scale(${scale}) translate(${panX}%, ${panY}%)`;
            pendingTransform = null;
        }
        rafId = null;
    };
    
    const update = (scale, panX, panY) => {
        pendingTransform = { scale, panX, panY };
        
        // If already scheduled, just update pending transform
        if (rafId !== null) {
            return;
        }
        
        const now = performance.now();
        const timeSinceLastUpdate = now - lastUpdateTime;
        
        // If enough time has passed, apply immediately
        if (timeSinceLastUpdate >= MIN_INTERVAL) {
            lastUpdateTime = now;
            applyTransform();
            return;
        }
        
        // Schedule for next frame
        rafId = requestAnimationFrame(() => {
            lastUpdateTime = performance.now();
            applyTransform();
        });
    };
    
    const cancel = () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        pendingTransform = null;
    };
    
    return { update, cancel };
}

/**
 * Measures the actual update rate of a throttled function.
 * Useful for testing that throttling is working correctly.
 * 
 * @param {number} windowMs - Time window to measure over (default 1000ms)
 * @returns {Object} Object with record and getRate methods
 * 
 * @example
 * const meter = createUpdateRateMeter();
 * // Call meter.record() each time an update happens
 * // After some time: meter.getRate() returns updates per second
 */
export function createUpdateRateMeter(windowMs = 1000) {
    const timestamps = [];
    
    const record = () => {
        const now = performance.now();
        timestamps.push(now);
        
        // Remove timestamps outside the window
        const cutoff = now - windowMs;
        while (timestamps.length > 0 && timestamps[0] < cutoff) {
            timestamps.shift();
        }
    };
    
    const getRate = () => {
        if (timestamps.length < 2) return 0;
        
        const now = performance.now();
        const cutoff = now - windowMs;
        const recentTimestamps = timestamps.filter(t => t >= cutoff);
        
        if (recentTimestamps.length < 2) return 0;
        
        // Calculate rate based on actual time span
        const timeSpan = recentTimestamps[recentTimestamps.length - 1] - recentTimestamps[0];
        if (timeSpan === 0) return 0;
        
        return ((recentTimestamps.length - 1) / timeSpan) * 1000; // Updates per second
    };
    
    const reset = () => {
        timestamps.length = 0;
    };
    
    const getCount = () => timestamps.length;
    
    return { record, getRate, reset, getCount };
}

/**
 * Constants for throttling configuration
 */
export const THROTTLE_CONFIG = {
    MIN_INTERVAL_MS: 16.67,  // ~60fps
    MAX_FPS: 60,
    TARGET_FRAME_TIME: 1000 / 60  // 16.67ms
};
