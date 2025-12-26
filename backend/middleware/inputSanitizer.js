/**
 * Input Sanitizer Middleware
 * 
 * Provides XSS prevention, Content-Type validation, request body size limiting,
 * and unknown field stripping.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7
 */

import { logSecurityEvent, SECURITY_EVENTS } from '../services/securityAuditLogger.js';

// Maximum request body size (1MB)
const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB in bytes

// Allowed content types for requests with body
const ALLOWED_CONTENT_TYPES = [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data'
];

/**
 * Sanitize a string to prevent XSS attacks
 * Escapes HTML special characters
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
export function sanitizeString(str) {
    if (typeof str !== 'string') {
        return str;
    }
    
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .replace(/`/g, '&#x60;')
        .replace(/=/g, '&#x3D;');
}

/**
 * Recursively sanitize all string values in an object
 * @param {any} obj - Object to sanitize
 * @param {number} depth - Current recursion depth
 * @param {number} maxDepth - Maximum recursion depth
 * @returns {any} - Sanitized object
 */
export function sanitizeObject(obj, depth = 0, maxDepth = 10) {
    // Prevent infinite recursion
    if (depth > maxDepth) {
        return obj;
    }
    
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (typeof obj === 'string') {
        return sanitizeString(obj);
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, depth + 1, maxDepth));
    }
    
    if (typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            // Also sanitize keys
            const sanitizedKey = sanitizeString(key);
            sanitized[sanitizedKey] = sanitizeObject(value, depth + 1, maxDepth);
        }
        return sanitized;
    }
    
    return obj;
}

/**
 * Strip unknown fields from request body based on allowed fields
 * @param {object} body - Request body
 * @param {string[]} allowedFields - List of allowed field names
 * @returns {object} - Body with only allowed fields
 */
export function stripUnknownFields(body, allowedFields) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return body;
    }
    
    const stripped = {};
    for (const field of allowedFields) {
        if (body.hasOwnProperty(field)) {
            stripped[field] = body[field];
        }
    }
    return stripped;
}

/**
 * Validate Content-Type header
 * @param {string} contentType - Content-Type header value
 * @returns {boolean} - True if valid
 */
export function isValidContentType(contentType) {
    if (!contentType) {
        return false;
    }
    
    // Extract the main content type (ignore charset and other parameters)
    const mainType = contentType.split(';')[0].trim().toLowerCase();
    
    return ALLOWED_CONTENT_TYPES.some(allowed => mainType === allowed);
}

/**
 * Sanitize URL parameters
 * @param {object} params - URL parameters object
 * @returns {object} - Sanitized parameters
 */
export function sanitizeUrlParams(params) {
    if (!params || typeof params !== 'object') {
        return params;
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(params)) {
        const sanitizedKey = sanitizeString(key);
        if (typeof value === 'string') {
            sanitized[sanitizedKey] = sanitizeString(value);
        } else {
            sanitized[sanitizedKey] = value;
        }
    }
    return sanitized;
}

/**
 * Sanitize query parameters
 * @param {object} query - Query parameters object
 * @returns {object} - Sanitized query parameters
 */
export function sanitizeQueryParams(query) {
    return sanitizeUrlParams(query);
}

/**
 * Input Sanitizer Middleware Plugin
 */
export async function inputSanitizerMiddleware(fastify, _options) {
    // Add body size limit hook
    fastify.addHook('onRequest', async (request, reply) => {
        const contentLength = parseInt(request.headers['content-length'] || '0', 10);
        
        if (contentLength > MAX_BODY_SIZE) {
            logSecurityEvent(SECURITY_EVENTS.VALIDATION_FAILURE, {
                reason: 'Request body too large',
                contentLength,
                maxSize: MAX_BODY_SIZE,
                endpoint: request.url,
                method: request.method
            }, request);
            
            return reply.code(413).send({
                success: false,
                message: 'Request body too large. Maximum size is 1MB.'
            });
        }
    });
    
    // Add Content-Type validation hook for requests with body
    fastify.addHook('preValidation', async (request, reply) => {
        const methodsWithBody = ['POST', 'PUT', 'PATCH'];
        
        if (methodsWithBody.includes(request.method)) {
            const contentType = request.headers['content-type'];
            const contentLength = parseInt(request.headers['content-length'] || '0', 10);
            
            // Only validate Content-Type if there's actually a body
            if (contentLength > 0 && !isValidContentType(contentType)) {
                logSecurityEvent(SECURITY_EVENTS.VALIDATION_FAILURE, {
                    reason: 'Invalid Content-Type',
                    contentType: contentType || 'missing',
                    endpoint: request.url,
                    method: request.method
                }, request);
                
                return reply.code(415).send({
                    success: false,
                    message: 'Unsupported Media Type. Expected application/json.'
                });
            }
        }
    });
    
    // Add sanitization hook
    fastify.addHook('preHandler', async (request, reply) => {
        // Sanitize request body
        if (request.body && typeof request.body === 'object') {
            request.body = sanitizeObject(request.body);
        }
        
        // Sanitize URL parameters
        if (request.params && typeof request.params === 'object') {
            request.params = sanitizeUrlParams(request.params);
        }
        
        // Sanitize query parameters
        if (request.query && typeof request.query === 'object') {
            request.query = sanitizeQueryParams(request.query);
        }
    });
}

// Export constants for testing
export const INPUT_SANITIZER_CONFIG = {
    MAX_BODY_SIZE,
    ALLOWED_CONTENT_TYPES
};
