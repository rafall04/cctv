/**
 * Browser Codec Support Detection
 * 
 * Detects browser capabilities for H.264 and H.265 video codecs.
 * H.265 (HEVC) support varies by browser and device hardware.
 */

/*
 * A codec string the browser can be asked about directly. HEVC support is a HARDWARE question on
 * every desktop and Android device, so the User-Agent cannot answer it — Chrome on one phone plays
 * this and on the next phone does not. `MediaSource.isTypeSupported` asks the decoder itself.
 *
 * hvc1 is what MediaMTX advertises in production (`CODECS="hvc1.1.6.L150.0"`); hev1 is the other
 * legal fourcc for the same codec and some builds accept only one of the two, so a level is
 * playable if EITHER answers yes.
 */
const HEVC_PROBES = ['video/mp4;codecs="hvc1.1.6.L93.B0"', 'video/mp4;codecs="hev1.1.6.L93.B0"'];

/**
 * Ask the media stack whether it can decode a codec string, rather than guessing from the UA.
 *
 * @param {string} codecString full MIME+codecs string, e.g. 'video/mp4;codecs="hvc1.1.6.L150.0"'
 * @returns {boolean|null} null when the question cannot be asked (no MSE, e.g. SSR or old iOS)
 */
export const isCodecStringPlayable = (codecString) => {
    if (!codecString) return null;
    const MS = typeof window !== 'undefined'
        ? (window.ManagedMediaSource || window.MediaSource)
        : null;
    if (!MS || typeof MS.isTypeSupported !== 'function') return null;
    try {
        return MS.isTypeSupported(codecString);
    } catch {
        return null;
    }
};

/**
 * Can this device decode H.265/HEVC at all?
 * @returns {boolean|null} null when undeterminable — callers must treat that as "do not block".
 */
export const isHevcPlayable = () => {
    const answers = HEVC_PROBES.map(isCodecStringPlayable);
    if (answers.every((a) => a === null)) return null;
    return answers.some((a) => a === true);
};

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
    
    /*
     * ASK, then fall back to guessing. The UA-only version answered "partial" for every Chrome on
     * earth, which is why the landing card could only ever say "tergantung hardware device" — a
     * shrug, on a question the browser answers definitively. Only when the media stack cannot be
     * queried at all (no MSE) do we drop back to the old heuristic.
     */
    const measured = isHevcPlayable();
    const h265Support = measured === null
        ? (isSafari ? 'full' : (isChrome || isEdge) ? 'partial' : 'none')
        : (measured ? 'full' : 'none');
    
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

/*
 * A veto asked BEFORE any bytes move: "is this camera provably unplayable on this device?"
 *
 * True only when EVERY layer agrees, because a wrong veto breaks a working stream:
 *   - the camera encodes H.265 (callers pass video_codec verbatim)
 *   - the stream is NOT external — the field describes the camera's own encoder, and an
 *     external provider may transcode upstream, so external_* delivery can never be vetoed on it
 *   - MSE answers "no" to hvc1 AND the native <video> element also shrugs — Safari plays HEVC
 *     through its native path where MSE is silent, so a non-empty canPlayType is the escape hatch.
 *     A null answer anywhere (no MSE to ask) means "cannot prove" — and an unproven veto is just
 *     a new way to break playback, so it never fires.
 *
 * Effect: on a definite "no" the player skips the fetch/decode attempt entirely and shows the
 * codec panel instantly — instead of pulling the playlist, waking an on-demand source on the
 * server, and reaching the identical verdict only after the watchdog timeout.
 */
export const isGuaranteedUnplayableHevc = ({ videoCodec, isExternal = false } = {}) => {
    if (isExternal || videoCodec !== 'h265') return false;
    if (isHevcPlayable() !== false) return false;
    if (typeof document === 'undefined') return false;
    try {
        const v = document.createElement('video');
        if (v?.canPlayType?.('video/mp4;codecs="hvc1.1.6.L93.B0"')) return false;
    } catch {
        return false;
    }
    return true;
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
