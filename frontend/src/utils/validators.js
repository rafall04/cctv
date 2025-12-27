/**
 * Validators Module
 * 
 * Contains validation functions for various input types including RTSP URLs.
 * 
 * Requirements: 4.3
 */

/**
 * RTSP URL validation pattern
 * Matches: rtsp://[user:pass@]host[:port][/path]
 */
const RTSP_URL_PATTERN = /^rtsp:\/\/([^:@\/]+:[^:@\/]+@)?([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(:\d{1,5})?(\/.*)?$/;

/**
 * Simple RTSP URL pattern for basic validation
 * Matches: rtsp://host (with optional port and path)
 */
const RTSP_URL_SIMPLE_PATTERN = /^rtsp:\/\/[^\s]+$/;

/**
 * Validate an RTSP URL
 * 
 * @param {string} url - The URL to validate
 * @returns {{ isValid: boolean, error: string }} Validation result
 * 
 * Requirements: 4.3
 * - Validate rtsp:// protocol
 * - Validate host portion
 * - Return appropriate error messages
 */
export function validateRtspUrl(url) {
    // Handle empty/null/undefined
    if (url === null || url === undefined || url === '') {
        return {
            isValid: false,
            error: 'RTSP URL is required'
        };
    }

    // Convert to string and trim
    const trimmedUrl = String(url).trim();

    // Check if empty after trim
    if (trimmedUrl === '') {
        return {
            isValid: false,
            error: 'RTSP URL is required'
        };
    }

    // Check for rtsp:// protocol
    if (!trimmedUrl.toLowerCase().startsWith('rtsp://')) {
        return {
            isValid: false,
            error: 'URL must start with rtsp://'
        };
    }

    // Check if there's content after rtsp://
    const afterProtocol = trimmedUrl.substring(7);
    if (afterProtocol === '' || afterProtocol.trim() === '') {
        return {
            isValid: false,
            error: 'RTSP URL must include a host'
        };
    }

    // Parse the URL to extract components
    let remaining = afterProtocol;
    let host = '';

    // Check for credentials (user:pass@)
    const atIndex = remaining.indexOf('@');
    if (atIndex !== -1) {
        const credentials = remaining.substring(0, atIndex);
        // Credentials should have format user:pass
        if (!credentials.includes(':')) {
            return {
                isValid: false,
                error: 'Invalid credentials format'
            };
        }
        remaining = remaining.substring(atIndex + 1);
    }

    // Now remaining should be host[:port][/path]
    if (remaining === '' || remaining.trim() === '') {
        return {
            isValid: false,
            error: 'RTSP URL must include a host'
        };
    }

    // Extract host (everything before : or /)
    const colonIndex = remaining.indexOf(':');
    const slashIndex = remaining.indexOf('/');

    if (colonIndex === -1 && slashIndex === -1) {
        // No port or path, entire remaining is host
        host = remaining;
    } else if (colonIndex === -1) {
        // No port, but has path
        host = remaining.substring(0, slashIndex);
    } else if (slashIndex === -1) {
        // Has port, no path
        host = remaining.substring(0, colonIndex);
    } else {
        // Has both - take the earlier delimiter
        const delimiter = Math.min(colonIndex, slashIndex);
        host = remaining.substring(0, delimiter);
    }

    // Validate host is not empty
    if (host === '' || host.trim() === '') {
        return {
            isValid: false,
            error: 'RTSP URL must include a valid host'
        };
    }

    // Check for invalid characters in host
    if (/[\s<>{}|\\^`\[\]]/.test(host)) {
        return {
            isValid: false,
            error: 'Host contains invalid characters'
        };
    }

    // Validate port if present (after host, before path)
    if (colonIndex !== -1) {
        const afterHost = remaining.substring(colonIndex + 1);
        const portMatch = afterHost.match(/^(\d+)/);
        if (portMatch) {
            const port = parseInt(portMatch[1], 10);
            if (port < 1 || port > 65535) {
                return {
                    isValid: false,
                    error: 'Port must be between 1 and 65535'
                };
            }
        }
    }

    // URL is valid
    return {
        isValid: true,
        error: ''
    };
}

/**
 * Create a validation rule for RTSP URLs compatible with useFormValidation
 * 
 * @param {Object} options - Validation options
 * @param {boolean} [options.required=true] - Whether the field is required
 * @param {string} [options.requiredMessage] - Custom required message
 * @returns {Object} Validation rule object
 */
export function createRtspValidationRule(options = {}) {
    const { required = true, requiredMessage = 'RTSP URL is required' } = options;

    return {
        required: required ? requiredMessage : false,
        custom: (value) => {
            // Skip validation if empty and not required
            if (!required && (!value || value.trim() === '')) {
                return undefined;
            }

            const result = validateRtspUrl(value);
            return result.isValid ? undefined : result.error;
        }
    };
}

/**
 * Check if a string is a valid RTSP URL (simple boolean check)
 * 
 * @param {string} url - The URL to check
 * @returns {boolean} True if valid RTSP URL
 */
export function isValidRtspUrl(url) {
    return validateRtspUrl(url).isValid;
}

/**
 * Get RTSP URL format hint for display
 * 
 * @returns {string} Format hint string
 */
export function getRtspFormatHint() {
    return 'Format: rtsp://[user:pass@]host[:port][/path]';
}

export default {
    validateRtspUrl,
    createRtspValidationRule,
    isValidRtspUrl,
    getRtspFormatHint
};
