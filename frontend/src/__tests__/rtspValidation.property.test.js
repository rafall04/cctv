import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateRtspUrl, isValidRtspUrl, createRtspValidationRule } from '../utils/validators';

/**
 * Feature: admin-ux-improvement
 * Property Tests for RTSP URL Validation
 * 
 * Property 7: RTSP URL Validation
 * Validates: Requirements 4.3
 * 
 * For any string input as RTSP URL, the validation SHALL return true only if
 * the string starts with "rtsp://" and contains a valid host portion;
 * all other strings SHALL return false with appropriate error message.
 */

describe('RTSP URL Validation', () => {
    /**
     * Feature: admin-ux-improvement
     * Property 7: RTSP URL Validation - Valid URLs
     * Validates: Requirements 4.3
     * 
     * For any valid RTSP URL (starting with rtsp:// and containing a valid host),
     * the validation SHALL return isValid: true.
     */
    it('Property 7: should accept valid RTSP URLs with host', () => {
        // Generate valid hostnames
        const validHostArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$/)
            .filter(s => s.length >= 2 && s.length <= 30);
        
        fc.assert(
            fc.property(
                validHostArb,
                (host) => {
                    const url = `rtsp://${host}`;
                    const result = validateRtspUrl(url);
                    
                    expect(result.isValid).toBe(true);
                    expect(result.error).toBe('');
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Valid RTSP URLs with IP addresses
     */
    it('Property 7: should accept valid RTSP URLs with IP addresses', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    fc.integer({ min: 1, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 1, max: 254 })
                ),
                ([a, b, c, d]) => {
                    const url = `rtsp://${a}.${b}.${c}.${d}`;
                    const result = validateRtspUrl(url);
                    
                    expect(result.isValid).toBe(true);
                    expect(result.error).toBe('');
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Valid RTSP URLs with port
     */
    it('Property 7: should accept valid RTSP URLs with port', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    fc.integer({ min: 1, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 1, max: 254 }),
                    fc.integer({ min: 1, max: 65535 })
                ),
                ([a, b, c, d, port]) => {
                    const url = `rtsp://${a}.${b}.${c}.${d}:${port}`;
                    const result = validateRtspUrl(url);
                    
                    expect(result.isValid).toBe(true);
                    expect(result.error).toBe('');
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Valid RTSP URLs with path
     */
    it('Property 7: should accept valid RTSP URLs with path', () => {
        const pathArb = fc.stringMatching(/^\/[a-zA-Z0-9_\/-]*$/)
            .filter(s => s.length >= 1 && s.length <= 50);
        
        fc.assert(
            fc.property(
                fc.tuple(
                    fc.integer({ min: 1, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 1, max: 254 })
                ),
                pathArb,
                ([a, b, c, d], path) => {
                    const url = `rtsp://${a}.${b}.${c}.${d}${path}`;
                    const result = validateRtspUrl(url);
                    
                    expect(result.isValid).toBe(true);
                    expect(result.error).toBe('');
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Valid RTSP URLs with credentials
     */
    it('Property 7: should accept valid RTSP URLs with credentials', () => {
        const usernameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]*$/)
            .filter(s => s.length >= 1 && s.length <= 20);
        const passwordArb = fc.stringMatching(/^[a-zA-Z0-9]+$/)
            .filter(s => s.length >= 1 && s.length <= 20);
        
        fc.assert(
            fc.property(
                usernameArb,
                passwordArb,
                fc.tuple(
                    fc.integer({ min: 1, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 1, max: 254 })
                ),
                (username, password, [a, b, c, d]) => {
                    const url = `rtsp://${username}:${password}@${a}.${b}.${c}.${d}`;
                    const result = validateRtspUrl(url);
                    
                    expect(result.isValid).toBe(true);
                    expect(result.error).toBe('');
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Invalid URLs - wrong protocol
     */
    it('Property 7: should reject URLs with wrong protocol', () => {
        const protocols = ['http://', 'https://', 'ftp://', 'rtsps://', 'file://', ''];
        
        fc.assert(
            fc.property(
                fc.constantFrom(...protocols),
                fc.stringMatching(/^[a-zA-Z0-9.-]+$/).filter(s => s.length >= 1 && s.length <= 30),
                (protocol, host) => {
                    const url = `${protocol}${host}`;
                    const result = validateRtspUrl(url);
                    
                    expect(result.isValid).toBe(false);
                    expect(result.error).toBeTruthy();
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: Invalid URLs - missing host
     */
    it('Property 7: should reject RTSP URLs without host', () => {
        const invalidUrls = [
            'rtsp://',
            'rtsp:// ',
            'rtsp://  ',
        ];
        
        invalidUrls.forEach(url => {
            const result = validateRtspUrl(url);
            expect(result.isValid).toBe(false);
            expect(result.error).toBeTruthy();
        });
    });

    /**
     * Property 7: Empty/null/undefined values
     */
    it('Property 7: should reject empty, null, and undefined values', () => {
        const emptyValues = ['', null, undefined, '   '];
        
        emptyValues.forEach(value => {
            const result = validateRtspUrl(value);
            expect(result.isValid).toBe(false);
            expect(result.error).toBeTruthy();
        });
    });

    /**
     * Property 7: Random strings without rtsp:// should be rejected
     */
    it('Property 7: should reject random strings without rtsp:// prefix', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }).filter(
                    s => !s.toLowerCase().startsWith('rtsp://')
                ),
                (randomString) => {
                    const result = validateRtspUrl(randomString);
                    
                    expect(result.isValid).toBe(false);
                    expect(result.error).toBeTruthy();
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: isValidRtspUrl should match validateRtspUrl.isValid
     */
    it('Property 7: isValidRtspUrl should be consistent with validateRtspUrl', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    // Valid URLs
                    fc.tuple(
                        fc.integer({ min: 1, max: 255 }),
                        fc.integer({ min: 0, max: 255 }),
                        fc.integer({ min: 0, max: 255 }),
                        fc.integer({ min: 1, max: 254 })
                    ).map(([a, b, c, d]) => `rtsp://${a}.${b}.${c}.${d}`),
                    // Invalid URLs
                    fc.string({ minLength: 0, maxLength: 50 })
                ),
                (url) => {
                    const validateResult = validateRtspUrl(url);
                    const isValidResult = isValidRtspUrl(url);
                    
                    expect(isValidResult).toBe(validateResult.isValid);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 7: createRtspValidationRule should work with form validation
     */
    it('Property 7: createRtspValidationRule should return correct validation rule', () => {
        const rule = createRtspValidationRule({ required: true });
        
        // Should have required property
        expect(rule.required).toBeTruthy();
        
        // Should have custom validation function
        expect(typeof rule.custom).toBe('function');
        
        // Test custom function with valid URL
        const validResult = rule.custom('rtsp://192.168.1.1');
        expect(validResult).toBeUndefined();
        
        // Test custom function with invalid URL
        const invalidResult = rule.custom('http://example.com');
        expect(invalidResult).toBeTruthy();
    });

    /**
     * Property 7: Non-required RTSP field should accept empty values
     */
    it('Property 7: non-required RTSP field should accept empty values', () => {
        const rule = createRtspValidationRule({ required: false });
        
        // Empty values should be valid when not required
        expect(rule.custom('')).toBeUndefined();
        expect(rule.custom('   ')).toBeUndefined();
        
        // But invalid URLs should still be rejected
        expect(rule.custom('http://example.com')).toBeTruthy();
    });

    /**
     * Additional: Common real-world RTSP URL formats
     */
    it('should accept common real-world RTSP URL formats', () => {
        const realWorldUrls = [
            'rtsp://192.168.1.100:554/stream',
            'rtsp://admin:password@192.168.1.100:554/cam/realmonitor',
            'rtsp://192.168.1.100/live/ch00_0',
            'rtsp://camera.local:8554/stream1',
            'rtsp://10.0.0.1:554/h264/ch1/main/av_stream',
        ];
        
        realWorldUrls.forEach(url => {
            const result = validateRtspUrl(url);
            expect(result.isValid).toBe(true);
            expect(result.error).toBe('');
        });
    });
});
