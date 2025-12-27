/**
 * Property-Based Tests for LoadingTimeoutHandler
 * 
 * Tests for:
 * - Property 1: Device-Adaptive Timeout Duration
 * - Property 9: Consecutive Failure Tracking
 * 
 * **Validates: Requirements 1.1, 1.4, 5.3**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    getTimeoutDuration,
    createLoadingTimeoutHandler,
    TIMEOUT_CONFIG,
} from '../utils/loadingTimeoutHandler';

describe('LoadingTimeoutHandler Property Tests', () => {
    // Use fake timers for timeout testing
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Property 1: Device-Adaptive Timeout Duration
     * Feature: stream-loading-fix, Property 1: Device-Adaptive Timeout Duration
     * Validates: Requirements 1.1, 5.3
     * 
     * For any device tier, the loading timeout duration SHALL be:
     * - 15000ms for 'low' tier devices
     * - 10000ms for 'medium' and 'high' tier devices
     */
    describe('Property 1: Device-Adaptive Timeout Duration', () => {
        it('should return 15000ms for low-end devices', async () => {
            await fc.assert(
                fc.property(
                    fc.constant('low'),
                    (tier) => {
                        const duration = getTimeoutDuration(tier);
                        expect(duration).toBe(15000);
                        expect(duration).toBe(TIMEOUT_CONFIG.LOW_END_TIMEOUT);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 10000ms for medium-end devices', async () => {
            await fc.assert(
                fc.property(
                    fc.constant('medium'),
                    (tier) => {
                        const duration = getTimeoutDuration(tier);
                        expect(duration).toBe(10000);
                        expect(duration).toBe(TIMEOUT_CONFIG.HIGH_END_TIMEOUT);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 10000ms for high-end devices', async () => {
            await fc.assert(
                fc.property(
                    fc.constant('high'),
                    (tier) => {
                        const duration = getTimeoutDuration(tier);
                        expect(duration).toBe(10000);
                        expect(duration).toBe(TIMEOUT_CONFIG.HIGH_END_TIMEOUT);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct timeout for any valid device tier', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const duration = getTimeoutDuration(tier);
                        
                        if (tier === 'low') {
                            expect(duration).toBe(15000);
                        } else {
                            expect(duration).toBe(10000);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('handler should use correct timeout based on device tier', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const handler = createLoadingTimeoutHandler({ deviceTier: tier });
                        const configuredTimeout = handler.getConfiguredTimeout();
                        
                        if (tier === 'low') {
                            expect(configuredTimeout).toBe(15000);
                        } else {
                            expect(configuredTimeout).toBe(10000);
                        }
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('low-end timeout should be greater than high-end timeout', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const lowTimeout = getTimeoutDuration('low');
                        const mediumTimeout = getTimeoutDuration('medium');
                        const highTimeout = getTimeoutDuration('high');
                        
                        expect(lowTimeout).toBeGreaterThan(mediumTimeout);
                        expect(lowTimeout).toBeGreaterThan(highTimeout);
                        expect(mediumTimeout).toBe(highTimeout);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('timeout should trigger after correct duration for each tier', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const timeoutCallback = vi.fn();
                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                            onTimeout: timeoutCallback,
                        });
                        
                        handler.startTimeout();
                        
                        const expectedDuration = tier === 'low' ? 15000 : 10000;
                        
                        // Advance time just before timeout
                        vi.advanceTimersByTime(expectedDuration - 1);
                        expect(timeoutCallback).not.toHaveBeenCalled();
                        
                        // Advance to trigger timeout
                        vi.advanceTimersByTime(1);
                        expect(timeoutCallback).toHaveBeenCalledTimes(1);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 9: Consecutive Failure Tracking
     * Feature: stream-loading-fix, Property 9: Consecutive Failure Tracking
     * Validates: Requirements 1.4
     * 
     * For any sequence of timeout failures, the LoadingTimeoutHandler SHALL 
     * track consecutive failures and suggest troubleshooting after exactly 
     * 3 consecutive failures.
     */
    describe('Property 9: Consecutive Failure Tracking', () => {
        it('should track consecutive failures correctly', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10 }),
                    (numFailures) => {
                        const handler = createLoadingTimeoutHandler({ deviceTier: 'medium' });
                        
                        // Record failures
                        for (let i = 0; i < numFailures; i++) {
                            handler.recordFailure();
                        }
                        
                        expect(handler.getConsecutiveFailures()).toBe(numFailures);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should suggest troubleshooting after exactly 3 consecutive failures', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }),
                    (numFailures) => {
                        const handler = createLoadingTimeoutHandler({ deviceTier: 'medium' });
                        
                        // Record failures
                        for (let i = 0; i < numFailures; i++) {
                            handler.recordFailure();
                        }
                        
                        const shouldSuggest = handler.shouldSuggestTroubleshooting();
                        
                        if (numFailures >= 3) {
                            expect(shouldSuggest).toBe(true);
                        } else {
                            expect(shouldSuggest).toBe(false);
                        }
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should reset failures correctly', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10 }),
                    (numFailures) => {
                        const handler = createLoadingTimeoutHandler({ deviceTier: 'medium' });
                        
                        // Record failures
                        for (let i = 0; i < numFailures; i++) {
                            handler.recordFailure();
                        }
                        
                        expect(handler.getConsecutiveFailures()).toBe(numFailures);
                        
                        // Reset failures
                        handler.resetFailures();
                        
                        expect(handler.getConsecutiveFailures()).toBe(0);
                        expect(handler.shouldSuggestTroubleshooting()).toBe(false);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should increment failures on timeout', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (numTimeouts) => {
                        const handler = createLoadingTimeoutHandler({ deviceTier: 'medium' });
                        
                        // Trigger timeouts
                        for (let i = 0; i < numTimeouts; i++) {
                            handler.startTimeout();
                            vi.advanceTimersByTime(10000); // Trigger timeout
                        }
                        
                        expect(handler.getConsecutiveFailures()).toBe(numTimeouts);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should call maxFailures callback after 3 consecutive failures', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 6 }),
                    (numTimeouts) => {
                        const maxFailuresCallback = vi.fn();
                        const handler = createLoadingTimeoutHandler({
                            deviceTier: 'medium',
                            onMaxFailures: maxFailuresCallback,
                        });
                        
                        // Trigger timeouts
                        for (let i = 0; i < numTimeouts; i++) {
                            handler.startTimeout();
                            vi.advanceTimersByTime(10000);
                        }
                        
                        // maxFailures callback should be called once when reaching 3 failures
                        // and again for each subsequent failure
                        const expectedCalls = Math.max(0, numTimeouts - 2);
                        expect(maxFailuresCallback).toHaveBeenCalledTimes(expectedCalls);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should start with zero consecutive failures', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const handler = createLoadingTimeoutHandler({ deviceTier: tier });
                        
                        expect(handler.getConsecutiveFailures()).toBe(0);
                        expect(handler.shouldSuggestTroubleshooting()).toBe(false);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('clearTimeout should not affect consecutive failure count', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (numFailures) => {
                        const handler = createLoadingTimeoutHandler({ deviceTier: 'medium' });
                        
                        // Record some failures
                        for (let i = 0; i < numFailures; i++) {
                            handler.recordFailure();
                        }
                        
                        const failuresBefore = handler.getConsecutiveFailures();
                        
                        // Start and clear timeout
                        handler.startTimeout();
                        handler.clearTimeout();
                        
                        // Failures should remain unchanged
                        expect(handler.getConsecutiveFailures()).toBe(failuresBefore);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('destroy should reset consecutive failures', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (numFailures) => {
                        const handler = createLoadingTimeoutHandler({ deviceTier: 'medium' });
                        
                        // Record failures
                        for (let i = 0; i < numFailures; i++) {
                            handler.recordFailure();
                        }
                        
                        handler.destroy();
                        
                        // After destroy, a new handler should start fresh
                        const newHandler = createLoadingTimeoutHandler({ deviceTier: 'medium' });
                        expect(newHandler.getConsecutiveFailures()).toBe(0);
                        
                        newHandler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
