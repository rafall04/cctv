/**
 * OrientationObserver Module
 * Handles device orientation changes without triggering stream reloads
 * 
 * **Validates: Requirements 7.4**
 */

/**
 * Get current screen orientation
 * @returns {'portrait' | 'landscape'} Current orientation
 */
export const getCurrentOrientation = () => {
    if (typeof window === 'undefined') return 'landscape';
    
    // Use Screen Orientation API if available
    if (typeof screen !== 'undefined' && screen.orientation) {
        return screen.orientation.type.includes('portrait') ? 'portrait' : 'landscape';
    }
    
    // Fallback to window dimensions
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
};

/**
 * Create an orientation change observer
 * @param {Object} options - Observer options
 * @param {Function} options.onOrientationChange - Callback when orientation changes
 * @param {boolean} options.debounceResize - Whether to debounce resize events (default: true)
 * @param {number} options.debounceDelay - Debounce delay in ms (default: 100)
 * @returns {Object} Observer with start, stop, and getOrientation methods
 */
export const createOrientationObserver = (options = {}) => {
    const {
        onOrientationChange = () => {},
        debounceResize = true,
        debounceDelay = 100,
    } = options;
    
    let currentOrientation = getCurrentOrientation();
    let resizeTimeout = null;
    let isObserving = false;
    
    /**
     * Handle orientation change event
     */
    const handleOrientationChange = () => {
        const newOrientation = getCurrentOrientation();
        
        if (newOrientation !== currentOrientation) {
            const previousOrientation = currentOrientation;
            currentOrientation = newOrientation;
            
            onOrientationChange({
                orientation: newOrientation,
                previousOrientation,
                isPortrait: newOrientation === 'portrait',
                isLandscape: newOrientation === 'landscape',
            });
        }
    };
    
    /**
     * Handle resize event with optional debouncing
     */
    const handleResize = () => {
        if (debounceResize) {
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
            }
            resizeTimeout = setTimeout(handleOrientationChange, debounceDelay);
        } else {
            handleOrientationChange();
        }
    };
    
    /**
     * Start observing orientation changes
     */
    const start = () => {
        if (isObserving || typeof window === 'undefined') return;
        
        isObserving = true;
        currentOrientation = getCurrentOrientation();
        
        // Use Screen Orientation API if available (more reliable)
        if (typeof screen !== 'undefined' && screen.orientation) {
            screen.orientation.addEventListener('change', handleOrientationChange);
        }
        
        // Also listen to resize as fallback and for browsers without orientation API
        window.addEventListener('resize', handleResize);
        
        // Listen to orientationchange event (older mobile browsers)
        window.addEventListener('orientationchange', handleOrientationChange);
    };
    
    /**
     * Stop observing orientation changes
     */
    const stop = () => {
        if (!isObserving || typeof window === 'undefined') return;
        
        isObserving = false;
        
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
            resizeTimeout = null;
        }
        
        if (typeof screen !== 'undefined' && screen.orientation) {
            screen.orientation.removeEventListener('change', handleOrientationChange);
        }
        
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleOrientationChange);
    };
    
    /**
     * Get current orientation
     * @returns {'portrait' | 'landscape'} Current orientation
     */
    const getOrientation = () => currentOrientation;
    
    /**
     * Check if currently observing
     * @returns {boolean} True if observing
     */
    const isActive = () => isObserving;
    
    return {
        start,
        stop,
        getOrientation,
        isActive,
    };
};

/**
 * React hook for orientation changes
 * @param {Function} callback - Called when orientation changes
 * @returns {Object} Current orientation state
 */
export const useOrientationObserver = (callback) => {
    // This is a utility function signature for documentation
    // Actual React hook implementation would be in the component
    return {
        orientation: getCurrentOrientation(),
        isPortrait: getCurrentOrientation() === 'portrait',
        isLandscape: getCurrentOrientation() === 'landscape',
    };
};

export default {
    getCurrentOrientation,
    createOrientationObserver,
    useOrientationObserver,
};
