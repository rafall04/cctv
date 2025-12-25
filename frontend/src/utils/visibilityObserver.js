/**
 * VisibilityObserver Module
 * Intersection Observer wrapper for detecting element visibility
 * Used for lazy loading and pausing off-screen video streams
 * 
 * **Validates: Requirements 4.1**
 */

/**
 * Create a visibility observer instance
 * @param {Object} options - Observer options
 * @param {number} options.threshold - Visibility threshold (0-1), default 0.1 (10%)
 * @param {string} options.rootMargin - Root margin for early detection
 * @returns {Object} Observer instance with observe/unobserve/disconnect methods
 */
export const createVisibilityObserver = (options = {}) => {
    const {
        threshold = 0.1,
        rootMargin = '50px',
    } = options;
    
    // Map to store callbacks for each observed element
    const callbacks = new Map();
    
    // Track visibility state for each element
    const visibilityState = new Map();
    
    // Create the Intersection Observer
    const observer = typeof IntersectionObserver !== 'undefined' 
        ? new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    const callback = callbacks.get(entry.target);
                    const wasVisible = visibilityState.get(entry.target) || false;
                    const isVisible = entry.isIntersecting;
                    
                    // Update state
                    visibilityState.set(entry.target, isVisible);
                    
                    // Only call callback if visibility changed
                    if (callback && wasVisible !== isVisible) {
                        callback(isVisible, entry);
                    }
                });
            },
            {
                threshold,
                rootMargin,
            }
        )
        : null;
    
    return {
        /**
         * Start observing an element
         * @param {HTMLElement} element - Element to observe
         * @param {Function} callback - Called when visibility changes: (isVisible, entry) => void
         */
        observe: (element, callback) => {
            if (!element || !observer) return;
            
            callbacks.set(element, callback);
            visibilityState.set(element, false);
            observer.observe(element);
        },
        
        /**
         * Stop observing an element
         * @param {HTMLElement} element - Element to stop observing
         */
        unobserve: (element) => {
            if (!element || !observer) return;
            
            callbacks.delete(element);
            visibilityState.delete(element);
            observer.unobserve(element);
        },
        
        /**
         * Disconnect observer and clean up all observations
         */
        disconnect: () => {
            if (!observer) return;
            
            callbacks.clear();
            visibilityState.clear();
            observer.disconnect();
        },
        
        /**
         * Check if an element is currently being observed
         * @param {HTMLElement} element - Element to check
         * @returns {boolean} Whether element is being observed
         */
        isObserving: (element) => {
            return callbacks.has(element);
        },
        
        /**
         * Get current visibility state of an element
         * @param {HTMLElement} element - Element to check
         * @returns {boolean} Current visibility state
         */
        getVisibility: (element) => {
            return visibilityState.get(element) || false;
        },
        
        /**
         * Get count of observed elements
         * @returns {number} Number of observed elements
         */
        getObservedCount: () => {
            return callbacks.size;
        },
    };
};

/**
 * Create a singleton visibility observer for shared use
 * Useful when multiple components need to share the same observer
 */
let sharedObserver = null;

export const getSharedVisibilityObserver = (options = {}) => {
    if (!sharedObserver) {
        sharedObserver = createVisibilityObserver(options);
    }
    return sharedObserver;
};

/**
 * Reset the shared observer (useful for testing)
 */
export const resetSharedObserver = () => {
    if (sharedObserver) {
        sharedObserver.disconnect();
        sharedObserver = null;
    }
};

export default {
    createVisibilityObserver,
    getSharedVisibilityObserver,
    resetSharedObserver,
};
