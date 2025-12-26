/**
 * Property-Based Tests for Session Manager
 * 
 * **Property 6: Token Fingerprint Binding**
 * **Validates: Requirements 4.3, 4.4**
 * 
 * **Property 7: Token Lifecycle Management**
 * **Validates: Requirements 4.5, 4.6, 4.7**
 * 
 * Feature: api-security-hardening, Property 6 & 7: Session Management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    generateFingerprint,
    createTokenPair,
    validateFingerprint,
    isSessionExpired,
    hashToken,
    blacklistToken,
    isTokenBlacklisted,
    rotateTokens,
    cleanupExpiredBlacklistEntries,
    getSessionConfig
} from '../services/sessionManager.js';
import { execute } from '../database/database.js';

// Mock Fastify JWT instance
const createMockFastify = () => ({
    jwt: {
        sign: (payload, options = {}) => {
            // Create a simple mock token
            const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
            const payloadStr = Buffer.from(JSON.stringify({
                ...payload,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString('base64');
            const signature = Buffer.from('mock-signature-' + Math.random()).toString('base64');
            return `${header}.${payloadStr}.${signature}`;
        },
        verify: (token) => {
            try {
                const parts = token.split('.');
                if (parts.length !== 3) throw new Error('Invalid token');
                return JSON.parse(Buffer.from(parts[1], 'base64').toString());
            } catch {
                throw new Error('Invalid token');
            }
        }
    }
});

// Mock request object
const createMockRequest = (ip, userAgent) => ({
    ip: ip,
    headers: {
        'user-agent': userAgent,
        'x-forwarded-for': null
    }
});

// Helper to clear token blacklist
function clearBlacklist() {
    try {
        execute('DELETE FROM token_blacklist');
    } catch (error) {
        // Table might not exist in test environment
    }
}

describe('Session Manager Property Tests', () => {
    beforeEach(() => {
        clearBlacklist();
    });

    afterEach(() => {
        clearBlacklist();
    });

    /**
     * Property 6: Token Fingerprint Binding
     * 
     * For any JWT token, if the token is used from a client with a different 
     * fingerprint (IP + User-Agent hash) than the one recorded at token creation, 
     * the token SHALL be invalidated and the request SHALL require re-authentication.
     * 
     * **Validates: Requirements 4.3, 4.4**
     */
    describe('Property 6: Token Fingerprint Binding', () => {
        it('Fingerprint is deterministic for same IP and User-Agent', () => {
            const ipArbitrary = fc.ipV4();
            const userAgentArbitrary = fc.string({ minLength: 10, maxLength: 200 });

            fc.assert(
                fc.property(ipArbitrary, userAgentArbitrary, (ip, userAgent) => {
                    const request1 = createMockRequest(ip, userAgent);
                    const request2 = createMockRequest(ip, userAgent);

                    const fingerprint1 = generateFingerprint(request1);
                    const fingerprint2 = generateFingerprint(request2);

                    // Same inputs should produce same fingerprint
                    expect(fingerprint1).toBe(fingerprint2);
                    // Fingerprint should be a 64-character hex string (SHA256)
                    expect(fingerprint1).toMatch(/^[a-f0-9]{64}$/);
                }),
                { numRuns: 100 }
            );
        });

        it('Different IPs produce different fingerprints', () => {
            fc.assert(
                fc.property(fc.ipV4(), fc.ipV4(), (ip1, ip2) => {
                    // Skip if IPs are the same
                    if (ip1 === ip2) return true;

                    const userAgent = 'Mozilla/5.0 Test Browser';
                    const request1 = createMockRequest(ip1, userAgent);
                    const request2 = createMockRequest(ip2, userAgent);

                    const fingerprint1 = generateFingerprint(request1);
                    const fingerprint2 = generateFingerprint(request2);

                    // Different IPs should produce different fingerprints
                    expect(fingerprint1).not.toBe(fingerprint2);
                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('Different User-Agents produce different fingerprints', () => {
            const userAgentArbitrary = fc.string({ minLength: 10, maxLength: 100 });

            fc.assert(
                fc.property(userAgentArbitrary, userAgentArbitrary, (ua1, ua2) => {
                    // Skip if user agents are the same
                    if (ua1 === ua2) return true;

                    const ip = '192.168.1.1';
                    const request1 = createMockRequest(ip, ua1);
                    const request2 = createMockRequest(ip, ua2);

                    const fingerprint1 = generateFingerprint(request1);
                    const fingerprint2 = generateFingerprint(request2);

                    // Different user agents should produce different fingerprints
                    expect(fingerprint1).not.toBe(fingerprint2);
                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('Token fingerprint validation succeeds for matching fingerprints', () => {
            const ipArbitrary = fc.ipV4();
            const userAgentArbitrary = fc.string({ minLength: 10, maxLength: 100 });

            fc.assert(
                fc.property(ipArbitrary, userAgentArbitrary, (ip, userAgent) => {
                    const request = createMockRequest(ip, userAgent);
                    const fingerprint = generateFingerprint(request);

                    const tokenPayload = {
                        id: 1,
                        username: 'testuser',
                        fingerprint: fingerprint
                    };

                    // Validation should succeed for matching fingerprint
                    expect(validateFingerprint(tokenPayload, fingerprint)).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('Token fingerprint validation fails for mismatched fingerprints', () => {
            fc.assert(
                fc.property(fc.ipV4(), fc.ipV4(), (ip1, ip2) => {
                    // Skip if IPs are the same
                    if (ip1 === ip2) return true;

                    const userAgent = 'Mozilla/5.0 Test';
                    const request1 = createMockRequest(ip1, userAgent);
                    const request2 = createMockRequest(ip2, userAgent);

                    const originalFingerprint = generateFingerprint(request1);
                    const differentFingerprint = generateFingerprint(request2);

                    const tokenPayload = {
                        id: 1,
                        username: 'testuser',
                        fingerprint: originalFingerprint
                    };

                    // Validation should fail for different fingerprint
                    expect(validateFingerprint(tokenPayload, differentFingerprint)).toBe(false);
                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('Token pair includes fingerprint in both tokens', () => {
            const ipArbitrary = fc.ipV4();
            const userAgentArbitrary = fc.string({ minLength: 10, maxLength: 100 });

            fc.assert(
                fc.property(ipArbitrary, userAgentArbitrary, (ip, userAgent) => {
                    const mockFastify = createMockFastify();
                    const request = createMockRequest(ip, userAgent);
                    const fingerprint = generateFingerprint(request);

                    const user = { id: 1, username: 'testuser', role: 'admin' };
                    const { accessToken, refreshToken } = createTokenPair(mockFastify, user, fingerprint);

                    // Decode tokens and verify fingerprint
                    const accessPayload = mockFastify.jwt.verify(accessToken);
                    const refreshPayload = mockFastify.jwt.verify(refreshToken);

                    expect(accessPayload.fingerprint).toBe(fingerprint);
                    expect(refreshPayload.fingerprint).toBe(fingerprint);
                }),
                { numRuns: 100 }
            );
        });
    });


    /**
     * Property 7: Token Lifecycle Management
     * 
     * For any token that has been blacklisted (via logout or invalidation), 
     * subsequent requests using that token SHALL be rejected; 
     * for any refresh operation, a new token pair SHALL be issued and 
     * the old tokens SHALL be blacklisted.
     * 
     * **Validates: Requirements 4.5, 4.6, 4.7**
     */
    describe('Property 7: Token Lifecycle Management', () => {
        it('Blacklisted tokens are detected as blacklisted', () => {
            const tokenArbitrary = fc.string({ minLength: 50, maxLength: 200 });

            fc.assert(
                fc.property(tokenArbitrary, (token) => {
                    clearBlacklist();

                    // Token should not be blacklisted initially
                    expect(isTokenBlacklisted(token)).toBe(false);

                    // Blacklist the token
                    blacklistToken(token, 1, 'test');

                    // Token should now be blacklisted
                    expect(isTokenBlacklisted(token)).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('Token hash is deterministic', () => {
            const tokenArbitrary = fc.string({ minLength: 20, maxLength: 200 });

            fc.assert(
                fc.property(tokenArbitrary, (token) => {
                    const hash1 = hashToken(token);
                    const hash2 = hashToken(token);

                    // Same token should produce same hash
                    expect(hash1).toBe(hash2);
                    // Hash should be a 64-character hex string (SHA256)
                    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
                }),
                { numRuns: 100 }
            );
        });

        it('Different tokens produce different hashes', () => {
            const tokenArbitrary = fc.string({ minLength: 20, maxLength: 200 });

            fc.assert(
                fc.property(tokenArbitrary, tokenArbitrary, (token1, token2) => {
                    // Skip if tokens are the same
                    if (token1 === token2) return true;

                    const hash1 = hashToken(token1);
                    const hash2 = hashToken(token2);

                    // Different tokens should produce different hashes
                    expect(hash1).not.toBe(hash2);
                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('Token rotation blacklists old tokens and creates new ones', () => {
            const ipArbitrary = fc.ipV4();

            fc.assert(
                fc.property(ipArbitrary, (ip) => {
                    clearBlacklist();

                    const mockFastify = createMockFastify();
                    const request = createMockRequest(ip, 'Mozilla/5.0');
                    const fingerprint = generateFingerprint(request);
                    const user = { id: 1, username: 'testuser', role: 'admin' };

                    // Create initial token pair
                    const { accessToken: oldAccess, refreshToken: oldRefresh } = 
                        createTokenPair(mockFastify, user, fingerprint);

                    // Old tokens should not be blacklisted
                    expect(isTokenBlacklisted(oldAccess)).toBe(false);
                    expect(isTokenBlacklisted(oldRefresh)).toBe(false);

                    // Rotate tokens
                    const { accessToken: newAccess, refreshToken: newRefresh } = 
                        rotateTokens(mockFastify, oldAccess, oldRefresh, user, fingerprint);

                    // Old tokens should now be blacklisted
                    expect(isTokenBlacklisted(oldAccess)).toBe(true);
                    expect(isTokenBlacklisted(oldRefresh)).toBe(true);

                    // New tokens should not be blacklisted
                    expect(isTokenBlacklisted(newAccess)).toBe(false);
                    expect(isTokenBlacklisted(newRefresh)).toBe(false);

                    // New tokens should be different from old ones
                    expect(newAccess).not.toBe(oldAccess);
                    expect(newRefresh).not.toBe(oldRefresh);
                }),
                { numRuns: 100 }
            );
        });

        it('Session expiry is detected correctly', () => {
            fc.assert(
                fc.property(fc.integer({ min: 1, max: 48 }), (hoursAgo) => {
                    const sessionConfig = getSessionConfig();
                    const absoluteTimeoutMs = sessionConfig.absoluteTimeout;
                    const absoluteTimeoutHours = absoluteTimeoutMs / (60 * 60 * 1000);

                    const sessionCreatedAt = Date.now() - (hoursAgo * 60 * 60 * 1000);
                    const tokenPayload = {
                        id: 1,
                        username: 'testuser',
                        sessionCreatedAt: sessionCreatedAt
                    };

                    const isExpired = isSessionExpired(tokenPayload);

                    // Session should be expired if strictly older than absolute timeout
                    // The implementation uses > (strictly greater than), so exactly 24 hours is NOT expired
                    if (hoursAgo > absoluteTimeoutHours) {
                        expect(isExpired).toBe(true);
                    } else {
                        expect(isExpired).toBe(false);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('Token pair contains correct token types', () => {
            const ipArbitrary = fc.ipV4();

            fc.assert(
                fc.property(ipArbitrary, (ip) => {
                    const mockFastify = createMockFastify();
                    const request = createMockRequest(ip, 'Mozilla/5.0');
                    const fingerprint = generateFingerprint(request);
                    const user = { id: 1, username: 'testuser', role: 'admin' };

                    const { accessToken, refreshToken } = createTokenPair(mockFastify, user, fingerprint);

                    // Decode and verify token types
                    const accessPayload = mockFastify.jwt.verify(accessToken);
                    const refreshPayload = mockFastify.jwt.verify(refreshToken);

                    expect(accessPayload.type).toBe('access');
                    expect(refreshPayload.type).toBe('refresh');
                }),
                { numRuns: 100 }
            );
        });

        it('Token pair contains session creation timestamp', () => {
            const ipArbitrary = fc.ipV4();

            fc.assert(
                fc.property(ipArbitrary, (ip) => {
                    const beforeCreation = Date.now();

                    const mockFastify = createMockFastify();
                    const request = createMockRequest(ip, 'Mozilla/5.0');
                    const fingerprint = generateFingerprint(request);
                    const user = { id: 1, username: 'testuser', role: 'admin' };

                    const { accessToken, refreshToken, sessionCreatedAt } = 
                        createTokenPair(mockFastify, user, fingerprint);

                    const afterCreation = Date.now();

                    // Session creation time should be within the test window
                    expect(sessionCreatedAt).toBeGreaterThanOrEqual(beforeCreation);
                    expect(sessionCreatedAt).toBeLessThanOrEqual(afterCreation);

                    // Both tokens should have the same session creation time
                    const accessPayload = mockFastify.jwt.verify(accessToken);
                    const refreshPayload = mockFastify.jwt.verify(refreshToken);

                    expect(accessPayload.sessionCreatedAt).toBe(sessionCreatedAt);
                    expect(refreshPayload.sessionCreatedAt).toBe(sessionCreatedAt);
                }),
                { numRuns: 100 }
            );
        });

        it('Blacklist entries can be cleaned up', () => {
            // This test verifies the cleanup function works
            clearBlacklist();

            // Add some tokens to blacklist
            blacklistToken('token1', 1, 'test');
            blacklistToken('token2', 1, 'test');

            // Verify they are blacklisted
            expect(isTokenBlacklisted('token1')).toBe(true);
            expect(isTokenBlacklisted('token2')).toBe(true);

            // Cleanup should not remove non-expired entries
            const cleaned = cleanupExpiredBlacklistEntries();
            expect(cleaned).toBe(0);

            // Tokens should still be blacklisted
            expect(isTokenBlacklisted('token1')).toBe(true);
            expect(isTokenBlacklisted('token2')).toBe(true);
        });
    });

    /**
     * Additional Session Configuration Tests
     */
    describe('Session Configuration', () => {
        it('Session config has correct values', () => {
            const config = getSessionConfig();

            // Access token expiry should be 1 hour
            expect(config.accessTokenExpiry).toBe('1h');

            // Refresh token expiry should be 7 days
            expect(config.refreshTokenExpiry).toBe('7d');

            // Absolute timeout should be 24 hours in milliseconds
            expect(config.absoluteTimeout).toBe(24 * 60 * 60 * 1000);
        });

        it('Fingerprint validation handles missing fingerprint in token', () => {
            const tokenPayload = {
                id: 1,
                username: 'testuser'
                // No fingerprint
            };

            // Should return false for missing fingerprint
            expect(validateFingerprint(tokenPayload, 'some-fingerprint')).toBe(false);
        });

        it('Fingerprint validation handles null token payload', () => {
            expect(validateFingerprint(null, 'some-fingerprint')).toBe(false);
            expect(validateFingerprint(undefined, 'some-fingerprint')).toBe(false);
        });

        it('Session expiry handles missing sessionCreatedAt', () => {
            const tokenPayload = {
                id: 1,
                username: 'testuser'
                // No sessionCreatedAt
            };

            // Should return true (expired) for missing timestamp
            expect(isSessionExpired(tokenPayload)).toBe(true);
        });

        it('Session expiry handles null token payload', () => {
            expect(isSessionExpired(null)).toBe(true);
            expect(isSessionExpired(undefined)).toBe(true);
        });
    });
});
