/**
 * Property-Based Tests for API Key Validation
 * 
 * **Property 1: API Key Validation Consistency**
 * **Validates: Requirements 1.1, 1.2, 1.3**
 * 
 * Feature: api-security-hardening, Property 1: API Key Validation Consistency
 * 
 * For any request to a protected endpoint, if the request contains a valid API key,
 * the request SHALL be allowed to proceed; if the request contains an invalid, missing,
 * or expired API key, the request SHALL be rejected with 403 status.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    generateApiKey,
    hashApiKey,
    timingSafeEqual,
    validateApiKey,
    API_KEY_CONFIG
} from '../services/apiKeyService.js';
import {
    isPublicEndpoint,
    extractApiKey,
    API_KEY_VALIDATOR_CONFIG
} from '../middleware/apiKeyValidator.js';
import { execute, query } from '../database/database.js';

// Custom arbitrary for hex strings (fast-check doesn't have hexaString)
const hexStringArbitrary = (minLength, maxLength) => 
    fc.array(
        fc.integer({ min: 0, max: 15 }).map(n => n.toString(16)),
        { minLength, maxLength }
    ).map(arr => arr.join(''));

// Helper to clean up test API keys
function cleanupTestApiKeys() {
    try {
        execute('DELETE FROM api_keys WHERE client_name LIKE ?', ['test_%']);
    } catch (error) {
        // Table might not exist in test environment
    }
}

// Helper to create a test API key directly in database
function createTestApiKey(clientName, isActive = 1, expiresAt = null) {
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    
    try {
        execute(`
            INSERT INTO api_keys (key_hash, client_name, expires_at, is_active)
            VALUES (?, ?, ?, ?)
        `, [keyHash, clientName, expiresAt, isActive]);
    } catch (error) {
        // Table might not exist
    }
    
    return apiKey;
}

describe('API Key Validator Property Tests', () => {
    beforeEach(() => {
        cleanupTestApiKeys();
    });

    afterEach(() => {
        cleanupTestApiKeys();
    });

    /**
     * Property 1: API Key Validation Consistency
     * 
     * For any valid API key, validation should consistently return valid=true.
     * For any invalid API key, validation should consistently return valid=false.
     * 
     * **Validates: Requirements 1.1, 1.2, 1.3**
     */
    describe('Property 1: API Key Validation Consistency', () => {
        it('Valid API keys are always accepted', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    (testNum) => {
                        // Create a valid API key
                        const clientName = `test_valid_${testNum}`;
                        const apiKey = createTestApiKey(clientName);
                        
                        // Validate multiple times - should always be valid
                        const result1 = validateApiKey(apiKey);
                        const result2 = validateApiKey(apiKey);
                        const result3 = validateApiKey(apiKey);
                        
                        expect(result1.valid).toBe(true);
                        expect(result2.valid).toBe(true);
                        expect(result3.valid).toBe(true);
                        expect(result1.clientName).toBe(clientName);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Invalid API keys are always rejected', () => {
            // Generate arbitrary strings that are NOT valid API keys
            const invalidKeyArbitrary = fc.oneof(
                // Empty string
                fc.constant(''),
                // Too short
                hexStringArbitrary(1, 63),
                // Too long
                hexStringArbitrary(65, 128),
                // Non-hex characters
                fc.string({ minLength: 64, maxLength: 64 })
                    .filter(s => !/^[a-f0-9]+$/i.test(s)),
                // Random valid-looking but non-existent keys
                hexStringArbitrary(64, 64)
            );

            fc.assert(
                fc.property(invalidKeyArbitrary, (invalidKey) => {
                    const result = validateApiKey(invalidKey);
                    expect(result.valid).toBe(false);
                    expect(result.reason).not.toBeNull();
                }),
                { numRuns: 100 }
            );
        });

        it('Missing API keys are rejected with reason "missing"', () => {
            const missingKeyArbitrary = fc.constantFrom(null, undefined, '');

            fc.assert(
                fc.property(missingKeyArbitrary, (missingKey) => {
                    const result = validateApiKey(missingKey);
                    expect(result.valid).toBe(false);
                    expect(result.reason).toBe('missing');
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property: API key generation produces valid format
     * 
     * For any generated API key, it should be exactly 64 hex characters.
     */
    it('Property: Generated API keys have correct format', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 1000 }), () => {
                const apiKey = generateApiKey();
                
                // Should be exactly 64 characters
                expect(apiKey.length).toBe(64);
                
                // Should be valid hex
                expect(/^[a-f0-9]+$/i.test(apiKey)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: API key hashing is deterministic
     * 
     * For any API key, hashing it multiple times should produce the same result.
     */
    it('Property: API key hashing is deterministic', () => {
        fc.assert(
            fc.property(hexStringArbitrary(64, 64), (apiKey) => {
                const hash1 = hashApiKey(apiKey);
                const hash2 = hashApiKey(apiKey);
                const hash3 = hashApiKey(apiKey);
                
                expect(hash1).toBe(hash2);
                expect(hash2).toBe(hash3);
                
                // Hash should be 64 characters (SHA-256 hex)
                expect(hash1.length).toBe(64);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Different API keys produce different hashes
     * 
     * For any two different API keys, their hashes should be different.
     */
    it('Property: Different API keys produce different hashes', () => {
        fc.assert(
            fc.property(
                hexStringArbitrary(64, 64),
                hexStringArbitrary(64, 64),
                (key1, key2) => {
                    // Skip if keys are the same
                    if (key1 === key2) return true;
                    
                    const hash1 = hashApiKey(key1);
                    const hash2 = hashApiKey(key2);
                    
                    expect(hash1).not.toBe(hash2);
                    return true;
                }
            ),
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
     * Property: Public endpoint detection is consistent
     * 
     * For any URL, isPublicEndpoint should return the same result on repeated calls.
     */
    it('Property: Public endpoint detection is consistent', () => {
        const urlArbitrary = fc.oneof(
            // Public endpoints
            fc.constant('/health'),
            fc.constant('/api/auth/login'),
            fc.constant('/api/cameras/active'),
            fc.constant('/api/stream'),
            fc.constant('/api/stream/camera1'),
            fc.constant('/api/areas/public'),
            // Protected endpoints
            fc.constant('/api/cameras'),
            fc.constant('/api/admin/api-keys'),
            fc.constant('/api/users'),
            fc.constant('/api/auth/logout'),
            // Random paths
            fc.string({ minLength: 1, maxLength: 50 })
                .filter(s => /^[a-zA-Z0-9\-_\/]+$/.test(s))
                .map(s => '/' + s)
        );

        fc.assert(
            fc.property(urlArbitrary, (url) => {
                const result1 = isPublicEndpoint(url);
                const result2 = isPublicEndpoint(url);
                const result3 = isPublicEndpoint(url);
                
                expect(result1).toBe(result2);
                expect(result2).toBe(result3);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Known public endpoints are correctly identified
     * 
     * All configured public endpoints should return true.
     */
    it('Property: Known public endpoints are correctly identified', () => {
        const publicEndpointArbitrary = fc.constantFrom(
            '/health',
            '/api/auth/login',
            '/api/cameras/active',
            '/api/stream',
            '/api/areas/public'
        );

        fc.assert(
            fc.property(publicEndpointArbitrary, (endpoint) => {
                expect(isPublicEndpoint(endpoint)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Stream endpoints with any camera ID are public
     * 
     * /api/stream/* should always be public.
     */
    it('Property: Stream endpoints with any camera ID are public', () => {
        const cameraIdArbitrary = fc.oneof(
            fc.integer({ min: 1, max: 1000 }).map(String),
            fc.string({ minLength: 1, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9\-_]+$/.test(s))
        );

        fc.assert(
            fc.property(cameraIdArbitrary, (cameraId) => {
                const url = `/api/stream/${cameraId}`;
                expect(isPublicEndpoint(url)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Protected endpoints are correctly identified
     * 
     * Non-public endpoints should return false.
     */
    it('Property: Protected endpoints are correctly identified', () => {
        const protectedEndpointArbitrary = fc.constantFrom(
            '/api/cameras',
            '/api/cameras/1',
            '/api/admin/api-keys',
            '/api/admin/stats',
            '/api/users',
            '/api/auth/logout',
            '/api/auth/verify'
        );

        fc.assert(
            fc.property(protectedEndpointArbitrary, (endpoint) => {
                expect(isPublicEndpoint(endpoint)).toBe(false);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: API key extraction from request headers
     * 
     * extractApiKey should correctly extract the X-API-Key header.
     */
    it('Property: API key extraction from request headers', () => {
        const apiKeyArbitrary = hexStringArbitrary(64, 64);

        fc.assert(
            fc.property(apiKeyArbitrary, (apiKey) => {
                const mockRequest = {
                    headers: {
                        'x-api-key': apiKey
                    }
                };
                
                const extracted = extractApiKey(mockRequest);
                expect(extracted).toBe(apiKey);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Missing API key header returns null
     */
    it('Property: Missing API key header returns null', () => {
        const headersArbitrary = fc.record({
            'content-type': fc.constant('application/json'),
            'user-agent': fc.string()
        });

        fc.assert(
            fc.property(headersArbitrary, (headers) => {
                const mockRequest = { headers };
                const extracted = extractApiKey(mockRequest);
                expect(extracted).toBeNull();
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: API key format validation
     * 
     * Keys with invalid format should be rejected with reason "invalid_format".
     */
    it('Property: Invalid format keys are rejected', () => {
        const invalidFormatArbitrary = fc.oneof(
            // Too short
            hexStringArbitrary(1, 63),
            // Too long
            hexStringArbitrary(65, 128),
            // Contains non-hex characters
            fc.string({ minLength: 64, maxLength: 64 })
                .filter(s => s.length === 64 && !/^[a-f0-9]+$/i.test(s))
        );

        fc.assert(
            fc.property(invalidFormatArbitrary, (invalidKey) => {
                const result = validateApiKey(invalidKey);
                expect(result.valid).toBe(false);
                expect(['invalid_format', 'invalid']).toContain(result.reason);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: API key config values are valid
     */
    it('Property: API key config values are valid', () => {
        expect(API_KEY_CONFIG.keyLength).toBe(32);
        expect(API_KEY_CONFIG.headerName).toBe('X-API-Key');
        expect(API_KEY_CONFIG.rotationDays).toBeGreaterThan(0);
    });
});
