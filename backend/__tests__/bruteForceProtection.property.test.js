/**
 * Property-Based Tests for Brute Force Protection
 * 
 * **Property 4: Brute Force Lockout Threshold**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 * 
 * Feature: api-security-hardening, Property 4: Brute Force Lockout Threshold
 * 
 * For any username with 5 or more failed login attempts within 15 minutes, 
 * subsequent login attempts SHALL be rejected regardless of password correctness;
 * for any IP address with 10 or more failed attempts within 15 minutes, 
 * all requests from that IP SHALL be blocked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    BRUTE_FORCE_CONFIG,
    trackFailedAttempt,
    trackSuccessfulLogin,
    getFailedAttemptCount,
    clearFailedAttempts,
    checkLockout,
    getRemainingAttempts,
    cleanupOldAttempts
} from '../services/bruteForceProtection.js';
import { execute } from '../database/database.js';

// Helper to clear all login attempts
function clearAllAttempts() {
    try {
        execute('DELETE FROM login_attempts');
    } catch (error) {
        // Table might not exist in test environment
    }
}

describe('Brute Force Protection Property Tests', () => {
    beforeEach(() => {
        clearAllAttempts();
    });

    afterEach(() => {
        clearAllAttempts();
    });

    /**
     * Property 4: Brute Force Lockout Threshold
     * 
     * For any username with 5 or more failed login attempts within 15 minutes,
     * subsequent login attempts SHALL be rejected.
     * 
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
     */
    describe('Property 4: Brute Force Lockout Threshold', () => {
        it('Username lockout triggers after exactly 5 failed attempts', () => {
            const usernameArbitrary = fc.string({ minLength: 3, maxLength: 20 })
                .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
            
            fc.assert(
                fc.property(usernameArbitrary, (username) => {
                    clearAllAttempts();
                    
                    const ip = '192.168.1.100';
                    const maxAttempts = BRUTE_FORCE_CONFIG.maxAttempts.username;
                    
                    // Make exactly maxAttempts - 1 failed attempts
                    for (let i = 0; i < maxAttempts - 1; i++) {
                        trackFailedAttempt(username, ip);
                    }
                    
                    // Should NOT be locked yet
                    let lockoutStatus = checkLockout(username, ip);
                    expect(lockoutStatus.locked).toBe(false);
                    
                    // Make one more failed attempt (reaches threshold)
                    trackFailedAttempt(username, ip);
                    
                    // Should now be locked
                    lockoutStatus = checkLockout(username, ip);
                    expect(lockoutStatus.locked).toBe(true);
                    expect(lockoutStatus.lockType).toBe('username');
                }),
                { numRuns: 100 }
            );
        });

        it('IP lockout triggers after exactly 10 failed attempts', () => {
            const ipArbitrary = fc.ipV4();
            
            fc.assert(
                fc.property(ipArbitrary, (ip) => {
                    clearAllAttempts();
                    
                    const username = 'testuser';
                    const maxAttempts = BRUTE_FORCE_CONFIG.maxAttempts.ip;
                    
                    // Make exactly maxAttempts - 1 failed attempts
                    for (let i = 0; i < maxAttempts - 1; i++) {
                        trackFailedAttempt(username, ip);
                    }
                    
                    // Should NOT be locked yet (username might be locked, but IP shouldn't)
                    let lockoutStatus = checkLockout(null, ip);
                    expect(lockoutStatus.locked).toBe(false);
                    
                    // Make one more failed attempt (reaches IP threshold)
                    trackFailedAttempt(username, ip);
                    
                    // Should now be locked by IP
                    lockoutStatus = checkLockout(null, ip);
                    expect(lockoutStatus.locked).toBe(true);
                    expect(lockoutStatus.lockType).toBe('ip');
                }),
                { numRuns: 100 }
            );
        });

        it('Failed attempt count increases correctly', () => {
            const attemptCountArbitrary = fc.integer({ min: 1, max: 15 });
            const usernameArbitrary = fc.string({ minLength: 3, maxLength: 10 })
                .filter(s => /^[a-zA-Z0-9]+$/.test(s));
            
            fc.assert(
                fc.property(attemptCountArbitrary, usernameArbitrary, (attemptCount, username) => {
                    clearAllAttempts();
                    
                    const ip = '10.0.0.1';
                    
                    for (let i = 0; i < attemptCount; i++) {
                        trackFailedAttempt(username, ip);
                    }
                    
                    const usernameCount = getFailedAttemptCount(username, 'username');
                    const ipCount = getFailedAttemptCount(ip, 'ip');
                    
                    expect(usernameCount).toBe(attemptCount);
                    expect(ipCount).toBe(attemptCount);
                }),
                { numRuns: 100 }
            );
        });

        it('Successful login resets username counter', () => {
            const usernameArbitrary = fc.string({ minLength: 3, maxLength: 10 })
                .filter(s => /^[a-zA-Z0-9]+$/.test(s));
            const attemptCountArbitrary = fc.integer({ min: 1, max: 4 });
            
            fc.assert(
                fc.property(usernameArbitrary, attemptCountArbitrary, (username, attemptCount) => {
                    clearAllAttempts();
                    
                    const ip = '172.16.0.1';
                    
                    // Make some failed attempts (less than lockout threshold)
                    for (let i = 0; i < attemptCount; i++) {
                        trackFailedAttempt(username, ip);
                    }
                    
                    // Verify attempts were tracked
                    expect(getFailedAttemptCount(username, 'username')).toBe(attemptCount);
                    
                    // Successful login
                    trackSuccessfulLogin(username, ip);
                    
                    // Username counter should be reset
                    expect(getFailedAttemptCount(username, 'username')).toBe(0);
                }),
                { numRuns: 100 }
            );
        });

        it('Different usernames have independent lockout counters', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 3, maxLength: 10 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
                    fc.string({ minLength: 3, maxLength: 10 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
                    (username1, username2) => {
                        // Skip if usernames are the same
                        if (username1 === username2) return true;
                        
                        clearAllAttempts();
                        
                        const ip = '192.168.0.1';
                        
                        // Lock out username1
                        for (let i = 0; i < BRUTE_FORCE_CONFIG.maxAttempts.username; i++) {
                            trackFailedAttempt(username1, ip);
                        }
                        
                        // username1 should be locked
                        const lockout1 = checkLockout(username1, null);
                        expect(lockout1.locked).toBe(true);
                        
                        // username2 should NOT be locked
                        const lockout2 = checkLockout(username2, null);
                        expect(lockout2.locked).toBe(false);
                        
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Different IPs have independent lockout counters', () => {
            fc.assert(
                fc.property(fc.ipV4(), fc.ipV4(), (ip1, ip2) => {
                    // Skip if IPs are the same
                    if (ip1 === ip2) return true;
                    
                    clearAllAttempts();
                    
                    const username = 'testuser';
                    
                    // Lock out ip1
                    for (let i = 0; i < BRUTE_FORCE_CONFIG.maxAttempts.ip; i++) {
                        trackFailedAttempt(username, ip1);
                    }
                    
                    // ip1 should be locked
                    const lockout1 = checkLockout(null, ip1);
                    expect(lockout1.locked).toBe(true);
                    
                    // ip2 should NOT be locked
                    const lockout2 = checkLockout(null, ip2);
                    expect(lockout2.locked).toBe(false);
                    
                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property: Remaining attempts calculation is correct
     */
    it('Property: Remaining attempts calculation is correct', () => {
        const attemptCountArbitrary = fc.integer({ min: 0, max: 10 });
        const usernameArbitrary = fc.string({ minLength: 3, maxLength: 10 })
            .filter(s => /^[a-zA-Z0-9]+$/.test(s));
        
        fc.assert(
            fc.property(attemptCountArbitrary, usernameArbitrary, (attemptCount, username) => {
                clearAllAttempts();
                
                const ip = '10.10.10.10';
                
                for (let i = 0; i < attemptCount; i++) {
                    trackFailedAttempt(username, ip);
                }
                
                const remaining = getRemainingAttempts(username, ip);
                
                const expectedUsernameRemaining = Math.max(0, 
                    BRUTE_FORCE_CONFIG.maxAttempts.username - attemptCount);
                const expectedIpRemaining = Math.max(0, 
                    BRUTE_FORCE_CONFIG.maxAttempts.ip - attemptCount);
                
                expect(remaining.usernameRemaining).toBe(expectedUsernameRemaining);
                expect(remaining.ipRemaining).toBe(expectedIpRemaining);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Config values are valid
     */
    it('Property: Config values are valid', () => {
        // Username lockout threshold
        expect(BRUTE_FORCE_CONFIG.maxAttempts.username).toBe(5);
        
        // IP lockout threshold
        expect(BRUTE_FORCE_CONFIG.maxAttempts.ip).toBe(10);
        
        // Username lockout duration (30 minutes)
        expect(BRUTE_FORCE_CONFIG.lockoutDuration.username).toBe(30 * 60 * 1000);
        
        // IP lockout duration (1 hour)
        expect(BRUTE_FORCE_CONFIG.lockoutDuration.ip).toBe(60 * 60 * 1000);
        
        // Tracking window (15 minutes)
        expect(BRUTE_FORCE_CONFIG.trackingWindow).toBe(15 * 60 * 1000);
    });
});
