/**
 * Property-Based Tests for Progressive Delay
 * 
 * **Property 5: Progressive Delay Enforcement**
 * **Validates: Requirements 3.6**
 * 
 * Feature: api-security-hardening, Property 5: Progressive Delay Enforcement
 * 
 * For any sequence of failed login attempts from the same source, the delay 
 * before allowing the next attempt SHALL increase exponentially (1s, 2s, 4s, 8s max).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    BRUTE_FORCE_CONFIG,
    getProgressiveDelay
} from '../services/bruteForceProtection.js';

describe('Progressive Delay Property Tests', () => {
    /**
     * Property 5: Progressive Delay Enforcement
     * 
     * For any sequence of failed login attempts, the delay SHALL increase
     * exponentially (1s, 2s, 4s, 8s max).
     * 
     * **Validates: Requirements 3.6**
     */
    describe('Property 5: Progressive Delay Enforcement', () => {
        it('Delay increases exponentially for first 4 attempts', () => {
            const attemptArbitrary = fc.integer({ min: 1, max: 4 });
            
            fc.assert(
                fc.property(attemptArbitrary, (attemptNumber) => {
                    const delay = getProgressiveDelay(attemptNumber);
                    const expectedDelay = BRUTE_FORCE_CONFIG.progressiveDelay[attemptNumber - 1];
                    
                    expect(delay).toBe(expectedDelay);
                    
                    // Verify exponential pattern: 1000, 2000, 4000, 8000
                    expect(delay).toBe(1000 * Math.pow(2, attemptNumber - 1));
                }),
                { numRuns: 100 }
            );
        });

        it('Delay caps at 8 seconds for attempts beyond 4', () => {
            const attemptArbitrary = fc.integer({ min: 5, max: 100 });
            
            fc.assert(
                fc.property(attemptArbitrary, (attemptNumber) => {
                    const delay = getProgressiveDelay(attemptNumber);
                    
                    // Should cap at 8000ms (8 seconds)
                    expect(delay).toBe(8000);
                }),
                { numRuns: 100 }
            );
        });

        it('Delay is 0 for attempt count <= 0', () => {
            const attemptArbitrary = fc.integer({ min: -100, max: 0 });
            
            fc.assert(
                fc.property(attemptArbitrary, (attemptNumber) => {
                    const delay = getProgressiveDelay(attemptNumber);
                    expect(delay).toBe(0);
                }),
                { numRuns: 100 }
            );
        });

        it('Delay sequence is monotonically increasing up to cap', () => {
            const maxAttemptsArbitrary = fc.integer({ min: 2, max: 10 });
            
            fc.assert(
                fc.property(maxAttemptsArbitrary, (maxAttempts) => {
                    let previousDelay = 0;
                    
                    for (let i = 1; i <= maxAttempts; i++) {
                        const currentDelay = getProgressiveDelay(i);
                        
                        // Delay should be >= previous delay (monotonically increasing)
                        expect(currentDelay).toBeGreaterThanOrEqual(previousDelay);
                        
                        // Delay should never exceed 8000ms
                        expect(currentDelay).toBeLessThanOrEqual(8000);
                        
                        previousDelay = currentDelay;
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('Delay doubles for each attempt until cap', () => {
            fc.assert(
                fc.property(fc.integer({ min: 1, max: 3 }), (attemptNumber) => {
                    const currentDelay = getProgressiveDelay(attemptNumber);
                    const nextDelay = getProgressiveDelay(attemptNumber + 1);
                    
                    // Next delay should be double the current (until cap)
                    if (currentDelay < 8000) {
                        expect(nextDelay).toBe(currentDelay * 2);
                    } else {
                        expect(nextDelay).toBe(8000);
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property: Config values match expected delays
     */
    it('Property: Config values match expected delays', () => {
        const expectedDelays = [1000, 2000, 4000, 8000];
        
        expect(BRUTE_FORCE_CONFIG.progressiveDelay).toEqual(expectedDelays);
        expect(BRUTE_FORCE_CONFIG.progressiveDelay.length).toBe(4);
        
        // Verify each delay value
        expectedDelays.forEach((expected, index) => {
            expect(BRUTE_FORCE_CONFIG.progressiveDelay[index]).toBe(expected);
        });
    });

    /**
     * Property: Delay is always a positive integer or zero
     */
    it('Property: Delay is always a non-negative integer', () => {
        const attemptArbitrary = fc.integer({ min: -10, max: 100 });
        
        fc.assert(
            fc.property(attemptArbitrary, (attemptNumber) => {
                const delay = getProgressiveDelay(attemptNumber);
                
                expect(delay).toBeGreaterThanOrEqual(0);
                expect(Number.isInteger(delay)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Delay function is deterministic
     */
    it('Property: Delay function is deterministic', () => {
        const attemptArbitrary = fc.integer({ min: 1, max: 20 });
        
        fc.assert(
            fc.property(attemptArbitrary, (attemptNumber) => {
                const delay1 = getProgressiveDelay(attemptNumber);
                const delay2 = getProgressiveDelay(attemptNumber);
                
                expect(delay1).toBe(delay2);
            }),
            { numRuns: 100 }
        );
    });
});
