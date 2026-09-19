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
        '/api/health',           // same probe through the /api proxy path
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/register-info',
        '/api/auth/csrf',          // CSRF token must be fetchable before login
        '/api/auth/refresh',       // refresh is anonymous by design (the access token expired)
        '/api/cameras/active',
        '/api/stream',
        '/api/areas/public',
        '/api/areas/filters',
        '/api/branding/public',
        '/api/config/public',      // SPA bootstrap config
        '/api/config/version',
        '/api/config/manifest',
        '/api/settings/map-center',
        '/api/settings/landing-page',
        '/api/settings/public-ads',
        '/api/settings/timezone',
        '/api/saweria/config',
        '/api/sponsors/active',
        '/api/sponsors/cameras',
        '/api/promo-banners/public',
        '/api/viewer/start',
        '/api/viewer/heartbeat',
        '/api/viewer/stop',
        '/api/viewer/runtime-signal',
        '/api/playback-viewer/start',
        '/api/playback-viewer/heartbeat',
        '/api/playback-viewer/stop',
        '/api/feedback',           // anonymous feedback submission (GET / is authMiddleware-gated)
        // NOT public — exempt only from the API-key layer. This is the bootstrap path:
        // with requireKeys + an empty api_keys table it is the only way to mint the
        // first key, and it stays behind authMiddleware + requireAdmin regardless.
        '/api/admin/api-keys',
    ],
    // Endpoint prefixes that don't require API key validation
    publicPrefixes: [
        '/api/public/',
        '/api/stream/',
        '/hls/',                  // HLS proxy - public streaming endpoint
        '/api/thumbnails/',       // static anonymous thumbnails (per-camera gate applied upstream)
        '/api/playback-token/',   // activate/heartbeat/clear — all anonymous token operations
        '/api/playback-archive/', // public archive stream — gated by playback token, not API key
        '/api/voucher/',          // access/redeem/order/status — all anonymous
        '/api/recordings/',       // anonymous community playback (segments/stream/playlist/archive);
                                  // admin ops under the same prefix stay authMiddleware+requireAdmin gated
        '/api/promo-media/',      // static promo poster images
        '/api/affiliate-media/',  // static affiliate product photos
        '/api/promo-banners/',    // public read + anonymous click tracking; admin CRUD stays JWT+requireAdmin
        '/api/billing/webhook',  // Payment gateway webhooks - authenticated by gateway signature
        '/api/voucher/webhook',  // Voucher payment webhook - server-to-server, re-verified via gateway API
        '/api/playback-access',  // Self-serve playback packages, orders, renewals, recovery + iPaymu notify (device-gated, not API-key)
        '/api/admin/audio/node', // Titik Speaker STB agents — device-token auth inside the handlers (x-device-token); an STB can't hold an API key
        '/api/internal/'         // MediaMTX push hooks - loopback + shared-secret gated in the controller
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

        // CORS preflights never carry credentials or API keys — rejecting them would
        // break cross-origin consumers before the real request is even evaluated.
        if (request.method === 'OPTIONS') {
            return;
        }

        // Only /api/* routes are API-key consumers — anything else (hls paths,
        // health, future ws/static routes, plain 404s) is out of scope.
        if (!request.url.split('?')[0].startsWith('/api')) {
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
    fastify: '5.x',
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
