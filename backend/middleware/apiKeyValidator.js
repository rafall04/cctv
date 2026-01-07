/**
 * API Key Validation Middleware
 * 
 * Validates X-API-Key header on incoming requests.
 * Rejects requests with missing or invalid keys with 403 Forbidden.
 * Logs validation failures for security monitoring.
 * 
 * Requirements: 1.1, 1.2, 1.3
 */

import { validateApiKey, API_KEY_CONFIG, hasActiveApiKeys } from '../services/apiKeyService.js';
import { logApiKeyFailure } from '../services/securityAuditLogger.js';

/**
 * Configuration for API key validation
 */
export const API_KEY_VALIDATOR_CONFIG = {
    headerName: API_KEY_CONFIG.headerName,
    // Endpoints that don't require API key validation
    publicEndpoints: [
        '/health',
        '/api/auth/login',
        '/api/cameras/active',
        '/api/stream',
        '/api/areas/public',
        '/api/viewer/start',
        '/api/viewer/heartbeat',
        '/api/viewer/stop'
    ],
    // Endpoint prefixes that don't require API key validation
    publicPrefixes: [
        '/api/stream/',
        '/hls/'                 // HLS proxy - public streaming endpoint
    ],
    // Whether to enforce API key validation (can be disabled for development)
    enabled: process.env.API_KEY_VALIDATION_ENABLED !== 'false'
};

/**
 * Check if an endpoint is public (doesn't require API key)
 * @param {string} url - The request URL
 * @returns {boolean} True if endpoint is public
 */
export function isPublicEndpoint(url) {
    // Remove query string for comparison
    const path = url.split('?')[0];
    
    // Check exact matches
    if (API_KEY_VALIDATOR_CONFIG.publicEndpoints.includes(path)) {
        return true;
    }
    
    // Check prefix matches
    for (const prefix of API_KEY_VALIDATOR_CONFIG.publicPrefixes) {
        if (path.startsWith(prefix)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Extract API key from request
 * @param {Object} request - Fastify request object
 * @returns {string|null} API key or null
 */
export function extractApiKey(request) {
    return request.headers[API_KEY_VALIDATOR_CONFIG.headerName.toLowerCase()] || null;
}

/**
 * API Key validation middleware for Fastify
 * @param {Object} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
export async function apiKeyValidatorMiddleware(fastify, options) {
    fastify.addHook('onRequest', async (request, reply) => {
        // Skip if API key validation is disabled
        if (!API_KEY_VALIDATOR_CONFIG.enabled) {
            return;
        }
        
        // Skip public endpoints
        if (isPublicEndpoint(request.url)) {
            return;
        }
        
        // Skip if no API keys have been created yet (initial setup)
        if (!hasActiveApiKeys()) {
            return;
        }
        
        const apiKey = extractApiKey(request);
        
        // Check for missing API key
        if (!apiKey) {
            logApiKeyFailure({
                reason: 'missing',
                endpoint: request.url,
                method: request.method
            }, request);
            
            return reply.code(403).send({
                success: false,
                message: 'Access denied'
            });
        }
        
        // Validate the API key
        const validation = validateApiKey(apiKey);
        
        if (!validation.valid) {
            logApiKeyFailure({
                reason: validation.reason,
                endpoint: request.url,
                method: request.method,
                clientId: validation.clientId
            }, request);
            
            return reply.code(403).send({
                success: false,
                message: 'Access denied'
            });
        }
        
        // Attach client info to request for downstream use
        request.apiKeyClient = {
            id: validation.clientId,
            name: validation.clientName
        };
    });
}

/**
 * Standalone API key validation function for use in specific routes
 * @param {Object} request - Fastify request object
 * @param {Object} reply - Fastify reply object
 * @returns {Object|null} Validation result or null if rejected
 */
export async function validateApiKeyMiddleware(request, reply) {
    const apiKey = extractApiKey(request);
    
    if (!apiKey) {
        logApiKeyFailure({
            reason: 'missing',
            endpoint: request.url,
            method: request.method
        }, request);
        
        reply.code(403).send({
            success: false,
            message: 'Access denied'
        });
        return null;
    }
    
    const validation = validateApiKey(apiKey);
    
    if (!validation.valid) {
        logApiKeyFailure({
            reason: validation.reason,
            endpoint: request.url,
            method: request.method,
            clientId: validation.clientId
        }, request);
        
        reply.code(403).send({
            success: false,
            message: 'Access denied'
        });
        return null;
    }
    
    return validation;
}

export default {
    API_KEY_VALIDATOR_CONFIG,
    isPublicEndpoint,
    extractApiKey,
    apiKeyValidatorMiddleware,
    validateApiKeyMiddleware
};
