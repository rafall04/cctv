/**
 * Browser Codec Support Detection
 * 
 * Detects browser capabilities for H.264 and H.265 video codecs.
 * H.265 (HEVC) is only supported natively in Safari.
 */

/**
 * Detect browser type and codec support
 * @returns {Object} Browser codec support information
 */
export const detectBrowserCodecSupport = () => {
    const ua = navigator.userAgent;
    
    // Detect browser type
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isChrome = /chrome/i.test(ua) && !/edge/i.test(ua);
    const isFirefox = /firefox/i.test(ua);
    const isEdge = /edge/i.test(ua);
    
    // Determine browser name
    let browserName = 'Unknown';
    if (isSafari) browserName = 'Safari';
    else if (isChrome) browserName = 'Chrome';
    else if (isFirefox) browserName = 'Firefox';
    else if (isEdge) browserName = 'Edge';
    
    return {
        h264: true,        // All modern browsers support H.264
        h265: isSafari,    // Only Safari supports H.265 natively
        browserName,
        isSafari,
        isChrome,
        isFirefox,
        isEdge
    };
};

/**
 * Check if browser can play specific codec
 * @param {string} codec - 'h264' or 'h265'
 * @returns {boolean} True if codec is supported
 */
export const canPlayCodec = (codec) => {
    const support = detectBrowserCodecSupport();
    
    if (codec === 'h264') {
        return support.h264;
    } else if (codec === 'h265') {
        return support.h265;
    }
    
    return false;
};

/**
 * Get user-friendly codec name
 * @param {string} codec - 'h264' or 'h265'
 * @returns {string} Display name
 */
export const getCodecDisplayName = (codec) => {
    const names = {
        'h264': 'H.264/AVC',
        'h265': 'H.265/HEVC'
    };
    return names[codec] || codec.toUpperCase();
};

/**
 * Get codec compatibility message
 * @param {string} codec - 'h264' or 'h265'
 * @returns {string|null} Warning message or null if compatible
 */
export const getCodecWarning = (codec) => {
    if (codec === 'h265' && !canPlayCodec('h265')) {
        const support = detectBrowserCodecSupport();
        return `H.265 tidak didukung di ${support.browserName}. Gunakan Safari untuk hasil terbaik, atau pilih kamera dengan codec H.264.`;
    }
    return null;
};

/**
 * Get recommended browsers for codec
 * @param {string} codec - 'h264' or 'h265'
 * @returns {string[]} Array of recommended browser names
 */
export const getRecommendedBrowsers = (codec) => {
    if (codec === 'h264') {
        return ['Chrome', 'Firefox', 'Safari', 'Edge'];
    } else if (codec === 'h265') {
        return ['Safari'];
    }
    return [];
};
