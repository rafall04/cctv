/**
 * DeviceDetector Module
 * Detects device capabilities and determines optimal configuration tier
 * 
 * Device Tiers:
 * - low: RAM ≤ 2GB OR CPU cores ≤ 2 OR mobile with RAM ≤ 3GB
 * - medium: Default tier for most devices
 * - high: RAM > 4GB AND CPU cores > 4
 * 
 * Mobile-Specific Detection:
 * - Detects mobile device type (phone, tablet)
 * - Detects touch capability
 * - Provides mobile-optimized configuration recommendations
 * 
 * **Validates: Requirements 7.1, 7.2**
 */

/**
 * Get device RAM in GB
 * @returns {number} RAM in GB (defaults to 4 if not available)
 */
export const getDeviceRAM = () => {
    if (typeof navigator !== 'undefined' && navigator.deviceMemory) {
        return navigator.deviceMemory;
    }
    return 4; // Default assumption
};

/**
 * Get CPU core count
 * @returns {number} Number of logical CPU cores (defaults to 4 if not available)
 */
export const getCPUCores = () => {
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
        return navigator.hardwareConcurrency;
    }
    return 4; // Default assumption
};

/**
 * Check if device is mobile
 * @returns {boolean} True if mobile device
 */
export const isMobileDevice = () => {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
    );
};

/**
 * Get mobile device type
 * @returns {'phone' | 'tablet' | 'desktop'} Device type
 */
export const getMobileDeviceType = () => {
    if (typeof navigator === 'undefined') return 'desktop';
    
    const ua = navigator.userAgent;
    
    // Check for tablets first (iPad, Android tablets)
    if (/iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
        return 'tablet';
    }
    
    // Check for phones
    if (/iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
        return 'phone';
    }
    
    return 'desktop';
};

/**
 * Check if device has touch capability
 * @returns {boolean} True if device supports touch
 */
