/**
 * Browser Codec Support Detection
 * 
 * Detects browser capabilities for H.264 and H.265 video codecs.
 * H.265 (HEVC) support varies by browser and device hardware.
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
    
    // H.265 support detection
    // Safari: Full native support
    // Chrome/Edge: Depends on hardware decoder (not guaranteed)
    // Firefox: No support
    const h265Support = isSafari ? 'full' : (isChrome || isEdge) ? 'partial' : 'none';
    
    return {
        h264: true,        // All modern browsers support H.264
        h265: h265Support, // 'full', 'partial', or 'none'
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
 * @returns {boolean|string} True if fully supported, 'partial' if depends on hardware, false if not supported
 */
export const canPlayCodec = (codec) => {
    const support = detectBrowserCodecSupport();
    
    if (codec === 'h264') {
        return true; // All browsers support H.264
    } else if (codec === 'h265') {
        return support.h265; // Returns 'full', 'partial', or 'none'
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
 * @returns {Object|null} Warning object with message and severity, or null if compatible
 */
export const getCodecWarning = (codec) => {
    if (codec === 'h265') {
        const support = canPlayCodec('h265');
        const browserInfo = detectBrowserCodecSupport();
        
        if (support === 'none') {
            return {
                severity: 'error',
                message: `H.265 tidak didukung di ${browserInfo.browserName}. Video mungkin tidak dapat diputar. Gunakan Safari untuk hasil terbaik.`,
                shortMessage: 'Tidak didukung'
            };
        } else if (support === 'partial') {
            return {
                severity: 'warning',
                message: `H.265 di ${browserInfo.browserName} tergantung hardware device. Jika video tidak muncul, gunakan Safari atau pilih kamera dengan codec H.264.`,
                shortMessage: 'Tergantung hardware'
            };
        }
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
        return ['Safari (terbaik)', 'Chrome/Edge (tergantung hardware)'];
    }
    return [];
};

/**
 * Get codec description for users
 * @param {string} codec - 'h264' or 'h265'
 * @returns {string} User-friendly description
 */
export const getCodecDescription = (codec) => {
    const descriptions = {
        'h264': 'Codec universal yang didukung semua browser dan device',
        'h265': 'Codec efisien bandwidth, tapi support terbatas (Safari full support, Chrome/Edge tergantung hardware)'
    };
    return descriptions[codec] || '';
};
