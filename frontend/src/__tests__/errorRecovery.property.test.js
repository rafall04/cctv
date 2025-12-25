/**
 * Property-Based Tests for Error Recovery Module
 * 
 * **Property 6: Exponential Backoff Recovery**
 * **Validates: Requirements 3.1, 3.2, 3.4**
 * 
 * For any network error recovery attempt, the delay between retries SHALL follow
 * exponential backoff pattern: delay(n) = min(1000 * 2^n, 8000) milliseconds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
    getBackoffDelay,
    handleNetworkError,
    handleMediaError,
    handleFatalError,
    createErrorRecoveryHandler,
    ErrorTypes,
    RecoveryStatus,
    MAX_BACKOFF_DELAY,
    BASE_BACKOFF_DELAY,
    DEFAULT_MAX_RETRIES,
} from '../utils/errorRecovery';

describe('Error Recovery Property Tests', () => {
    /**
     * Property 6: Exponential Backoff Recovery
     * Feature: media-player-optimization, Property 6: Exponential Backoff Recovery
     * Validates: Requirements 3.1
     */
    describe('Property 6: Exponential Backoff Recovery', () => {
        it('should follow exponential backoff pattern: delay(n) = min(1000 * 2^n, 8000)', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }), // retryCount
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        const expectedDelay = Math.min(BASE_BACKOFF_DELAY * Math.pow(2, retryCount), MAX_BACKOFF_DELAY);
                        
                        expect(delay).toBe(expectedDelay);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 1000ms for retryCount=0', () => {
            fc.assert(
                fc.property(
                    fc.constant(0),
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        expect(delay).toBe(1000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 2000ms for retryCount=1', () => {
            fc.assert(
                fc.property(
                    fc.constant(1),
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        expect(delay).toBe(2000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 4000ms for retryCount=2', () => {
            fc.assert(
                fc.property(
                    fc.constant(2),
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        expect(delay).toBe(4000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should cap at 8000ms (MAX_BACKOFF_DELAY) for retryCount >= 3', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 3, max: 100 }), // retryCount >= 3
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        expect(delay).toBe(MAX_BACKOFF_DELAY);
                        expect(delay).toBe(8000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should never exceed MAX_BACKOFF_DELAY for any retryCount', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 1000 }), // Any reasonable retryCount
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        expect(delay).toBeLessThanOrEqual(MAX_BACKOFF_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should never be less than BASE_BACKOFF_DELAY for non-negative retryCount', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 100 }),
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        expect(delay).toBeGreaterThanOrEqual(BASE_BACKOFF_DELAY);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle negative retryCount by treating as 0', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: -100, max: -1 }), // Negative values
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        expect(delay).toBe(BASE_BACKOFF_DELAY); // Should be 1000ms
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle floating point retryCount by flooring', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0, max: 10, noNaN: true }),
                    (retryCount) => {
                        const delay = getBackoffDelay(retryCount);
                        const expectedDelay = Math.min(
                            BASE_BACKOFF_DELAY * Math.pow(2, Math.floor(retryCount)),
                            MAX_BACKOFF_DELAY
                        );
                        expect(delay).toBe(expectedDelay);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('delay should be monotonically increasing until cap', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 2 }), // Before cap
                    (retryCount) => {
                        const currentDelay = getBackoffDelay(retryCount);
                        const nextDelay = getBackoffDelay(retryCount + 1);
                        
                        // Next delay should be >= current (monotonic)
                        expect(nextDelay).toBeGreaterThanOrEqual(currentDelay);
                        
                        // Before cap, next should be exactly 2x current
                        if (currentDelay < MAX_BACKOFF_DELAY) {
                            expect(nextDelay).toBe(Math.min(currentDelay * 2, MAX_BACKOFF_DELAY));
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Network Error Handling', () => {
        it('should fail when retryCount >= maxRetries', async () => {
            fc.assert(
                await fc.asyncProperty(
                    fc.integer({ min: 4, max: 10 }), // retryCount >= DEFAULT_MAX_RETRIES
                    async (retryCount) => {
                        const mockHls = { startLoad: vi.fn() };
                        const result = await handleNetworkError(mockHls, retryCount, DEFAULT_MAX_RETRIES);
                        
                        expect(result.status).toBe(RecoveryStatus.FAILED);
                        expect(result.message).toBe('Max retries exceeded');
                        expect(mockHls.startLoad).not.toHaveBeenCalled();
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('should return RETRY status when retryCount < maxRetries', async () => {
            fc.assert(
                await fc.asyncProperty(
                    fc.integer({ min: 0, max: 3 }), // retryCount < DEFAULT_MAX_RETRIES
                    async (retryCount) => {
                        const mockHls = { startLoad: vi.fn() };
                        const result = await handleNetworkError(mockHls, retryCount, DEFAULT_MAX_RETRIES);
                        
                        expect(result.status).toBe(RecoveryStatus.RETRY);
                        expect(result.retryCount).toBe(retryCount + 1);
                        expect(mockHls.startLoad).toHaveBeenCalled();
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('should return correct delay in result', async () => {
            fc.assert(
                await fc.asyncProperty(
                    fc.integer({ min: 0, max: 3 }),
                    async (retryCount) => {
                        const mockHls = { startLoad: vi.fn() };
                        const result = await handleNetworkError(mockHls, retryCount, DEFAULT_MAX_RETRIES);
                        
                        const expectedDelay = getBackoffDelay(retryCount);
                        expect(result.delay).toBe(expectedDelay);
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('should fail with invalid HLS instance', async () => {
            fc.assert(
                await fc.asyncProperty(
                    fc.integer({ min: 0, max: 3 }),
                    async (retryCount) => {
                        const result = await handleNetworkError(null, retryCount);
                        expect(result.status).toBe(RecoveryStatus.FAILED);
                        expect(result.message).toBe('Invalid HLS instance');
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Media Error Handling', () => {
        it('should call recoverMediaError on valid HLS instance', async () => {
            const mockHls = {
                recoverMediaError: vi.fn(),
                swapAudioCodec: vi.fn(),
            };
            
            const result = await handleMediaError(mockHls);
            
            expect(result.status).toBe(RecoveryStatus.SUCCESS);
            expect(result.method).toBe('recoverMediaError');
            expect(mockHls.recoverMediaError).toHaveBeenCalled();
        });

        it('should fail with invalid HLS instance', async () => {
            const result = await handleMediaError(null);
            
            expect(result.status).toBe(RecoveryStatus.FAILED);
            expect(result.method).toBe('none');
        });

        it('should try swapAudioCodec if recoverMediaError fails', async () => {
            const mockHls = {
                recoverMediaError: vi.fn()
                    .mockImplementationOnce(() => { throw new Error('Failed'); })
                    .mockImplementationOnce(() => {}),
                swapAudioCodec: vi.fn(),
            };
            
            const result = await handleMediaError(mockHls);
            
            expect(result.status).toBe(RecoveryStatus.SUCCESS);
            expect(result.method).toBe('swapAudioCodec');
            expect(mockHls.swapAudioCodec).toHaveBeenCalled();
        });
    });

    describe('Fatal Error Handling', () => {
        it('should destroy HLS instance on fatal error', () => {
            const mockHls = { destroy: vi.fn() };
            const onDestroy = vi.fn();
            
            const result = handleFatalError(mockHls, onDestroy);
            
            expect(result.status).toBe(RecoveryStatus.FAILED);
            expect(mockHls.destroy).toHaveBeenCalled();
            expect(onDestroy).toHaveBeenCalled();
        });

        it('should handle null HLS instance', () => {
            const result = handleFatalError(null);
            
            expect(result.status).toBe(RecoveryStatus.FAILED);
            expect(result.message).toBe('Fatal error - invalid HLS instance');
        });

        it('should handle destroy throwing error', () => {
            const mockHls = {
                destroy: vi.fn().mockImplementation(() => {
                    throw new Error('Destroy failed');
                }),
            };
            
            const result = handleFatalError(mockHls);
            
            expect(result.status).toBe(RecoveryStatus.FAILED);
            expect(result.message).toContain('destroy failed');
        });
    });

    describe('Error Recovery Handler', () => {
        it('should track retry count correctly', async () => {
            const handler = createErrorRecoveryHandler({ maxRetries: 4 });
            const mockHls = { startLoad: vi.fn() };
            
            expect(handler.getRetryCount()).toBe(0);
            
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            expect(handler.getRetryCount()).toBe(1);
            
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            expect(handler.getRetryCount()).toBe(2);
        });

        it('should reset retry count', async () => {
            const handler = createErrorRecoveryHandler({ maxRetries: 4 });
            const mockHls = { startLoad: vi.fn() };
            
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            expect(handler.getRetryCount()).toBe(1);
            
            handler.reset();
            expect(handler.getRetryCount()).toBe(0);
        });

        it('should ignore non-fatal errors', async () => {
            const handler = createErrorRecoveryHandler();
            const mockHls = { startLoad: vi.fn() };
            
            const result = await handler.handleError(mockHls, { fatal: false, type: 'networkError' });
            
            expect(result.status).toBe('ignored');
            expect(handler.getRetryCount()).toBe(0);
        });

        it('should call onRetry callback with correct parameters', async () => {
            const onRetry = vi.fn();
            const handler = createErrorRecoveryHandler({ onRetry });
            const mockHls = { startLoad: vi.fn() };
            
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            
            expect(onRetry).toHaveBeenCalledWith(0, 1000); // retryCount=0, delay=1000
        });

        it('should call onRecovery callback on successful recovery', async () => {
            const onRecovery = vi.fn();
            const handler = createErrorRecoveryHandler({ onRecovery });
            const mockHls = { startLoad: vi.fn() };
            
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            
            expect(onRecovery).toHaveBeenCalledWith('network', expect.objectContaining({
                status: RecoveryStatus.RETRY,
            }));
        });

        it('should call onFailed callback when max retries exceeded', async () => {
            const onFailed = vi.fn();
            const handler = createErrorRecoveryHandler({ maxRetries: 1, onFailed });
            const mockHls = { startLoad: vi.fn() };
            
            // First retry succeeds
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            
            // Second retry fails (max retries = 1)
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            
            expect(onFailed).toHaveBeenCalledWith('network', expect.objectContaining({
                status: RecoveryStatus.FAILED,
            }));
        });

        it('should reset retry count on successful media error recovery', async () => {
            const handler = createErrorRecoveryHandler();
            const mockHls = {
                startLoad: vi.fn(),
                recoverMediaError: vi.fn(),
            };
            
            // Simulate some network retries
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            await handler.handleError(mockHls, { fatal: true, type: 'networkError' });
            expect(handler.getRetryCount()).toBe(2);
            
            // Media error recovery should reset count
            await handler.handleError(mockHls, { fatal: true, type: 'mediaError' });
            expect(handler.getRetryCount()).toBe(0);
        });
    });

    describe('Constants', () => {
        it('should have correct constant values', () => {
            expect(MAX_BACKOFF_DELAY).toBe(8000);
            expect(BASE_BACKOFF_DELAY).toBe(1000);
            expect(DEFAULT_MAX_RETRIES).toBe(4);
        });

        it('should have correct ErrorTypes', () => {
            expect(ErrorTypes.NETWORK).toBe('networkError');
            expect(ErrorTypes.MEDIA).toBe('mediaError');
            expect(ErrorTypes.FATAL).toBe('fatalError');
        });

        it('should have correct RecoveryStatus', () => {
            expect(RecoveryStatus.SUCCESS).toBe('success');
            expect(RecoveryStatus.RETRY).toBe('retry');
            expect(RecoveryStatus.FAILED).toBe('failed');
        });
    });
});
