/**
 * Security Headers Middleware
 * 
 * Implements security headers to protect against common web vulnerabilities:
 * - X-Content-Type-Options: nosniff (prevents MIME type sniffing)
 * - X-Frame-Options: DENY (prevents clickjacking)
 * - X-XSS-Protection: 1; mode=block (enables XSS filter)
 * - Content-Security-Policy (restricts resource origins)
 * - Removes X-Powered-By and Server headers
 * - Cache-Control: no-store for auth endpoints
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7
 */

/**
 * Security headers configuration
 */
export const SECURITY_HEADERS_CONFIG = {
    // X-Content-Type-Options prevents MIME type sniffing
    contentTypeOptions: 'nosniff',
    
    // X-Frame-Options prevents clickjacking
    frameOptions: 'DENY',
    
    // X-XSS-Protection enables browser XSS filter
    xssProtection: '1; mode=block',
    
    // Content-Security-Policy restricts resource origins
    contentSecurityPolicy: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://www.topcreativeformat.com https://inklinkor.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https: http:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss: http: https:",
        "media-src 'self' blob: http: https:",
        "frame-src http://www.topcreativeformat.com",
        "frame-ancestors 'none'"
    ].join('; '),
    
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
        'Content-Security-Policy': SECURITY_HEADERS_CONFIG.contentSecurityPolicy
    };
    
    // Add Cache-Control: no-store for auth endpoints
    if (isAuthEndpoint(url)) {
        headers['Cache-Control'] = 'no-store';
    }
    
    return headers;
}

/**
 * Security headers middleware for Fastify
 * Adds security headers to all responses and removes revealing headers
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
export async function securityHeadersMiddleware(fastify, options = {}) {
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
        'Content-Security-Policy'
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
    
    // Validate X-XSS-Protection
    const xssProtection = normalizedHeaders['x-xss-protection'];
    if (xssProtection && xssProtection !== '1; mode=block') {
        errors.push(`X-XSS-Protection should be '1; mode=block', got '${xssProtection}'`);
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
