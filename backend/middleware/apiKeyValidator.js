/**
 * Purpose: API key validation middleware for private/admin-facing API requests.
 * Caller: backend/server.js security middleware registration and focused middleware tests.
 * Deps: apiKeyService.js, securityAuditLogger.js.
 * MainFuncs: isPublicEndpoint, extractApiKey, apiKeyValidatorMiddleware, validateApiKeyMiddleware.
 * SideEffects: Rejects protected requests without valid API keys and logs validation failures.
 */

import fp from 'fastify-plugin';
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
        '/api/auth/register',
        '/api/auth/register-info',
        '/api/cameras/active',
        '/api/stream',
        '/api/areas/public',
        '/api/viewer/start',
        '/api/viewer/heartbeat',
        '/api/viewer/stop'
    ],
    // Endpoint prefixes that don't require API key validation
    publicPrefixes: [
        '/api/public/',
        '/api/stream/',
        '/hls/',                // HLS proxy - public streaming endpoint
        '/api/billing/webhook'  // Payment gateway webhooks - authenticated by gateway signature
    ],
    // Whether to enforce API key validation (can be disabled for development)
    enabled: process.env.API_KEY_VALIDATION_ENABLED !== 'false',
    // Production safety knob. When set to 'true', a request that arrives
    // BEFORE any active API key exists in the database is rejected with
    // 403 instead of silently passing through. The historic behavior
    // (silent pass when api_keys is empty) is fine for first-time setup
    // on a developer's laptop, but it's a sharp edge in production —
    // forgetting to seed an API key would leave protected endpoints
    // wide open until someone noticed.
    requireKeys: process.env.API_KEY_REQUIRE_KEYS === 'true'
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
 * API Key validation middleware for Fastify.
 * Wrapped with fastify-plugin so the onRequest hook applies to every route
 * (without fp() the hook is encapsulated and validation never runs).
 */
async function apiKeyValidatorPlugin(fastify, options) {
    fastify.addHook('onRequest', async (request, reply) => {
        // Skip if API key validation is disabled
        if (!API_KEY_VALIDATOR_CONFIG.enabled) {
            return;
        }
        
        // Skip public endpoints
        if (isPublicEndpoint(request.url)) {
            return;
        }
        
        // Setup-mode bypass: when no API keys exist yet we historically
        // let the request through so an operator can bootstrap the
        // system. In production that's a footgun — forgetting to seed
        // a key leaves protected endpoints open. The requireKeys flag
        // (env: API_KEY_REQUIRE_KEYS=true) flips this into a hard 403.
        if (!hasActiveApiKeys()) {
            if (API_KEY_VALIDATOR_CONFIG.requireKeys) {
                logApiKeyFailure({
                    reason: 'no_active_keys',
                    endpoint: request.url,
                    method: request.method,
                }, request);
                return reply.code(403).send({
                    success: false,
                    message: 'API keys not configured on server',
                });
            }
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

export const apiKeyValidatorMiddleware = fp(apiKeyValidatorPlugin, {
    name: 'api-key-validator',
    fastify: '4.x',
});

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
