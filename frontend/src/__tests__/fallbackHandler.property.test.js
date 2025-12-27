/**
 * Property-Based Tests for FallbackHandler
 * 
 * Tests for:
 * - Property 6: Auto-Retry Limit
 * - Property 7: Auto-Retry Delay
 * 
 * **Validates: Requirements 6.1, 6.2, 6.4**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    getRetryDelay,
    createFallbackHandler,
    FALLBACK_CONFIG,
} from '../utils/fallbackHandler';
import { ErrorType } from '../utils/streamLoaderTypes';

describe('FallbackHandler Property Tests', () => {
    // Use fake timers for retry testing
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Property 6: Auto-Retry Limit
     * Feature: stream-loading-fix, Property 6: Auto-Retry Limit
     * Validates: Requirements 6.2, 6.4
     * 
     * For any stream loading failure, the FallbackHandler SHALL limit 
     * automatic retries to exactly 3 attempts before requiring manual intervention.
     */
    describe('Property 6: Auto-Retry Limit', () => {
        it('should allow auto-retry when count is below max limit', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 2 }),
                    (initialRetries) => {
                        const handler = createFallbackHandler();
                        
                        // Simulate previous retries
                        for (let i = 0; i < initialRetries; i++) {
                            const error = { type: 'network', message: 'Test error' };
                            handler.handleError(error, () => {});
                            vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        }
                        
                        // Should still allow auto-retry
                        expect(handler.shouldAutoRetry()).toBe(true);
                        expect(handler.getRemainingRetries()).toBe(3 - initialRetries);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not allow auto-retry after exactly 3 attempts', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(3),
                    (maxRetries) => {
                        const handler = createFallbackHandler();
                        
                        // Exhaust all auto-retries
                        for (let i = 0; i < maxRetries; i++) {
                            const error = { type: 'network', message: 'Test error' };
                            handler.handleError(error, () => {});
                            vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        }
                        
                        // Should not allow more auto-retries
                        expect(handler.shouldAutoRetry()).toBe(false);
                        expect(handler.getAutoRetryCount()).toBe(3);
                        expect(handler.getRemainingRetries()).toBe(0);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return manual-retry-required after exhausting auto-retries', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('network', 'server', 'timeout'),
                    (errorType) => {
                        const handler = createFallbackHandler();
                        const retryFn = vi.fn();
                        
                        // Exhaust all auto-retries
                        for (let i = 0; i < 3; i++) {
                            const error = { type: errorType, message: 'Test error' };
                            handler.handleError(error, retryFn);
                            vi.advanceTimersByTime(FALLBACK_CONFIG.SERVER_RETRY_DELAY);
                        }
                        
                        // Next error should require manual retry
                        const error = { type: errorType, message: 'Test error' };
                        const result = handler.handleError(error, retryFn);
                        
                        expect(result.action).toBe('manual-retry-required');
                        expect(result.totalAttempts).toBe(3);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should call onAutoRetryExhausted callback after 3 retries', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const exhaustedCallback = vi.fn();
                        const handler = createFallbackHandler({
                            onAutoRetryExhausted: exhaustedCallback,
                        });
                        
                        // Exhaust all auto-retries
                        for (let i = 0; i < 3; i++) {
                            const error = { type: 'network', message: 'Test error' };
                            handler.handleError(error, () => {});
                            vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        }
                        
                        // Trigger one more error to get exhausted callback
                        const error = { type: 'network', message: 'Test error' };
                        handler.handleError(error, () => {});
                        
                        expect(exhaustedCallback).toHaveBeenCalledTimes(1);
                        expect(exhaustedCallback).toHaveBeenCalledWith({
                            totalAttempts: 3,
                            lastErrorType: 'network',
                        });
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should reset retry count after calling reset()', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 3 }),
                    (numRetries) => {
                        const handler = createFallbackHandler();
                        
                        // Perform some retries
                        for (let i = 0; i < numRetries; i++) {
                            const error = { type: 'network', message: 'Test error' };
                            handler.handleError(error, () => {});
                            vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        }
                        
                        expect(handler.getAutoRetryCount()).toBe(numRetries);
                        
                        // Reset
                        handler.reset();
                        
                        expect(handler.getAutoRetryCount()).toBe(0);
                        expect(handler.shouldAutoRetry()).toBe(true);
                        expect(handler.getRemainingRetries()).toBe(3);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should track retry count correctly for any number of errors', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10 }),
                    (numErrors) => {
                        const handler = createFallbackHandler();
                        
                        for (let i = 0; i < numErrors; i++) {
                            const error = { type: 'network', message: 'Test error' };
                            handler.handleError(error, () => {});
                            vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        }
                        
                        // Retry count should be capped at max
                        const expectedCount = Math.min(numErrors, 3);
                        expect(handler.getAutoRetryCount()).toBe(expectedCount);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should start with zero retry count', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const handler = createFallbackHandler();
                        
                        expect(handler.getAutoRetryCount()).toBe(0);
                        expect(handler.shouldAutoRetry()).toBe(true);
                        expect(handler.getRemainingRetries()).toBe(3);
                        expect(handler.getMaxAutoRetries()).toBe(3);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should respect custom maxAutoRetries configuration', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10 }),
                    (customMax) => {
                        const handler = createFallbackHandler({ maxAutoRetries: customMax });
                        
                        expect(handler.getMaxAutoRetries()).toBe(customMax);
                        expect(handler.getRemainingRetries()).toBe(customMax);
                        
                        // Exhaust all retries
                        for (let i = 0; i < customMax; i++) {
                            expect(handler.shouldAutoRetry()).toBe(true);
                            const error = { type: 'network', message: 'Test error' };
                            handler.handleError(error, () => {});
                            vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        }
                        
                        expect(handler.shouldAutoRetry()).toBe(false);
                        expect(handler.getAutoRetryCount()).toBe(customMax);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 7: Auto-Retry Delay
     * Feature: stream-loading-fix, Property 7: Auto-Retry Delay
     * Validates: Requirements 6.1
     * 
     * For any network error, the auto-retry delay SHALL be exactly 3000ms.
     */
    describe('Property 7: Auto-Retry Delay', () => {
        it('should return 3000ms delay for network errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('network', ErrorType.NETWORK),
                    (errorType) => {
                        const delay = getRetryDelay(errorType);
                        expect(delay).toBe(3000);
                        expect(delay).toBe(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 5000ms delay for server errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('server', ErrorType.SERVER),
                    (errorType) => {
                        const delay = getRetryDelay(errorType);
                        expect(delay).toBe(5000);
                        expect(delay).toBe(FALLBACK_CONFIG.SERVER_RETRY_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 3000ms delay for timeout errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('timeout', ErrorType.TIMEOUT),
                    (errorType) => {
                        const delay = getRetryDelay(errorType);
                        expect(delay).toBe(3000);
                        expect(delay).toBe(FALLBACK_CONFIG.TIMEOUT_RETRY_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 3000ms delay for media errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('media', ErrorType.MEDIA),
                    (errorType) => {
                        const delay = getRetryDelay(errorType);
                        expect(delay).toBe(3000);
                        expect(delay).toBe(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return default 3000ms delay for unknown errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('unknown', 'other', 'invalid', '', null, undefined),
                    (errorType) => {
                        const delay = getRetryDelay(errorType);
                        expect(delay).toBe(3000);
                        expect(delay).toBe(FALLBACK_CONFIG.DEFAULT_RETRY_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should use correct delay when handling errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('network', 'server', 'timeout'),
                    (errorType) => {
                        const autoRetryCallback = vi.fn();
                        const handler = createFallbackHandler({
                            onAutoRetry: autoRetryCallback,
                        });
                        
                        const error = { type: errorType, message: 'Test error' };
                        const result = handler.handleError(error, () => {});
                        
                        const expectedDelay = getRetryDelay(errorType);
                        
                        expect(result.delay).toBe(expectedDelay);
                        expect(autoRetryCallback).toHaveBeenCalledWith(
                            expect.objectContaining({
                                delay: expectedDelay,
                                errorType,
                            })
                        );
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should trigger retry after correct delay', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('network', 'server', 'timeout'),
                    (errorType) => {
                        const handler = createFallbackHandler();
                        const retryFn = vi.fn();
                        
                        const error = { type: errorType, message: 'Test error' };
                        handler.handleError(error, retryFn);
                        
                        const expectedDelay = getRetryDelay(errorType);
                        
                        // Retry should not be called before delay
                        vi.advanceTimersByTime(expectedDelay - 1);
                        expect(retryFn).not.toHaveBeenCalled();
                        
                        // Retry should be called after delay
                        vi.advanceTimersByTime(1);
                        expect(retryFn).toHaveBeenCalledTimes(1);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('server errors should have longer delay than network errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const networkDelay = getRetryDelay('network');
                        const serverDelay = getRetryDelay('server');
                        const timeoutDelay = getRetryDelay('timeout');
                        
                        expect(serverDelay).toBeGreaterThan(networkDelay);
                        expect(serverDelay).toBeGreaterThan(timeoutDelay);
                        expect(networkDelay).toBe(timeoutDelay);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should provide correct estimated retry time', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('network', 'server', 'timeout'),
                    (errorType) => {
                        const handler = createFallbackHandler();
                        
                        const estimatedTime = handler.getEstimatedRetryTime(errorType);
                        const expectedDelay = getRetryDelay(errorType);
                        
                        expect(estimatedTime).toBe(expectedDelay);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return -1 for estimated retry time when retries exhausted', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const handler = createFallbackHandler();
                        
                        // Exhaust all retries
                        for (let i = 0; i < 3; i++) {
                            const error = { type: 'network', message: 'Test error' };
                            handler.handleError(error, () => {});
                            vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        }
                        
                        const estimatedTime = handler.getEstimatedRetryTime('network');
                        expect(estimatedTime).toBe(-1);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Additional tests for FallbackHandler functionality
     */
    describe('FallbackHandler Additional Tests', () => {
        it('should clear pending retry when clearPendingRetry is called', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const handler = createFallbackHandler();
                        const retryFn = vi.fn();
                        
                        const error = { type: 'network', message: 'Test error' };
                        handler.handleError(error, retryFn);
                        
                        expect(handler.isWaitingForAutoRetry()).toBe(true);
                        
                        handler.clearPendingRetry();
                        
                        expect(handler.isWaitingForAutoRetry()).toBe(false);
                        
                        // Advance time - retry should not be called
                        vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        expect(retryFn).not.toHaveBeenCalled();
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should track last error type correctly', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom('network', 'server', 'timeout', 'media'),
                    (errorType) => {
                        const handler = createFallbackHandler();
                        
                        const error = { type: errorType, message: 'Test error' };
                        handler.handleError(error, () => {});
                        
                        expect(handler.getLastErrorType()).toBe(errorType);
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should call onAutoRetry callback with correct parameters', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 3 }),
                    (attemptNumber) => {
                        const autoRetryCallback = vi.fn();
                        const handler = createFallbackHandler({
                            onAutoRetry: autoRetryCallback,
                        });
                        
                        // Trigger retries up to attemptNumber
                        for (let i = 0; i < attemptNumber; i++) {
                            const error = { type: 'network', message: 'Test error' };
                            handler.handleError(error, () => {});
                            vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        }
                        
                        expect(autoRetryCallback).toHaveBeenCalledTimes(attemptNumber);
                        
                        // Check last call
                        const lastCall = autoRetryCallback.mock.calls[attemptNumber - 1][0];
                        expect(lastCall.attempt).toBe(attemptNumber);
                        expect(lastCall.maxAttempts).toBe(3);
                        expect(lastCall.delay).toBe(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        expect(lastCall.errorType).toBe('network');
                        
                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should destroy handler and clean up resources', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const handler = createFallbackHandler();
                        const retryFn = vi.fn();
                        
                        // Start a retry
                        const error = { type: 'network', message: 'Test error' };
                        handler.handleError(error, retryFn);
                        
                        // Destroy
                        handler.destroy();
                        
                        // Advance time - retry should not be called
                        vi.advanceTimersByTime(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        expect(retryFn).not.toHaveBeenCalled();
                        
                        // State should be reset
                        expect(handler.getAutoRetryCount()).toBe(0);
                        expect(handler.getLastErrorType()).toBe(null);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
