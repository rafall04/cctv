/**
 * Property-Based Tests for CSRF Protection
 * 
 * **Property 2: CSRF Token Validation for State-Changing Requests**
 * **Validates: Requirements 1.6, 1.7**
 * 
 * Feature: api-security-hardening, Property 2: CSRF Token Validation for State-Changing Requests
 * 
 * For any POST, PUT, or DELETE request to a protected endpoint, if the CSRF token
 * in the header matches the CSRF token in the cookie, the request SHALL be allowed;
 * otherwise, the request SHALL be rejected with 403 status.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    generateCsrfToken,
    timingSafeEqual,
    isStateChangingMethod,
    shouldSkipCsrf,
    validateCsrfToken,
    CSRF_CONFIG,
    STATE_CHANGING_METHODS,
    CSRF_SKIP_ENDPOINTS
} from '../middleware/csrfProtection.js';

// Custom arbitrary for hex strings
const hexStringArbitrary = (minLength, maxLength) => 
    fc.array(
        fc.integer({ min: 0, max: 15 }).map(n => n.toString(16)),
        { minLength, maxLength }
    ).map(arr => arr.join(''));

// Create a mock request with CSRF tokens
function createMockRequest(headerToken, cookieToken, method = 'POST', url = '/api/test') {
    const headers = {};
    if (headerToken !== undefined) {
        headers[CSRF_CONFIG.headerName.toLowerCase()] = headerToken;
    }
    
    const cookies = {};
    if (cookieToken !== undefined) {
        cookies[CSRF_CONFIG.cookieName] = cookieToken;
    }
    
    return {
        method,
        url,
        headers,
        cookies
    };
}

describe('CSRF Protection Property Tests', () => {
    /**
     * Property 2: CSRF Token Validation for State-Changing Requests
     * 
     * For any POST, PUT, or DELETE request to a protected endpoint, if the CSRF token
     * in the header matches the CSRF token in the cookie, the request SHALL be allowed;
     * otherwise, the request SHALL be rejected with 403 status.
     * 
     * **Validates: Requirements 1.6, 1.7**
     */
    describe('Property 2: CSRF Token Validation for State-Changing Requests', () => {
        it('Matching tokens are always accepted', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    () => {
                        // Generate a valid CSRF token
                        const token = generateCsrfToken();
                        
                        // Create request with matching tokens
                        const request = createMockRequest(token, token);
                        
                        // Validate - should always pass
                        const result = validateCsrfToken(request);
                        
                        expect(result.valid).toBe(true);
                        expect(result.reason).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Mismatched tokens are always rejected', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    () => {
                        // Generate two different tokens
                        const headerToken = generateCsrfToken();
                        const cookieToken = generateCsrfToken();
                        
                        // Ensure they're different (extremely unlikely to be same)
                        if (headerToken === cookieToken) return true;
                        
                        // Create request with mismatched tokens
                        const request = createMockRequest(headerToken, cookieToken);
                        
                        // Validate - should always fail
                        const result = validateCsrfToken(request);
                        
                        expect(result.valid).toBe(false);
                        expect(result.reason).toBe('CSRF token mismatch');
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Missing header token is always rejected', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    () => {
                        const cookieToken = generateCsrfToken();
                        
                        // Create request with missing header token
                        const request = createMockRequest(undefined, cookieToken);
                        
                        const result = validateCsrfToken(request);
                        
                        expect(result.valid).toBe(false);
                        expect(result.reason).toBe('Missing CSRF token in header');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Missing cookie token is always rejected', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    () => {
                        const headerToken = generateCsrfToken();
                        
                        // Create request with missing cookie token
                        const request = createMockRequest(headerToken, undefined);
                        
                        const result = validateCsrfToken(request);
                        
                        expect(result.valid).toBe(false);
                        expect(result.reason).toBe('Missing CSRF token in cookie');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Invalid format tokens are rejected', () => {
            const invalidTokenArbitrary = fc.oneof(
                // Too short
                hexStringArbitrary(1, 63),
                // Too long
                hexStringArbitrary(65, 128),
                // Non-hex characters
                fc.string({ minLength: 64, maxLength: 64 })
                    .filter(s => !/^[a-f0-9]+$/i.test(s)),
                // Empty string
                fc.constant('')
            );

            fc.assert(
                fc.property(invalidTokenArbitrary, (invalidToken) => {
                    const validToken = generateCsrfToken();
                    
                    // Test invalid header token
                    const request1 = createMockRequest(invalidToken, validToken);
                    const result1 = validateCsrfToken(request1);
                    
                    // Should be rejected (either missing or invalid format)
                    expect(result1.valid).toBe(false);
                    
                    // Test invalid cookie token
                    const request2 = createMockRequest(validToken, invalidToken);
                    const result2 = validateCsrfToken(request2);
                    
                    expect(result2.valid).toBe(false);
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property: CSRF token generation produces valid format
     * 
     * For any generated CSRF token, it should be exactly 64 hex characters.
     */
    it('Property: Generated CSRF tokens have correct format', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 1000 }), () => {
                const token = generateCsrfToken();
                
                // Should be exactly 64 characters (32 bytes * 2 hex chars)
                expect(token.length).toBe(64);
                
                // Should be valid hex
                expect(/^[a-f0-9]+$/i.test(token)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: CSRF token generation produces unique tokens
     * 
     * Generated tokens should be unique (collision probability is negligible).
     */
    it('Property: Generated CSRF tokens are unique', () => {
        fc.assert(
            fc.property(fc.integer({ min: 10, max: 100 }), (count) => {
                const tokens = new Set();
                
                for (let i = 0; i < count; i++) {
                    tokens.add(generateCsrfToken());
                }
                
                // All tokens should be unique
                expect(tokens.size).toBe(count);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Timing-safe comparison is correct
     * 
     * For any two strings, timingSafeEqual should return true iff they are equal.
     */
    it('Property: Timing-safe comparison is correct', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }),
                fc.string({ minLength: 1, maxLength: 100 }),
                (str1, str2) => {
                    const result = timingSafeEqual(str1, str2);
                    const expected = str1 === str2;
                    
                    expect(result).toBe(expected);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Timing-safe comparison handles edge cases
     * 
     * Non-string inputs should return false.
     */
    it('Property: Timing-safe comparison handles non-strings', () => {
        const nonStringArbitrary = fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.string()),
            fc.object()
        );

        fc.assert(
            fc.property(nonStringArbitrary, fc.string(), (nonString, str) => {
                expect(timingSafeEqual(nonString, str)).toBe(false);
                expect(timingSafeEqual(str, nonString)).toBe(false);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: State-changing method detection is consistent
     * 
     * For any HTTP method, isStateChangingMethod should return the same result.
     */
    it('Property: State-changing method detection is consistent', () => {
        const methodArbitrary = fc.constantFrom(
            'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
            'get', 'post', 'put', 'delete', 'patch', 'head', 'options'
        );

        fc.assert(
            fc.property(methodArbitrary, (method) => {
                const result1 = isStateChangingMethod(method);
                const result2 = isStateChangingMethod(method);
                const result3 = isStateChangingMethod(method);
                
                expect(result1).toBe(result2);
                expect(result2).toBe(result3);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Known state-changing methods are correctly identified
     */
    it('Property: Known state-changing methods are correctly identified', () => {
        const stateChangingArbitrary = fc.constantFrom(
            'POST', 'PUT', 'DELETE', 'PATCH',
            'post', 'put', 'delete', 'patch'
        );

        fc.assert(
            fc.property(stateChangingArbitrary, (method) => {
                expect(isStateChangingMethod(method)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Non-state-changing methods are correctly identified
     */
    it('Property: Non-state-changing methods are correctly identified', () => {
        const nonStateChangingArbitrary = fc.constantFrom(
            'GET', 'HEAD', 'OPTIONS',
            'get', 'head', 'options'
        );

        fc.assert(
            fc.property(nonStateChangingArbitrary, (method) => {
                expect(isStateChangingMethod(method)).toBe(false);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: CSRF skip endpoint detection is consistent
     */
    it('Property: CSRF skip endpoint detection is consistent', () => {
        const urlArbitrary = fc.oneof(
            // Skip endpoints
            fc.constant('/api/stream'),
            fc.constant('/api/stream/camera1'),
            fc.constant('/health'),
            // Non-skip endpoints
            fc.constant('/api/cameras'),
            fc.constant('/api/admin/api-keys'),
            fc.constant('/api/auth/logout'),
            // Random paths
            fc.string({ minLength: 1, maxLength: 50 })
                .filter(s => /^[a-zA-Z0-9\-_\/]+$/.test(s))
                .map(s => '/' + s)
        );

        fc.assert(
            fc.property(urlArbitrary, (url) => {
                const result1 = shouldSkipCsrf(url);
                const result2 = shouldSkipCsrf(url);
                const result3 = shouldSkipCsrf(url);
                
                expect(result1).toBe(result2);
                expect(result2).toBe(result3);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Known skip endpoints are correctly identified
     */
    it('Property: Known skip endpoints are correctly identified', () => {
        const skipEndpointArbitrary = fc.constantFrom(
            '/api/stream',
            '/api/stream/camera1',
            '/api/stream/test123',
            '/health'
        );

        fc.assert(
            fc.property(skipEndpointArbitrary, (endpoint) => {
                expect(shouldSkipCsrf(endpoint)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Protected endpoints require CSRF validation
     */
    it('Property: Protected endpoints require CSRF validation', () => {
        const protectedEndpointArbitrary = fc.constantFrom(
            '/api/cameras',
            '/api/cameras/1',
            '/api/admin/api-keys',
            '/api/users',
            '/api/auth/logout'
        );

        fc.assert(
            fc.property(protectedEndpointArbitrary, (endpoint) => {
                expect(shouldSkipCsrf(endpoint)).toBe(false);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: CSRF config values are valid
     */
    it('Property: CSRF config values are valid', () => {
        expect(CSRF_CONFIG.tokenLength).toBe(32);
        expect(CSRF_CONFIG.headerName).toBe('X-CSRF-Token');
        expect(CSRF_CONFIG.cookieName).toBe('csrf_token');
        expect(CSRF_CONFIG.expirationMinutes).toBeGreaterThan(0);
        expect(CSRF_CONFIG.cookieOptions.httpOnly).toBe(true);
        expect(CSRF_CONFIG.cookieOptions.sameSite).toBe('strict');
    });

    /**
     * Property: STATE_CHANGING_METHODS contains expected methods
     */
    it('Property: STATE_CHANGING_METHODS contains expected methods', () => {
        expect(STATE_CHANGING_METHODS).toContain('POST');
        expect(STATE_CHANGING_METHODS).toContain('PUT');
        expect(STATE_CHANGING_METHODS).toContain('DELETE');
        expect(STATE_CHANGING_METHODS).toContain('PATCH');
        expect(STATE_CHANGING_METHODS).not.toContain('GET');
        expect(STATE_CHANGING_METHODS).not.toContain('HEAD');
        expect(STATE_CHANGING_METHODS).not.toContain('OPTIONS');
    });

    /**
     * Property: CSRF_SKIP_ENDPOINTS contains expected endpoints
     */
    it('Property: CSRF_SKIP_ENDPOINTS contains expected endpoints', () => {
        expect(CSRF_SKIP_ENDPOINTS).toContain('/api/stream');
        expect(CSRF_SKIP_ENDPOINTS).toContain('/health');
    });
});
