/**
 * Property-Based Tests for Retry Logic with Exponential Backoff
 * 
 * **Property 9: Retry Logic with Exponential Backoff**
 * **Validates: Requirements 10.7**
 * 
 * For any failed API request configured for retry, the system SHALL retry up to 3 times
 * with delays following exponential backoff pattern: 1st retry after 1s, 2nd after 2s,
 * 3rd after 4s. After max retries, the error SHALL be surfaced to the user.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    RETRY_CONFIG,
    getRetryDelay,
    isRetryableError,
    retryWithBackoff,
    createRetryHandler,
} from '../hooks/useApiError';

describe('Retry Logic Property Tests', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Property 9: Retry Logic with Exponential Backoff
     * Feature: admin-ux-improvement, Property 9: Retry Logic with Exponential Backoff
     * Validates: Requirements 10.7
     */
    describe('Property 9: Retry Logic with Exponential Backoff', () => {
        it('should have MAX_RETRIES set to 3', () => {
            fc.assert(
                fc.property(
                    fc.constant(RETRY_CONFIG.MAX_RETRIES),
                    (maxRetries) => {
                        expect(maxRetries).toBe(3);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 1000ms (1s) delay for first retry (retryCount=0)', () => {
            fc.assert(
                fc.property(
                    fc.constant(0),
                    (retryCount) => {
                        const delay = getRetryDelay(retryCount);
                        expect(delay).toBe(1000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 2000ms (2s) delay for second retry (retryCount=1)', () => {
            fc.assert(
                fc.property(
                    fc.constant(1),
                    (retryCount) => {
                        const delay = getRetryDelay(retryCount);
                        expect(delay).toBe(2000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 4000ms (4s) delay for third retry (retryCount=2)', () => {
            fc.assert(
                fc.property(
                    fc.constant(2),
                    (retryCount) => {
                        const delay = getRetryDelay(retryCount);
                        expect(delay).toBe(4000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should cap delay at 4000ms (MAX_DELAY) for retryCount >= 2', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2, max: 100 }),
                    (retryCount) => {
                        const delay = getRetryDelay(retryCount);
                        expect(delay).toBe(RETRY_CONFIG.MAX_DELAY);
                        expect(delay).toBe(4000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should follow exponential backoff pattern: delay(n) = min(1000 * 2^n, 4000)', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }),
                    (retryCount) => {
                        const delay = getRetryDelay(retryCount);
                        const expectedDelay = Math.min(
                            RETRY_CONFIG.BASE_DELAY * Math.pow(2, retryCount),
                            RETRY_CONFIG.MAX_DELAY
                        );
                        expect(delay).toBe(expectedDelay);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should never exceed MAX_DELAY for any retryCount', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 1000 }),
                    (retryCount) => {
                        const delay = getRetryDelay(retryCount);
                        expect(delay).toBeLessThanOrEqual(RETRY_CONFIG.MAX_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should never be less than BASE_DELAY for non-negative retryCount', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 100 }),
                    (retryCount) => {
                        const delay = getRetryDelay(retryCount);
                        expect(delay).toBeGreaterThanOrEqual(RETRY_CONFIG.BASE_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle negative retryCount by treating as 0', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: -100, max: -1 }),
                    (retryCount) => {
                        const delay = getRetryDelay(retryCount);
                        expect(delay).toBe(RETRY_CONFIG.BASE_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('delay should be monotonically increasing until cap', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 1 }),
                    (retryCount) => {
                        const currentDelay = getRetryDelay(retryCount);
                        const nextDelay = getRetryDelay(retryCount + 1);
                        
                        // Next delay should be >= current (monotonic)
                        expect(nextDelay).toBeGreaterThanOrEqual(currentDelay);
                        
                        // Before cap, next should be exactly 2x current
                        if (currentDelay < RETRY_CONFIG.MAX_DELAY) {
                            expect(nextDelay).toBe(Math.min(currentDelay * 2, RETRY_CONFIG.MAX_DELAY));
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Retryable Error Detection', () => {
        it('should identify network errors as retryable', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        { code: 'ERR_NETWORK' },
                        { code: 'ECONNABORTED' },
                        { request: {}, response: undefined },
                        { message: 'Network Error' }
                    ),
                    (error) => {
                        expect(isRetryableError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should identify server errors (5xx) as retryable', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 500, max: 599 }),
                    (status) => {
                        const error = { response: { status } };
                        expect(isRetryableError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should identify timeout errors as retryable', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        { code: 'ECONNABORTED', message: 'timeout' },
                        { response: { status: 504 } }
                    ),
                    (error) => {
                        expect(isRetryableError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT identify auth errors (401) as retryable', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 401 } }),
                    (error) => {
                        expect(isRetryableError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT identify forbidden errors (403) as retryable', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 403 } }),
                    (error) => {
                        expect(isRetryableError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT identify validation errors (400, 422) as retryable', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(400, 422),
                    (status) => {
                        const error = { response: { status } };
                        expect(isRetryableError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT identify not found errors (404) as retryable', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 404 } }),
                    (error) => {
                        expect(isRetryableError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should NOT identify rate limit errors (429) as retryable', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 429 } }),
                    (error) => {
                        expect(isRetryableError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return false for null/undefined errors', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(null, undefined),
                    (error) => {
                        expect(isRetryableError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('retryWithBackoff Function', () => {
        it('should succeed immediately if function succeeds on first try', async () => {
            const successValue = 'success';
            const fn = vi.fn().mockResolvedValue(successValue);
            
            const result = await retryWithBackoff(fn);
            
            expect(result).toBe(successValue);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry up to maxRetries times for retryable errors', async () => {
            const networkError = { code: 'ERR_NETWORK' };
            const fn = vi.fn().mockRejectedValue(networkError);
            
            const promise = retryWithBackoff(fn, { maxRetries: 3 });
            
            // Advance through all retries
            await vi.advanceTimersByTimeAsync(1000); // 1st retry delay
            await vi.advanceTimersByTimeAsync(2000); // 2nd retry delay
            await vi.advanceTimersByTimeAsync(4000); // 3rd retry delay
            
            await expect(promise).rejects.toEqual(networkError);
            expect(fn).toHaveBeenCalledTimes(4); // Initial + 3 retries
        });

        it('should NOT retry for non-retryable errors', async () => {
            const authError = { response: { status: 401 } };
            const fn = vi.fn().mockRejectedValue(authError);
            
            await expect(retryWithBackoff(fn)).rejects.toEqual(authError);
            expect(fn).toHaveBeenCalledTimes(1); // No retries
        });

        it('should call onRetry callback with correct parameters', async () => {
            const networkError = { code: 'ERR_NETWORK' };
            const fn = vi.fn().mockRejectedValue(networkError);
            const onRetry = vi.fn();
            
            const promise = retryWithBackoff(fn, { maxRetries: 2, onRetry });
            
            // Advance through retries
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(2000);
            
            await expect(promise).rejects.toEqual(networkError);
            
            expect(onRetry).toHaveBeenCalledTimes(2);
            expect(onRetry).toHaveBeenNthCalledWith(1, 0, 1000, networkError);
            expect(onRetry).toHaveBeenNthCalledWith(2, 1, 2000, networkError);
        });

        it('should succeed if function succeeds after retries', async () => {
            const successValue = 'success';
            const networkError = { code: 'ERR_NETWORK' };
            const fn = vi.fn()
                .mockRejectedValueOnce(networkError)
                .mockRejectedValueOnce(networkError)
                .mockResolvedValue(successValue);
            
            const promise = retryWithBackoff(fn, { maxRetries: 3 });
            
            // Advance through retries
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(2000);
            
            const result = await promise;
            
            expect(result).toBe(successValue);
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should use custom shouldRetry function when provided', async () => {
            const customError = { custom: true };
            const fn = vi.fn().mockRejectedValue(customError);
            const shouldRetry = vi.fn().mockReturnValue(false);
            
            await expect(retryWithBackoff(fn, { shouldRetry })).rejects.toEqual(customError);
            
            expect(fn).toHaveBeenCalledTimes(1);
            expect(shouldRetry).toHaveBeenCalledWith(customError);
        });
    });

    describe('createRetryHandler', () => {
        it('should track attempt count correctly', async () => {
            const networkError = { code: 'ERR_NETWORK' };
            const fn = vi.fn().mockRejectedValue(networkError);
            const handler = createRetryHandler({ maxRetries: 2 });
            
            const promise = handler.execute(fn);
            
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(2000);
            
            await expect(promise).rejects.toEqual(networkError);
            expect(handler.getAttemptCount()).toBe(2);
        });

        it('should reset attempt count', async () => {
            const networkError = { code: 'ERR_NETWORK' };
            const fn = vi.fn().mockRejectedValue(networkError);
            const handler = createRetryHandler({ maxRetries: 1 });
            
            const promise = handler.execute(fn);
            await vi.advanceTimersByTimeAsync(1000);
            await expect(promise).rejects.toEqual(networkError);
            
            expect(handler.getAttemptCount()).toBe(1);
            
            handler.reset();
            expect(handler.getAttemptCount()).toBe(0);
        });

        it('should call onSuccess callback on successful execution', async () => {
            const successValue = 'success';
            const fn = vi.fn().mockResolvedValue(successValue);
            const onSuccess = vi.fn();
            const handler = createRetryHandler({ onSuccess });
            
            await handler.execute(fn);
            
            expect(onSuccess).toHaveBeenCalledWith(successValue);
        });

        it('should call onFailure callback when all retries exhausted', async () => {
            const networkError = { code: 'ERR_NETWORK' };
            const fn = vi.fn().mockRejectedValue(networkError);
            const onFailure = vi.fn();
            const handler = createRetryHandler({ maxRetries: 1, onFailure });
            
            const promise = handler.execute(fn);
            await vi.advanceTimersByTimeAsync(1000);
            
            await expect(promise).rejects.toEqual(networkError);
            expect(onFailure).toHaveBeenCalledWith(networkError, 1);
        });

        it('should call onRetry callback before each retry', async () => {
            const networkError = { code: 'ERR_NETWORK' };
            const fn = vi.fn().mockRejectedValue(networkError);
            const onRetry = vi.fn();
            const handler = createRetryHandler({ maxRetries: 2, onRetry });
            
            const promise = handler.execute(fn);
            
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(2000);
            
            await expect(promise).rejects.toEqual(networkError);
            
            expect(onRetry).toHaveBeenCalledTimes(2);
            expect(onRetry).toHaveBeenNthCalledWith(1, 0, 1000, networkError);
            expect(onRetry).toHaveBeenNthCalledWith(2, 1, 2000, networkError);
        });
    });

    describe('Constants', () => {
        it('should have correct RETRY_CONFIG values', () => {
            expect(RETRY_CONFIG.MAX_RETRIES).toBe(3);
            expect(RETRY_CONFIG.BASE_DELAY).toBe(1000);
            expect(RETRY_CONFIG.MAX_DELAY).toBe(4000);
        });
    });
});
