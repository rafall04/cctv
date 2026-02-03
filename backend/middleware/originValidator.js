/**
 * Origin Validation Middleware
 * 
 * Validates Origin and Referer headers against allowed domains.
 * Allows requests without Origin for non-browser clients (API keys, curl, etc.)
 * 
 * Requirements: 1.4, 1.5
 */

import { logSecurityEvent, SECURITY_EVENTS } from '../services/securityAuditLogger.js';
import { config } from '../config/config.js';

// Default allowed origins (can be overridden via config)
const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001'
];

/**
 * Get allowed origins from config or use defaults
 * @returns {string[]} - List of allowed origins
 */
export function getAllowedOrigins() {
    if (config.cors && config.cors.allowedOrigins) {
        return config.cors.allowedOrigins;
    }
    return DEFAULT_ALLOWED_ORIGINS;
}

/**
 * Check if an origin is allowed
 * @param {string} origin - Origin to check
 * @returns {boolean} - True if allowed
 */
export function isOriginAllowed(origin) {
    if (!origin) {
        return true; // Allow requests without Origin (non-browser clients)
    }
    
    const allowedOrigins = getAllowedOrigins();
    return allowedOrigins.includes(origin);
}

/**
 * Extract origin from Referer header as fallback
 * @param {string} referer - Referer header value
 * @returns {string|null} - Extracted origin or null
 */
export function extractOriginFromReferer(referer) {
    if (!referer) {
        return null;
    }
    
    try {
        const url = new URL(referer);
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
}

/**
 * Check if request appears to be from a browser
 * @param {object} request - Fastify request object
 * @returns {boolean} - True if request appears to be from a browser
 */
export function isBrowserRequest(request) {
    const userAgent = request.headers['user-agent'] || '';
    
    // Common browser user agent patterns
    const browserPatterns = [
        /Mozilla/i,
        /Chrome/i,
        /Safari/i,
        /Firefox/i,
        /Edge/i,
        /Opera/i,
        /MSIE/i,
        /Trident/i
    ];
    
    return browserPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Origin Validation Middleware Plugin
 */
export async function originValidatorMiddleware(fastify, _options) {
    // Skip origin validation for certain paths
    const skipPaths = [
        '/health',
        '/api/stream',  // Stream endpoints need to be accessible
        '/api/viewer',  // Viewer tracking endpoints
        '/hls'          // HLS proxy - public streaming endpoint
    ];
    
    fastify.addHook('onRequest', async (request, reply) => {
        // Skip validation for whitelisted paths
        const shouldSkip = skipPaths.some(path => request.url.startsWith(path));
        if (shouldSkip) {
            return;
        }
        
        const origin = request.headers['origin'];
        const referer = request.headers['referer'];
        
        // If no Origin header, check if it's a browser request
        if (!origin) {
            // For browser requests, try to use Referer as fallback
            if (isBrowserRequest(request) && referer) {
                const refererOrigin = extractOriginFromReferer(referer);
                
                if (refererOrigin && !isOriginAllowed(refererOrigin)) {
                    logSecurityEvent(SECURITY_EVENTS.ORIGIN_VALIDATION_FAILURE, {
                        reason: 'Invalid Referer origin',
                        referer,
                        refererOrigin,
                        allowedOrigins: getAllowedOrigins()
                    }, request);
                    
                    return reply.code(403).send({
                        success: false,
                        message: 'Forbidden - Invalid origin'
                    });
                }
            }
            
            // Allow non-browser requests without Origin (API clients, curl, etc.)
            return;
        }
        
        // Validate Origin header
        if (!isOriginAllowed(origin)) {
            logSecurityEvent(SECURITY_EVENTS.ORIGIN_VALIDATION_FAILURE, {
                reason: 'Invalid Origin header',
                origin,
                allowedOrigins: getAllowedOrigins()
            }, request);
            
            return reply.code(403).send({
                success: false,
                message: 'Forbidden - Invalid origin'
            });
        }
    });
}

// Export configuration for testing
export const ORIGIN_VALIDATOR_CONFIG = {
    DEFAULT_ALLOWED_ORIGINS
};
