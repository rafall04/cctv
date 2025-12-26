/**
 * Property-Based Tests for Security Audit Logger
 * 
 * **Property 8: Security Event Logging Completeness**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8**
 * 
 * Feature: api-security-hardening, Property 8: Security Event Logging Completeness
 * 
 * For any security-relevant event (authentication attempt, rate limit violation, 
 * API key failure, CSRF failure, account lockout, admin action), a log entry 
 * SHALL be created containing timestamp, IP address, fingerprint, and event-specific details.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    SECURITY_EVENTS,
    LOG_RETENTION_DAYS,
    generateFingerprint,
    logSecurityEvent,
    logAuthAttempt,
    logRateLimitViolation,
    logApiKeyFailure,
    logCsrfFailure,
    logAccountLockout,
    logAdminAction,
    logSessionCreated,
    logSessionInvalidated,
    logPasswordChanged,
    logUserCreated,
    logUserDeleted,
    logCameraCreated,
    logCameraDeleted,
    getRecentLogs,
    cleanupOldLogs
} from '../services/securityAuditLogger.js';
import { execute, query } from '../database/database.js';

// Helper to create mock request object
function createMockRequest(ip = '192.168.1.1', userAgent = 'TestAgent/1.0') {
    return {
        ip: ip,
        headers: {
            'user-agent': userAgent,
            'x-forwarded-for': ip
        },
        url: '/api/test'
    };
}

// Helper to clear security logs for testing
function clearSecurityLogs() {
    try {
        execute('DELETE FROM security_logs');
    } catch (error) {
        // Table might not exist in test environment
    }
}

describe('Security Audit Logger Property Tests', () => {
    beforeEach(() => {
        clearSecurityLogs();
    });

    afterEach(() => {
        clearSecurityLogs();
    });


    /**
     * Property 8: Security Event Logging Completeness
     * 
     * For any security event, the log entry SHALL contain:
     * - timestamp (ISO format)
     * - IP address
     * - fingerprint
     * - event-specific details
     * 
     * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8**
     */
    describe('Property 8: Security Event Logging Completeness', () => {
        
        it('All security events contain required fields (timestamp, IP, fingerprint)', () => {
            const eventTypeArbitrary = fc.constantFrom(...Object.values(SECURITY_EVENTS));
            const ipArbitrary = fc.ipV4();
            const userAgentArbitrary = fc.string({ minLength: 5, maxLength: 100 })
                .filter(s => /^[a-zA-Z0-9\s\/\.\-_]+$/.test(s));
            const usernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

            fc.assert(
                fc.property(
                    eventTypeArbitrary,
                    ipArbitrary,
                    userAgentArbitrary,
                    usernameArbitrary,
                    (eventType, ip, userAgent, username) => {
                        const mockRequest = createMockRequest(ip, userAgent);
                        
                        const entry = logSecurityEvent(eventType, {
                            username: username,
                            action: 'test_action'
                        }, mockRequest);
                        
                        // Verify required fields are present
                        expect(entry.event_type).toBe(eventType);
                        expect(entry.timestamp).toBeDefined();
                        expect(entry.ip_address).toBe(ip);
                        expect(entry.fingerprint).toBeDefined();
                        expect(entry.fingerprint.length).toBeGreaterThan(0);
                        
                        // Verify timestamp is valid ISO format
                        const parsedDate = new Date(entry.timestamp);
                        expect(parsedDate.toISOString()).toBe(entry.timestamp);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('Authentication attempts (success/failure) are logged with username and IP', () => {
            const successArbitrary = fc.boolean();
            const ipArbitrary = fc.ipV4();
            const usernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

            fc.assert(
                fc.property(
                    successArbitrary,
                    ipArbitrary,
                    usernameArbitrary,
                    (success, ip, username) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logAuthAttempt(success, {
                            username: username,
                            reason: success ? 'valid_credentials' : 'invalid_password'
                        }, mockRequest);
                        
                        // Verify event type matches success/failure
                        const expectedType = success 
                            ? SECURITY_EVENTS.AUTH_SUCCESS 
                            : SECURITY_EVENTS.AUTH_FAILURE;
                        expect(entry.event_type).toBe(expectedType);
                        
                        // Verify username is captured
                        expect(entry.username).toBe(username);
                        
                        // Verify IP is captured
                        expect(entry.ip_address).toBe(ip);
                        
                        // Verify fingerprint is present
                        expect(entry.fingerprint).toBeDefined();
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('Rate limit violations are logged with endpoint and limit details', () => {
            const ipArbitrary = fc.ipV4();
            const endpointArbitrary = fc.constantFrom(
                '/api/auth/login',
                '/api/cameras',
                '/api/admin/users'
            );
            const limitArbitrary = fc.integer({ min: 10, max: 100 });
            const retryAfterArbitrary = fc.integer({ min: 1, max: 60 });

            fc.assert(
                fc.property(
                    ipArbitrary,
                    endpointArbitrary,
                    limitArbitrary,
                    retryAfterArbitrary,
                    (ip, endpoint, limit, retryAfter) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logRateLimitViolation({
                            ip: ip,
                            url: endpoint,
                            endpointType: 'public',
                            limit: limit,
                            windowSeconds: 60,
                            retryAfter: retryAfter
                        }, mockRequest);
                        
                        // Verify event type
                        expect(entry.event_type).toBe(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED);
                        
                        // Verify IP is captured
                        expect(entry.ip_address).toBe(ip);
                        
                        // Verify endpoint is captured
                        expect(entry.endpoint).toBe(endpoint);
                        
                        // Verify details contain limit info
                        const details = JSON.parse(entry.details);
                        expect(details.limit).toBe(limit);
                        expect(details.retry_after).toBe(retryAfter);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('API key failures are logged with reason and endpoint', () => {
            const ipArbitrary = fc.ipV4();
            const reasonArbitrary = fc.constantFrom('missing', 'invalid', 'expired', 'revoked');
            const endpointArbitrary = fc.constantFrom(
                '/api/cameras',
                '/api/admin/users',
                '/api/areas'
            );
            const methodArbitrary = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE');

            fc.assert(
                fc.property(
                    ipArbitrary,
                    reasonArbitrary,
                    endpointArbitrary,
                    methodArbitrary,
                    (ip, reason, endpoint, method) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logApiKeyFailure({
                            reason: reason,
                            endpoint: endpoint,
                            method: method
                        }, mockRequest);
                        
                        // Verify event type
                        expect(entry.event_type).toBe(SECURITY_EVENTS.API_KEY_INVALID);
                        
                        // Verify IP is captured
                        expect(entry.ip_address).toBe(ip);
                        
                        // Verify details contain reason
                        const details = JSON.parse(entry.details);
                        expect(details.reason).toBe(reason);
                        expect(details.endpoint).toBe(endpoint);
                        expect(details.method).toBe(method);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('CSRF failures are logged with reason and method', () => {
            const ipArbitrary = fc.ipV4();
            const reasonArbitrary = fc.constantFrom(
                'Missing CSRF token in header',
                'Missing CSRF token in cookie',
                'CSRF token mismatch',
                'Invalid CSRF token format'
            );
            const methodArbitrary = fc.constantFrom('POST', 'PUT', 'DELETE', 'PATCH');
            const endpointArbitrary = fc.constantFrom(
                '/api/cameras',
                '/api/users',
                '/api/auth/logout'
            );

            fc.assert(
                fc.property(
                    ipArbitrary,
                    reasonArbitrary,
                    methodArbitrary,
                    endpointArbitrary,
                    (ip, reason, method, endpoint) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logCsrfFailure({
                            reason: reason,
                            method: method,
                            endpoint: endpoint
                        }, mockRequest);
                        
                        // Verify event type
                        expect(entry.event_type).toBe(SECURITY_EVENTS.CSRF_INVALID);
                        
                        // Verify IP is captured
                        expect(entry.ip_address).toBe(ip);
                        
                        // Verify details contain reason and method
                        const details = JSON.parse(entry.details);
                        expect(details.reason).toBe(reason);
                        expect(details.method).toBe(method);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('Account lockouts are logged with lockout type and duration', () => {
            const ipArbitrary = fc.ipV4();
            const usernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
            const lockTypeArbitrary = fc.constantFrom('username', 'ip');
            const attemptsArbitrary = fc.integer({ min: 5, max: 20 });
            const durationArbitrary = fc.integer({ min: 15, max: 60 });

            fc.assert(
                fc.property(
                    ipArbitrary,
                    usernameArbitrary,
                    lockTypeArbitrary,
                    attemptsArbitrary,
                    durationArbitrary,
                    (ip, username, lockType, attempts, duration) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logAccountLockout({
                            username: lockType === 'username' ? username : null,
                            ip_address: ip,
                            lockType: lockType,
                            attempts: attempts,
                            duration_minutes: duration
                        }, mockRequest);
                        
                        // Verify event type
                        expect(entry.event_type).toBe(SECURITY_EVENTS.ACCOUNT_LOCKOUT);
                        
                        // Verify IP is captured
                        expect(entry.ip_address).toBe(ip);
                        
                        // Verify details contain lockout info
                        const details = JSON.parse(entry.details);
                        expect(details.lock_type).toBe(lockType);
                        expect(details.attempts).toBe(attempts);
                        expect(details.duration_minutes).toBe(duration);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('Admin actions are logged with action type and target', () => {
            const ipArbitrary = fc.ipV4();
            const actionArbitrary = fc.constantFrom(
                'CREATE_USER',
                'UPDATE_USER',
                'DELETE_USER',
                'CREATE_CAMERA',
                'UPDATE_CAMERA',
                'DELETE_CAMERA'
            );
            const targetTypeArbitrary = fc.constantFrom('user', 'camera', 'area');
            const targetIdArbitrary = fc.integer({ min: 1, max: 1000 });
            const adminUsernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

            fc.assert(
                fc.property(
                    ipArbitrary,
                    actionArbitrary,
                    targetTypeArbitrary,
                    targetIdArbitrary,
                    adminUsernameArbitrary,
                    (ip, action, targetType, targetId, adminUsername) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logAdminAction({
                            action: action,
                            targetType: targetType,
                            targetId: targetId,
                            adminUserId: 1,
                            adminUsername: adminUsername
                        }, mockRequest);
                        
                        // Verify event type
                        expect(entry.event_type).toBe(SECURITY_EVENTS.ADMIN_ACTION);
                        
                        // Verify IP is captured
                        expect(entry.ip_address).toBe(ip);
                        
                        // Verify details contain action info
                        const details = JSON.parse(entry.details);
                        expect(details.action).toBe(action);
                        expect(details.target_type).toBe(targetType);
                        expect(details.target_id).toBe(targetId);
                        expect(details.admin_username).toBe(adminUsername);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });
    });


    /**
     * Property: Fingerprint generation is deterministic
     * 
     * For any request with the same IP and User-Agent, the fingerprint
     * should be identical.
     */
    describe('Fingerprint Generation Properties', () => {
        it('Fingerprint is deterministic for same IP and User-Agent', () => {
            const ipArbitrary = fc.ipV4();
            const userAgentArbitrary = fc.string({ minLength: 5, maxLength: 100 })
                .filter(s => /^[a-zA-Z0-9\s\/\.\-_]+$/.test(s));

            fc.assert(
                fc.property(ipArbitrary, userAgentArbitrary, (ip, userAgent) => {
                    const request1 = createMockRequest(ip, userAgent);
                    const request2 = createMockRequest(ip, userAgent);
                    
                    const fingerprint1 = generateFingerprint(request1);
                    const fingerprint2 = generateFingerprint(request2);
                    
                    expect(fingerprint1).toBe(fingerprint2);
                    return true;
                }),
                { numRuns: 20 }
            );
        });

        it('Different IPs produce different fingerprints', () => {
            fc.assert(
                fc.property(fc.ipV4(), fc.ipV4(), (ip1, ip2) => {
                    // Skip if IPs are the same
                    if (ip1 === ip2) return true;
                    
                    const userAgent = 'TestAgent/1.0';
                    const request1 = createMockRequest(ip1, userAgent);
                    const request2 = createMockRequest(ip2, userAgent);
                    
                    const fingerprint1 = generateFingerprint(request1);
                    const fingerprint2 = generateFingerprint(request2);
                    
                    expect(fingerprint1).not.toBe(fingerprint2);
                    return true;
                }),
                { numRuns: 20 }
            );
        });

        it('Fingerprint is a valid SHA256 hash (64 hex characters)', () => {
            const ipArbitrary = fc.ipV4();
            const userAgentArbitrary = fc.string({ minLength: 5, maxLength: 100 })
                .filter(s => /^[a-zA-Z0-9\s\/\.\-_]+$/.test(s));

            fc.assert(
                fc.property(ipArbitrary, userAgentArbitrary, (ip, userAgent) => {
                    const request = createMockRequest(ip, userAgent);
                    const fingerprint = generateFingerprint(request);
                    
                    // SHA256 produces 64 hex characters
                    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
                    return true;
                }),
                { numRuns: 20 }
            );
        });

        it('Null request returns "unknown" fingerprint', () => {
            const fingerprint = generateFingerprint(null);
            expect(fingerprint).toBe('unknown');
        });
    });

    /**
     * Property: All SECURITY_EVENTS constants are valid
     */
    describe('Security Events Constants', () => {
        it('All security event types are non-empty strings', () => {
            Object.entries(SECURITY_EVENTS).forEach(([key, value]) => {
                expect(typeof value).toBe('string');
                expect(value.length).toBeGreaterThan(0);
                expect(key).toBe(value); // Key should match value
            });
        });

        it('LOG_RETENTION_DAYS is 90 days', () => {
            expect(LOG_RETENTION_DAYS).toBe(90);
        });
    });

    /**
     * Property: Session events are logged correctly
     */
    describe('Session Event Logging', () => {
        it('Session creation is logged with user details', () => {
            const ipArbitrary = fc.ipV4();
            const userIdArbitrary = fc.integer({ min: 1, max: 1000 });
            const usernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

            fc.assert(
                fc.property(
                    ipArbitrary,
                    userIdArbitrary,
                    usernameArbitrary,
                    (ip, userId, username) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logSessionCreated({
                            userId: userId,
                            username: username,
                            fingerprint: 'test-fingerprint-hash'
                        }, mockRequest);
                        
                        expect(entry.event_type).toBe(SECURITY_EVENTS.SESSION_CREATED);
                        expect(entry.ip_address).toBe(ip);
                        
                        const details = JSON.parse(entry.details);
                        expect(details.user_id).toBe(userId);
                        expect(details.username).toBe(username);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('Session invalidation is logged with reason', () => {
            const ipArbitrary = fc.ipV4();
            const userIdArbitrary = fc.integer({ min: 1, max: 1000 });
            const reasonArbitrary = fc.constantFrom(
                'logout',
                'password_change',
                'token_expired',
                'fingerprint_mismatch'
            );

            fc.assert(
                fc.property(
                    ipArbitrary,
                    userIdArbitrary,
                    reasonArbitrary,
                    (ip, userId, reason) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logSessionInvalidated({
                            userId: userId,
                            reason: reason
                        }, mockRequest);
                        
                        expect(entry.event_type).toBe(SECURITY_EVENTS.SESSION_INVALIDATED);
                        expect(entry.ip_address).toBe(ip);
                        
                        const details = JSON.parse(entry.details);
                        expect(details.user_id).toBe(userId);
                        expect(details.reason).toBe(reason);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property: Password change events are logged
     */
    describe('Password Change Logging', () => {
        it('Password changes are logged with user and changer info', () => {
            const ipArbitrary = fc.ipV4();
            const userIdArbitrary = fc.integer({ min: 1, max: 1000 });
            const usernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
            const changedByArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

            fc.assert(
                fc.property(
                    ipArbitrary,
                    userIdArbitrary,
                    usernameArbitrary,
                    changedByArbitrary,
                    (ip, userId, username, changedBy) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logPasswordChanged({
                            userId: userId,
                            username: username,
                            changedBy: changedBy
                        }, mockRequest);
                        
                        expect(entry.event_type).toBe(SECURITY_EVENTS.PASSWORD_CHANGED);
                        expect(entry.ip_address).toBe(ip);
                        
                        const details = JSON.parse(entry.details);
                        expect(details.user_id).toBe(userId);
                        expect(details.username).toBe(username);
                        expect(details.changed_by).toBe(changedBy);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property: User management events are logged
     */
    describe('User Management Logging', () => {
        it('User creation is logged with creator info', () => {
            const ipArbitrary = fc.ipV4();
            const newUserIdArbitrary = fc.integer({ min: 1, max: 1000 });
            const newUsernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
            const creatorUsernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
            const roleArbitrary = fc.constantFrom('admin', 'user', 'viewer');

            fc.assert(
                fc.property(
                    ipArbitrary,
                    newUserIdArbitrary,
                    newUsernameArbitrary,
                    creatorUsernameArbitrary,
                    roleArbitrary,
                    (ip, newUserId, newUsername, creatorUsername, role) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logUserCreated({
                            newUserId: newUserId,
                            newUsername: newUsername,
                            createdByUserId: 1,
                            createdByUsername: creatorUsername,
                            role: role
                        }, mockRequest);
                        
                        expect(entry.event_type).toBe(SECURITY_EVENTS.USER_CREATED);
                        expect(entry.ip_address).toBe(ip);
                        
                        const details = JSON.parse(entry.details);
                        expect(details.new_user_id).toBe(newUserId);
                        expect(details.new_username).toBe(newUsername);
                        expect(details.created_by_username).toBe(creatorUsername);
                        expect(details.role).toBe(role);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('User deletion is logged with deleter info', () => {
            const ipArbitrary = fc.ipV4();
            const deletedUserIdArbitrary = fc.integer({ min: 1, max: 1000 });
            const deletedUsernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
            const deleterUsernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

            fc.assert(
                fc.property(
                    ipArbitrary,
                    deletedUserIdArbitrary,
                    deletedUsernameArbitrary,
                    deleterUsernameArbitrary,
                    (ip, deletedUserId, deletedUsername, deleterUsername) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logUserDeleted({
                            deletedUserId: deletedUserId,
                            deletedUsername: deletedUsername,
                            deletedByUserId: 1,
                            deletedByUsername: deleterUsername
                        }, mockRequest);
                        
                        expect(entry.event_type).toBe(SECURITY_EVENTS.USER_DELETED);
                        expect(entry.ip_address).toBe(ip);
                        
                        const details = JSON.parse(entry.details);
                        expect(details.deleted_user_id).toBe(deletedUserId);
                        expect(details.deleted_username).toBe(deletedUsername);
                        expect(details.deleted_by_username).toBe(deleterUsername);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property: Camera management events are logged
     */
    describe('Camera Management Logging', () => {
        it('Camera creation is logged with creator info', () => {
            const ipArbitrary = fc.ipV4();
            const cameraIdArbitrary = fc.integer({ min: 1, max: 1000 });
            const cameraNameArbitrary = fc.string({ minLength: 3, maxLength: 50 })
                .filter(s => /^[a-zA-Z0-9\s\-_]+$/.test(s));
            const creatorUsernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

            fc.assert(
                fc.property(
                    ipArbitrary,
                    cameraIdArbitrary,
                    cameraNameArbitrary,
                    creatorUsernameArbitrary,
                    (ip, cameraId, cameraName, creatorUsername) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logCameraCreated({
                            cameraId: cameraId,
                            cameraName: cameraName,
                            createdByUserId: 1,
                            createdByUsername: creatorUsername
                        }, mockRequest);
                        
                        expect(entry.event_type).toBe(SECURITY_EVENTS.CAMERA_CREATED);
                        expect(entry.ip_address).toBe(ip);
                        
                        const details = JSON.parse(entry.details);
                        expect(details.camera_id).toBe(cameraId);
                        expect(details.camera_name).toBe(cameraName);
                        expect(details.created_by_username).toBe(creatorUsername);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('Camera deletion is logged with deleter info', () => {
            const ipArbitrary = fc.ipV4();
            const cameraIdArbitrary = fc.integer({ min: 1, max: 1000 });
            const cameraNameArbitrary = fc.string({ minLength: 3, maxLength: 50 })
                .filter(s => /^[a-zA-Z0-9\s\-_]+$/.test(s));
            const deleterUsernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

            fc.assert(
                fc.property(
                    ipArbitrary,
                    cameraIdArbitrary,
                    cameraNameArbitrary,
                    deleterUsernameArbitrary,
                    (ip, cameraId, cameraName, deleterUsername) => {
                        const mockRequest = createMockRequest(ip);
                        
                        const entry = logCameraDeleted({
                            cameraId: cameraId,
                            cameraName: cameraName,
                            deletedByUserId: 1,
                            deletedByUsername: deleterUsername
                        }, mockRequest);
                        
                        expect(entry.event_type).toBe(SECURITY_EVENTS.CAMERA_DELETED);
                        expect(entry.ip_address).toBe(ip);
                        
                        const details = JSON.parse(entry.details);
                        expect(details.camera_id).toBe(cameraId);
                        expect(details.camera_name).toBe(cameraName);
                        expect(details.deleted_by_username).toBe(deleterUsername);
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });
    });
});
