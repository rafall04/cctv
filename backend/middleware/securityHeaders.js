/**
 * Security Headers Middleware — API/backend layer.
 *
 * The Fastify process serves JSON + media bytes only (no HTML — the SPA is
 * served by nginx, which owns the DOCUMENT Content-Security-Policy). Two facts
 * follow:
 *   - This layer IS the only header authority for clients hitting the backend
 *     directly (api-cctv.raf.my.id reaches :3000 through cloudflared, not nginx).
 *   - The CSP here is deliberately strict-none: a CSP on a JSON or playlist
 *     response is inert anyway, and `default-src 'none'` is the honest statement
 *     that nothing this process emits is a document.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7
 */

import fp from 'fastify-plugin';

/**
 * Security headers configuration
 */
export const SECURITY_HEADERS_CONFIG = {
    // X-Content-Type-Options prevents MIME type sniffing
    contentTypeOptions: 'nosniff',

    // X-Frame-Options prevents clickjacking
    frameOptions: 'DENY',

    // X-XSS-Protection '0' — the browser XSS auditor is deprecated and was itself
    // an XSS vector (attackers could force-block legitimate scripts). Modern
    // guidance is to disable it explicitly; CSP is the real control.
    xssProtection: '0',

    // API/media responses are never documents — strict-none is the correct shape.
    contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",

    // API responses must not leak the request URL as Referer to subresources.
    referrerPolicy: 'no-referrer',

    // The API never needs device features; deny all so a compromised page context
    // cannot piggyback on api-origin responses for permissions.
    permissionsPolicy: 'camera=(), microphone=(), geolocation=()',

    // 6 months + subdomains. Emitted over HTTPS only has effect; on HTTP it is
    // ignored per spec — harmless either way.
    strictTransportSecurity: 'max-age=15552000; includeSubDomains',

    // Headers to remove for security
    headersToRemove: ['X-Powered-By', 'Server'],

    // Auth endpoints that need Cache-Control: no-store
    authEndpoints: ['/api/auth', '/api/admin']
};

/**
 * Check if the request URL is an auth endpoint
 * @param {string} url - Request URL
 * @returns {boolean} True if auth endpoint
 */
export function isAuthEndpoint(url) {
    return SECURITY_HEADERS_CONFIG.authEndpoints.some(endpoint =>
        url.startsWith(endpoint)
    );
}

/**
 * Get all security headers for a response
 * @param {string} url - Request URL (for conditional headers)
 * @returns {Object} Headers object
 */
export function getSecurityHeaders(url = '') {
    const headers = {
        'X-Content-Type-Options': SECURITY_HEADERS_CONFIG.contentTypeOptions,
        'X-Frame-Options': SECURITY_HEADERS_CONFIG.frameOptions,
        'X-XSS-Protection': SECURITY_HEADERS_CONFIG.xssProtection,
        'Content-Security-Policy': SECURITY_HEADERS_CONFIG.contentSecurityPolicy,
        'Referrer-Policy': SECURITY_HEADERS_CONFIG.referrerPolicy,
        'Permissions-Policy': SECURITY_HEADERS_CONFIG.permissionsPolicy,
        'Strict-Transport-Security': SECURITY_HEADERS_CONFIG.strictTransportSecurity
    };

    // Add Cache-Control: no-store for auth endpoints
    if (isAuthEndpoint(url)) {
        headers['Cache-Control'] = 'no-store';
    }

    return headers;
}

/**
 * Security headers middleware for Fastify.
 * Adds security headers to all responses and removes revealing headers.
 *
 * Wrapped with fastify-plugin so the onSend hook is NOT encapsulated — without
 * fp() the hook would only apply to routes registered inside this plugin's
 * scope (i.e. none), silently disabling all security headers.
 */
async function securityHeadersPlugin(fastify) {
    // Add security headers to all responses
    fastify.addHook('onSend', async (request, reply, payload) => {
        const url = request.url || '';
        const headers = getSecurityHeaders(url);

        // Set all security headers
        Object.entries(headers).forEach(([name, value]) => {
            reply.header(name, value);
        });

        // Remove revealing headers
        SECURITY_HEADERS_CONFIG.headersToRemove.forEach(header => {
            reply.removeHeader(header);
        });

        return payload;
    });
}

export const securityHeadersMiddleware = fp(securityHeadersPlugin, {
    name: 'security-headers',
    fastify: '5.x',
});

/**
 * Validate that a response has all required security headers
 * @param {Object} headers - Response headers object
 * @returns {Object} Validation result { valid: boolean, missing: string[], extra: string[] }
 */
export function validateSecurityHeaders(headers) {
    const requiredHeaders = [
        'X-Content-Type-Options',
        'X-Frame-Options',
        'X-XSS-Protection',
        'Content-Security-Policy',
        'Referrer-Policy',
        'Permissions-Policy',
        'Strict-Transport-Security'
    ];

    const forbiddenHeaders = ['X-Powered-By', 'Server'];

    // Normalize header names to lowercase for comparison
    const normalizedHeaders = {};
    Object.keys(headers).forEach(key => {
        normalizedHeaders[key.toLowerCase()] = headers[key];
    });

    const missing = requiredHeaders.filter(h =>
        !normalizedHeaders[h.toLowerCase()]
    );

    const extra = forbiddenHeaders.filter(h =>
        normalizedHeaders[h.toLowerCase()]
    );

    return {
        valid: missing.length === 0 && extra.length === 0,
        missing,
        extra
    };
}

/**
 * Validate security header values
 * @param {Object} headers - Response headers object
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
export function validateSecurityHeaderValues(headers) {
    const errors = [];

    // Normalize header names to lowercase for comparison
    const normalizedHeaders = {};
    Object.keys(headers).forEach(key => {
        normalizedHeaders[key.toLowerCase()] = headers[key];
    });

    // Validate X-Content-Type-Options
    const contentTypeOptions = normalizedHeaders['x-content-type-options'];
    if (contentTypeOptions && contentTypeOptions !== 'nosniff') {
        errors.push(`X-Content-Type-Options should be 'nosniff', got '${contentTypeOptions}'`);
    }

    // Validate X-Frame-Options
    const frameOptions = normalizedHeaders['x-frame-options'];
    if (frameOptions && frameOptions !== 'DENY') {
        errors.push(`X-Frame-Options should be 'DENY', got '${frameOptions}'`);
    }

    // Validate X-XSS-Protection — must be disabled, never the legacy mode=block
    const xssProtection = normalizedHeaders['x-xss-protection'];
    if (xssProtection && xssProtection !== '0') {
        errors.push(`X-XSS-Protection should be '0' (deprecated auditor disabled), got '${xssProtection}'`);
    }

    // Validate Content-Security-Policy contains frame-ancestors 'none'
    const csp = normalizedHeaders['content-security-policy'];
    if (csp && !csp.includes("frame-ancestors 'none'")) {
        errors.push("Content-Security-Policy should include frame-ancestors 'none'");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

export default securityHeadersMiddleware;