export const hasTouchSupport = () => {
    if (typeof window === 'undefined') return false;
    
    return (
        'ontouchstart' in window ||
        (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
        (typeof navigator !== 'undefined' && navigator.msMaxTouchPoints > 0)
    );
};

/**
 * Get screen orientation
 * @returns {'portrait' | 'landscape'} Current screen orientation
 */
export const getScreenOrientation = () => {
    if (typeof window === 'undefined') return 'landscape';
    
    // Use Screen Orientation API if available
    if (typeof screen !== 'undefined' && screen.orientation) {
        return screen.orientation.type.includes('portrait') ? 'portrait' : 'landscape';
    }
    
    // Fallback to window dimensions
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
};

/**
 * Get screen dimensions
 * @returns {{ width: number, height: number }} Screen dimensions
 */
export const getScreenDimensions = () => {
    if (typeof window === 'undefined') {
        return { width: 1920, height: 1080 };
    }
    
    return {
        width: window.innerWidth || document.documentElement.clientWidth || 1920,
        height: window.innerHeight || document.documentElement.clientHeight || 1080,
    };
};

/**
 * Check if device is a low-end mobile device
 * @param {Object} options - Optional overrides for testing
 * @returns {boolean} True if low-end mobile
 */
export const isLowEndMobile = (options = {}) => {
    const ram = options.ram ?? getDeviceRAM();
    const cores = options.cores ?? getCPUCores();
    const mobile = options.isMobile ?? isMobileDevice();
    
    if (!mobile) return false;
    
    // Low-end mobile: RAM ≤ 3GB OR cores ≤ 2
    return ram <= 3 || cores <= 2;
};

/**
 * Check if device supports Web Workers
 * @returns {boolean} True if Web Workers are supported
 */
export const hasWebWorkerSupport = () => {
    return typeof Worker !== 'undefined';
};

/**
 * Get network connection type
 * @returns {'slow-2g' | '2g' | '3g' | '4g' | 'wifi' | 'unknown'} Connection type
 */
export const getConnectionType = () => {
    if (typeof navigator === 'undefined') return 'unknown';
    
    const connection = navigator.connection || 
                       navigator.mozConnection || 
                       navigator.webkitConnection;
    
    if (!connection) return 'unknown';
    
    const effectiveType = connection.effectiveType;
    if (effectiveType) {
        return effectiveType;
    }
    
    // Fallback based on connection type
    const type = connection.type;
    if (type === 'wifi' || type === 'ethernet') return 'wifi';
    if (type === 'cellular') return '4g';
    
    return 'unknown';
};

/**
 * Detect device tier based on hardware capabilities
 * @param {Object} options - Optional overrides for testing
 * @param {number} options.ram - RAM in GB
 * @param {number} options.cores - CPU cores
 * @param {boolean} options.isMobile - Is mobile device
 * @returns {'low' | 'medium' | 'high'} Device tier
 */
export const detectDeviceTier = (options = {}) => {
    const ram = options.ram ?? getDeviceRAM();
    const cores = options.cores ?? getCPUCores();
    const mobile = options.isMobile ?? isMobileDevice();
    
    // Low-end: RAM ≤ 2GB OR cores ≤ 2 OR mobile with RAM ≤ 3GB
    if (ram <= 2 || cores <= 2 || (mobile && ram <= 3)) {
        return 'low';
    }
    
    // High-end: RAM > 4GB AND cores > 4
    if (ram > 4 && cores > 4) {
        return 'high';
    }
    
    // Default: medium
    return 'medium';
};

/**
 * Get maximum concurrent streams based on device tier
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @returns {number} Maximum concurrent streams
 */
export const getMaxConcurrentStreams = (tier) => {
    switch (tier) {
        case 'low':
            return 2;
        case 'medium':
        case 'high':
            return 3;
        default:
            return 2;
    }
};

/**
 * Get full device capabilities object
 * @param {Object} options - Optional overrides for testing
 * @returns {Object} Device capabilities
 */
export const getDeviceCapabilities = (options = {}) => {
    const ram = options.ram ?? getDeviceRAM();
    const cores = options.cores ?? getCPUCores();
    const mobile = options.isMobile ?? isMobileDevice();
    const tier = detectDeviceTier({ ram, cores, isMobile: mobile });
    
    return {
        tier,
        ram,
        cpuCores: cores,
        isMobile: mobile,
        mobileDeviceType: getMobileDeviceType(),
        hasTouch: hasTouchSupport(),
        screenOrientation: getScreenOrientation(),
        screenDimensions: getScreenDimensions(),
        isLowEndMobile: isLowEndMobile({ ram, cores, isMobile: mobile }),
        hasWebWorker: hasWebWorkerSupport(),
        connectionType: getConnectionType(),
        maxConcurrentStreams: getMaxConcurrentStreams(tier),
    };
};

/**
 * Create a capability change observer
 * Monitors network changes and notifies callback
 * @param {Function} callback - Called when capabilities change
 * @returns {Function} Cleanup function
 */
export const observeCapabilityChanges = (callback) => {
    if (typeof navigator === 'undefined') {
        return () => {};
    }
    
    const connection = navigator.connection || 
                       navigator.mozConnection || 
                       navigator.webkitConnection;
    
    if (!connection) {
        return () => {};
    }
    
    const handleChange = () => {
        callback(getDeviceCapabilities());
    };
    
    connection.addEventListener('change', handleChange);
    
    return () => {
        connection.removeEventListener('change', handleChange);
    };
};

export default {
    detectDeviceTier,
    getDeviceCapabilities,
    getDeviceRAM,
    getCPUCores,
    isMobileDevice,
    getMobileDeviceType,
    hasTouchSupport,
    getScreenOrientation,
    getScreenDimensions,
    isLowEndMobile,
    hasWebWorkerSupport,
    getConnectionType,
    getMaxConcurrentStreams,
    observeCapabilityChanges,
};
