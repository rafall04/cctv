/**
 * Property-Based Tests for Security Headers Middleware
 * 
 * **Property 10: Security Headers Presence**
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6**
 * 
 * Feature: api-security-hardening, Property 10: Security Headers Presence
 * 
 * For any HTTP response from the API, the response SHALL include all required 
 * security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, 
 * Content-Security-Policy) and SHALL NOT include revealing headers (X-Powered-By, Server).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    getSecurityHeaders,
    validateSecurityHeaders,
    validateSecurityHeaderValues,
    isAuthEndpoint,
    SECURITY_HEADERS_CONFIG
} from '../middleware/securityHeaders.js';

describe('Security Headers Property Tests', () => {
    /**
     * Property 10: Security Headers Presence
     * 
     * For any URL, getSecurityHeaders should return all required security headers
     * with correct values.
     * 
     * **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6**
     */
    it('Property 10: For any URL, all required security headers are present with correct values', () => {
        // Generate arbitrary URL paths
        const urlArbitrary = fc.oneof(
            fc.constant('/'),
            fc.constant('/health'),
            fc.constant('/api/cameras'),
            fc.constant('/api/auth/login'),
            fc.constant('/api/admin/users'),
            fc.string({ minLength: 1, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9\-_\/]+$/.test(s))
                .map(s => '/' + s)
        );

        fc.assert(
            fc.property(urlArbitrary, (url) => {
                const headers = getSecurityHeaders(url);
                
                // Validate all required headers are present
                const validation = validateSecurityHeaders(headers);
                expect(validation.valid).toBe(true);
                expect(validation.missing).toHaveLength(0);
                expect(validation.extra).toHaveLength(0);
                
                // Validate header values are correct
                const valueValidation = validateSecurityHeaderValues(headers);
                expect(valueValidation.valid).toBe(true);
                expect(valueValidation.errors).toHaveLength(0);
                
                // Verify specific header values
                expect(headers['X-Content-Type-Options']).toBe('nosniff');
                expect(headers['X-Frame-Options']).toBe('DENY');
                expect(headers['X-XSS-Protection']).toBe('1; mode=block');
                expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Auth endpoints should have Cache-Control: no-store
     * 
     * For any auth endpoint URL, the headers should include Cache-Control: no-store
     * 
     * **Validates: Requirements 8.7**
     */
    it('Property: Auth endpoints have Cache-Control: no-store header', () => {
        // Generate auth endpoint URLs
        const authEndpointArbitrary = fc.oneof(
            fc.constant('/api/auth/login'),
            fc.constant('/api/auth/logout'),
            fc.constant('/api/auth/verify'),
            fc.constant('/api/admin/users'),
            fc.constant('/api/admin/api-keys'),
            fc.string({ minLength: 1, maxLength: 10 })
                .filter(s => /^[a-zA-Z0-9\-_]+$/.test(s))
                .map(s => '/api/auth/' + s),
            fc.string({ minLength: 1, maxLength: 10 })
                .filter(s => /^[a-zA-Z0-9\-_]+$/.test(s))
                .map(s => '/api/admin/' + s)
        );

        fc.assert(
            fc.property(authEndpointArbitrary, (url) => {
                const headers = getSecurityHeaders(url);
                
                // Auth endpoints should have Cache-Control: no-store
                expect(isAuthEndpoint(url)).toBe(true);
                expect(headers['Cache-Control']).toBe('no-store');
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Non-auth endpoints should NOT have Cache-Control: no-store
     * 
     * For any non-auth endpoint URL, the headers should NOT include Cache-Control
     */
    it('Property: Non-auth endpoints do not have Cache-Control: no-store header', () => {
        // Generate non-auth endpoint URLs
        const nonAuthEndpointArbitrary = fc.oneof(
            fc.constant('/'),
            fc.constant('/health'),
            fc.constant('/api/cameras'),
            fc.constant('/api/cameras/active'),
            fc.constant('/api/stream'),
            fc.constant('/api/areas'),
            fc.string({ minLength: 1, maxLength: 10 })
                .filter(s => /^[a-zA-Z0-9\-_]+$/.test(s))
                .map(s => '/api/cameras/' + s),
            fc.string({ minLength: 1, maxLength: 10 })
                .filter(s => /^[a-zA-Z0-9\-_]+$/.test(s))
                .map(s => '/api/stream/' + s)
        );

        fc.assert(
            fc.property(nonAuthEndpointArbitrary, (url) => {
                const headers = getSecurityHeaders(url);
                
                // Non-auth endpoints should NOT have Cache-Control
                expect(isAuthEndpoint(url)).toBe(false);
                expect(headers['Cache-Control']).toBeUndefined();
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: validateSecurityHeaders correctly identifies missing headers
     * 
     * For any subset of required headers, validation should correctly identify missing ones
     */
    it('Property: validateSecurityHeaders correctly identifies missing headers', () => {
        const requiredHeaders = [
            'X-Content-Type-Options',
            'X-Frame-Options',
            'X-XSS-Protection',
            'Content-Security-Policy'
        ];

        // Generate subsets of headers (some missing)
        const headerSubsetArbitrary = fc.subarray(requiredHeaders, { minLength: 0, maxLength: 3 });

        fc.assert(
            fc.property(headerSubsetArbitrary, (presentHeaders) => {
                // Create headers object with only present headers
                const headers = {};
                presentHeaders.forEach(h => {
                    headers[h] = SECURITY_HEADERS_CONFIG[
                        h === 'X-Content-Type-Options' ? 'contentTypeOptions' :
                        h === 'X-Frame-Options' ? 'frameOptions' :
                        h === 'X-XSS-Protection' ? 'xssProtection' :
                        'contentSecurityPolicy'
                    ];
                });

                const validation = validateSecurityHeaders(headers);
                
                // Calculate expected missing headers
                const expectedMissing = requiredHeaders.filter(h => !presentHeaders.includes(h));
                
                // Validation should correctly identify missing headers
                expect(validation.missing.sort()).toEqual(expectedMissing.sort());
                
                // If all headers present, validation should pass
                if (presentHeaders.length === requiredHeaders.length) {
                    expect(validation.valid).toBe(true);
                } else {
                    expect(validation.valid).toBe(false);
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: validateSecurityHeaders correctly identifies forbidden headers
     * 
     * For any headers object containing forbidden headers, validation should identify them
     */
    it('Property: validateSecurityHeaders correctly identifies forbidden headers', () => {
        const forbiddenHeaders = ['X-Powered-By', 'Server'];

        // Generate combinations of forbidden headers
        const forbiddenSubsetArbitrary = fc.subarray(forbiddenHeaders, { minLength: 0, maxLength: 2 });

        fc.assert(
            fc.property(forbiddenSubsetArbitrary, (presentForbidden) => {
                // Create headers object with all required headers plus some forbidden ones
                const headers = getSecurityHeaders('/');
                
                // Add forbidden headers
                presentForbidden.forEach(h => {
                    headers[h] = 'some-value';
                });

                const validation = validateSecurityHeaders(headers);
                
                // Validation should correctly identify extra (forbidden) headers
                expect(validation.extra.sort()).toEqual(presentForbidden.sort());
                
                // If forbidden headers present, validation should fail
                if (presentForbidden.length > 0) {
                    expect(validation.valid).toBe(false);
                } else {
                    expect(validation.valid).toBe(true);
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Header validation is case-insensitive for header names
     * 
     * Header names should be validated case-insensitively
     */
    it('Property: Header validation is case-insensitive', () => {
        const caseVariations = fc.constantFrom(
            'x-content-type-options',
            'X-CONTENT-TYPE-OPTIONS',
            'X-Content-Type-Options',
            'x-Content-Type-Options'
        );

        fc.assert(
            fc.property(caseVariations, (headerName) => {
                const headers = {
                    [headerName]: 'nosniff',
                    'X-Frame-Options': 'DENY',
                    'X-XSS-Protection': '1; mode=block',
                    'Content-Security-Policy': "frame-ancestors 'none'"
                };

                const validation = validateSecurityHeaders(headers);
                
                // Should recognize the header regardless of case
                expect(validation.missing).not.toContain('X-Content-Type-Options');
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Content-Security-Policy must contain frame-ancestors 'none'
     * 
     * The CSP header must always include frame-ancestors 'none' for clickjacking protection
     */
    it('Property: CSP always contains frame-ancestors none', () => {
        const urlArbitrary = fc.oneof(
            fc.constant('/'),
            fc.constant('/api/cameras'),
            fc.constant('/api/auth/login'),
            fc.string({ minLength: 1, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9\-_\/]+$/.test(s))
                .map(s => '/' + s)
        );

        fc.assert(
            fc.property(urlArbitrary, (url) => {
                const headers = getSecurityHeaders(url);
                const csp = headers['Content-Security-Policy'];
                
                // CSP must contain frame-ancestors 'none'
                expect(csp).toContain("frame-ancestors 'none'");
            }),
            { numRuns: 100 }
        );
    });
});
