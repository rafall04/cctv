/**
 * Property-Based Tests for Rate Limiter Middleware
 * 
 * **Property 3: Rate Limit Enforcement by Endpoint Type**
 * **Validates: Requirements 2.1, 2.2, 2.3**
 * 
 * Feature: api-security-hardening, Property 3: Rate Limit Enforcement by Endpoint Type
 * 
 * For any IP address and endpoint combination, the number of allowed requests within 
 * a 60-second window SHALL NOT exceed the configured limit for that endpoint type 
 * (100 for public, 30 for auth, unlimited for whitelisted).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    RATE_LIMIT_CONFIG,
    isWhitelisted,
    getEndpointType,
    getRateLimitForType,
    generateRateLimitKey,
    checkRateLimit,
    resetRateLimit,
    clearAllRateLimits,
    getRateLimitStatus
} from '../middleware/rateLimiter.js';

describe('Rate Limiter Property Tests', () => {
    // Clear rate limits before each test
    beforeEach(() => {
        clearAllRateLimits();
    });

    afterEach(() => {
        clearAllRateLimits();
    });

    /**
     * Property 3: Rate Limit Enforcement by Endpoint Type
     * 
     * For any IP address and endpoint type, the rate limiter SHALL allow exactly
     * the configured number of requests and reject subsequent requests.
     * 
     * **Validates: Requirements 2.1, 2.2, 2.3**
     */
    describe('Property 3: Rate Limit Enforcement by Endpoint Type', () => {
        it('Public endpoints allow exactly 100 requests per minute', () => {
            const ipArbitrary = fc.ipV4();
            
            fc.assert(
                fc.property(ipArbitrary, (ip) => {
                    clearAllRateLimits();
                    
                    const key = generateRateLimitKey(ip, 'public');
                    const limit = RATE_LIMIT_CONFIG.public.max;
                    const window = RATE_LIMIT_CONFIG.public.window;
                    
                    // Make exactly 'limit' requests - all should be allowed
                    for (let i = 0; i < limit; i++) {
                        const result = checkRateLimit(key, limit, window);
                        expect(result.allowed).toBe(true);
                    }
                    
                    // The next request should be rejected
                    const rejectedResult = checkRateLimit(key, limit, window);
                    expect(rejectedResult.allowed).toBe(false);
                    expect(rejectedResult.retryAfter).toBeGreaterThan(0);
                }),
                { numRuns: 100 }
            );
        });

        it('Auth endpoints allow exactly 30 requests per minute', () => {
            const ipArbitrary = fc.ipV4();
            
            fc.assert(
                fc.property(ipArbitrary, (ip) => {
                    clearAllRateLimits();
                    
                    const key = generateRateLimitKey(ip, 'auth');
                    const limit = RATE_LIMIT_CONFIG.auth.max;
                    const window = RATE_LIMIT_CONFIG.auth.window;
                    
                    // Make exactly 'limit' requests - all should be allowed
                    for (let i = 0; i < limit; i++) {
                        const result = checkRateLimit(key, limit, window);
                        expect(result.allowed).toBe(true);
                    }
                    
                    // The next request should be rejected
                    const rejectedResult = checkRateLimit(key, limit, window);
                    expect(rejectedResult.allowed).toBe(false);
                    expect(rejectedResult.retryAfter).toBeGreaterThan(0);
                }),
                { numRuns: 100 }
            );
        });

        it('Admin endpoints allow exactly 60 requests per minute', () => {
            const ipArbitrary = fc.ipV4();
            
            fc.assert(
                fc.property(ipArbitrary, (ip) => {
                    clearAllRateLimits();
                    
                    const key = generateRateLimitKey(ip, 'admin');
                    const limit = RATE_LIMIT_CONFIG.admin.max;
                    const window = RATE_LIMIT_CONFIG.admin.window;
                    
                    // Make exactly 'limit' requests - all should be allowed
                    for (let i = 0; i < limit; i++) {
                        const result = checkRateLimit(key, limit, window);
                        expect(result.allowed).toBe(true);
                    }
                    
                    // The next request should be rejected
                    const rejectedResult = checkRateLimit(key, limit, window);
                    expect(rejectedResult.allowed).toBe(false);
                    expect(rejectedResult.retryAfter).toBeGreaterThan(0);
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property: Whitelisted endpoints are never rate limited
     * 
     * For any whitelisted URL, isWhitelisted should return true and
     * getRateLimitForType should return null.
     */
    it('Property: Whitelisted endpoints are never rate limited', () => {
        const whitelistUrlArbitrary = fc.oneof(
            fc.constant('/health'),
            fc.constant('/api/stream'),
            fc.constant('/api/stream/camera1'),
            fc.constant('/api/stream/123'),
            fc.string({ minLength: 1, maxLength: 10 })
                .filter(s => /^[a-zA-Z0-9\-_]+$/.test(s))
                .map(s => '/api/stream/' + s)
        );

        fc.assert(
            fc.property(whitelistUrlArbitrary, (url) => {
                expect(isWhitelisted(url)).toBe(true);
                expect(getEndpointType(url)).toBe('whitelist');
                expect(getRateLimitForType('whitelist')).toBeNull();
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Non-whitelisted endpoints are rate limited
     * 
     * For any non-whitelisted URL, isWhitelisted should return false and
     * getRateLimitForType should return a valid config.
     */
    it('Property: Non-whitelisted endpoints are rate limited', () => {
        const nonWhitelistUrlArbitrary = fc.oneof(
            fc.constant('/api/cameras'),
            fc.constant('/api/cameras/active'),
            fc.constant('/api/auth/login'),
            fc.constant('/api/auth/logout'),
            fc.constant('/api/admin/users'),
            fc.constant('/api/areas'),
            fc.string({ minLength: 1, maxLength: 10 })
                .filter(s => /^[a-zA-Z0-9\-_]+$/.test(s))
                .map(s => '/api/cameras/' + s)
        );

        fc.assert(
            fc.property(nonWhitelistUrlArbitrary, (url) => {
                expect(isWhitelisted(url)).toBe(false);
                
                const endpointType = getEndpointType(url);
                expect(['public', 'auth', 'admin']).toContain(endpointType);
                
                const config = getRateLimitForType(endpointType);
                expect(config).not.toBeNull();
                expect(config.max).toBeGreaterThan(0);
                expect(config.window).toBeGreaterThan(0);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Endpoint type classification is consistent
     * 
     * For any URL, the endpoint type classification should be deterministic
     * and consistent with the URL prefix patterns.
     */
    it('Property: Endpoint type classification is consistent', () => {
        const urlArbitrary = fc.oneof(
            // Auth endpoints
            fc.constant('/api/auth/login'),
            fc.constant('/api/auth/logout'),
            fc.constant('/api/auth/verify'),
            // Admin endpoints
            fc.constant('/api/admin/users'),
            fc.constant('/api/admin/api-keys'),
            // Public endpoints
            fc.constant('/api/cameras'),
            fc.constant('/api/cameras/active'),
            fc.constant('/api/areas'),
            // Whitelisted endpoints
            fc.constant('/health'),
            fc.constant('/api/stream'),
            fc.constant('/api/stream/camera1')
        );

        fc.assert(
            fc.property(urlArbitrary, (url) => {
                const type1 = getEndpointType(url);
                const type2 = getEndpointType(url);
                
                // Classification should be deterministic
                expect(type1).toBe(type2);
                
                // Verify classification matches URL pattern
                if (url.startsWith('/api/auth')) {
                    expect(type1).toBe('auth');
                } else if (url.startsWith('/api/admin')) {
                    expect(type1).toBe('admin');
                } else if (url === '/health' || url.startsWith('/api/stream')) {
                    expect(type1).toBe('whitelist');
                } else {
                    expect(type1).toBe('public');
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Rate limit remaining count decreases correctly
     * 
     * For any number of requests up to the limit, the remaining count
     * should decrease by 1 for each request.
     */
    it('Property: Rate limit remaining count decreases correctly', () => {
        const requestCountArbitrary = fc.integer({ min: 1, max: 30 });
        const ipArbitrary = fc.ipV4();

        fc.assert(
            fc.property(requestCountArbitrary, ipArbitrary, (requestCount, ip) => {
                clearAllRateLimits();
                
                const key = generateRateLimitKey(ip, 'auth');
                const limit = RATE_LIMIT_CONFIG.auth.max;
                const window = RATE_LIMIT_CONFIG.auth.window;
                
                let previousRemaining = limit;
                
                for (let i = 0; i < requestCount; i++) {
                    const result = checkRateLimit(key, limit, window);
                    
                    if (result.allowed) {
                        // Remaining should decrease by 1
                        expect(result.remaining).toBe(previousRemaining - 1);
                        previousRemaining = result.remaining;
                    }
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Different IPs have independent rate limits
     * 
     * For any two different IP addresses, their rate limits should be
     * tracked independently.
     */
    it('Property: Different IPs have independent rate limits', () => {
        fc.assert(
            fc.property(fc.ipV4(), fc.ipV4(), (ip1, ip2) => {
                // Skip if IPs are the same
                if (ip1 === ip2) return true;
                
                clearAllRateLimits();
                
                const key1 = generateRateLimitKey(ip1, 'public');
                const key2 = generateRateLimitKey(ip2, 'public');
                const limit = RATE_LIMIT_CONFIG.public.max;
                const window = RATE_LIMIT_CONFIG.public.window;
                
                // Exhaust rate limit for IP1
                for (let i = 0; i < limit; i++) {
                    checkRateLimit(key1, limit, window);
                }
                
                // IP1 should be rate limited
                const result1 = checkRateLimit(key1, limit, window);
                expect(result1.allowed).toBe(false);
                
                // IP2 should still have full quota
                const result2 = checkRateLimit(key2, limit, window);
                expect(result2.allowed).toBe(true);
                expect(result2.remaining).toBe(limit - 1);
                
                return true;
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Rate limit key generation is deterministic
     * 
     * For any IP and endpoint type, the generated key should be consistent.
     */
    it('Property: Rate limit key generation is deterministic', () => {
        const ipArbitrary = fc.ipV4();
        const endpointTypeArbitrary = fc.constantFrom('public', 'auth', 'admin');

        fc.assert(
            fc.property(ipArbitrary, endpointTypeArbitrary, (ip, endpointType) => {
                const key1 = generateRateLimitKey(ip, endpointType);
                const key2 = generateRateLimitKey(ip, endpointType);
                
                expect(key1).toBe(key2);
                expect(key1).toBe(`${ip}:${endpointType}`);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Reset clears rate limit for specific key
     * 
     * After resetting a rate limit, the key should have full quota again.
     */
    it('Property: Reset clears rate limit for specific key', () => {
        const ipArbitrary = fc.ipV4();
        const requestCountArbitrary = fc.integer({ min: 1, max: 50 });

        fc.assert(
            fc.property(ipArbitrary, requestCountArbitrary, (ip, requestCount) => {
                clearAllRateLimits();
                
                const key = generateRateLimitKey(ip, 'public');
                const limit = RATE_LIMIT_CONFIG.public.max;
                const window = RATE_LIMIT_CONFIG.public.window;
                
                // Make some requests
                for (let i = 0; i < Math.min(requestCount, limit); i++) {
                    checkRateLimit(key, limit, window);
                }
                
                // Reset the rate limit
                resetRateLimit(key);
                
                // Should have full quota again
                const status = getRateLimitStatus(key, limit, window);
                expect(status.count).toBe(0);
                expect(status.remaining).toBe(limit);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Retry-After header is positive when rate limited
     * 
     * When a request is rate limited, the retryAfter value should be
     * a positive integer representing seconds to wait.
     */
    it('Property: Retry-After is positive when rate limited', () => {
        const ipArbitrary = fc.ipV4();

        fc.assert(
            fc.property(ipArbitrary, (ip) => {
                clearAllRateLimits();
                
                const key = generateRateLimitKey(ip, 'auth');
                const limit = RATE_LIMIT_CONFIG.auth.max;
                const window = RATE_LIMIT_CONFIG.auth.window;
                
                // Exhaust rate limit
                for (let i = 0; i < limit; i++) {
                    checkRateLimit(key, limit, window);
                }
                
                // Next request should be rejected with positive retryAfter
                const result = checkRateLimit(key, limit, window);
                expect(result.allowed).toBe(false);
                expect(result.retryAfter).toBeGreaterThan(0);
                expect(Number.isInteger(result.retryAfter)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Rate limit config values are valid
     * 
     * All rate limit configurations should have positive max and window values.
     */
    it('Property: Rate limit config values are valid', () => {
        const endpointTypes = ['public', 'auth', 'admin'];
        
        endpointTypes.forEach(type => {
            const config = RATE_LIMIT_CONFIG[type];
            expect(config.max).toBeGreaterThan(0);
            expect(config.window).toBeGreaterThan(0);
        });
        
        // Verify specific limits match requirements
        expect(RATE_LIMIT_CONFIG.public.max).toBe(100);
        expect(RATE_LIMIT_CONFIG.auth.max).toBe(30);
        expect(RATE_LIMIT_CONFIG.admin.max).toBe(60);
        
        // Verify window is 60 seconds (60000ms)
        expect(RATE_LIMIT_CONFIG.public.window).toBe(60000);
        expect(RATE_LIMIT_CONFIG.auth.window).toBe(60000);
        expect(RATE_LIMIT_CONFIG.admin.window).toBe(60000);
    });
});
