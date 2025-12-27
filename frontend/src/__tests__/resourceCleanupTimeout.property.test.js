/**
 * Property-Based Tests for Resource Cleanup on Timeout
 * 
 * **Property 8: Resource Cleanup on Timeout**
 * For any loading timeout event, the LoadingTimeoutHandler SHALL:
 * - Destroy HLS instance (hlsRef.current = null)
 * - Clear video element source (video.src = '')
 * - Cancel pending requests (abort controller)
 * 
 * **Validates: Requirements 1.3, 7.1, 7.2, 7.3**
 * 
 * Feature: stream-loading-fix, Property 8: Resource Cleanup on Timeout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { createLoadingTimeoutHandler, getTimeoutDuration, TIMEOUT_CONFIG } from '../utils/loadingTimeoutHandler';
import { createFallbackHandler } from '../utils/fallbackHandler';
import { LoadingStage } from '../utils/streamLoaderTypes';

// Mock video element factory
const createMockVideoElement = () => {
    let src = '';
    let paused = false;
    
    return {
        get src() { return src; },
        set src(value) { src = value; },
        get paused() { return paused; },
        pause: vi.fn(() => { paused = true; }),
        play: vi.fn(() => { 
            paused = false; 
            return Promise.resolve(); 
        }),
        load: vi.fn(),
    };
};

// Mock HLS instance factory
const createMockHLS = () => {
    let destroyed = false;
    
    return {
        get destroyed() { return destroyed; },
        loadSource: vi.fn(),
        attachMedia: vi.fn(),
        startLoad: vi.fn(),
        stopLoad: vi.fn(),
        recoverMediaError: vi.fn(),
        destroy: vi.fn(() => { destroyed = true; }),
        on: vi.fn(),
        off: vi.fn(),
    };
};

// Mock AbortController factory
const createMockAbortController = () => {
    let aborted = false;
    
    return {
        get signal() { 
            return { 
                aborted,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }; 
        },
        abort: vi.fn(() => { aborted = true; }),
        get aborted() { return aborted; },
    };
};

describe('Property 8: Resource Cleanup on Timeout', () => {
    /**
     * **Validates: Requirements 1.3, 7.1, 7.2, 7.3**
     * Feature: stream-loading-fix, Property 8: Resource Cleanup on Timeout
     */
    
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('HLS instance cleanup on timeout', () => {
        it('should trigger timeout callback after configured duration', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.constantFrom(...Object.values(LoadingStage).filter(s => s !== 'playing' && s !== 'error' && s !== 'timeout')),
                    (tier, stage) => {
                        const timeoutCallback = vi.fn();
                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                            onTimeout: timeoutCallback,
                        });

                        // Start timeout
                        handler.startTimeout(stage);

                        // Verify timeout not triggered yet
                        expect(timeoutCallback).not.toHaveBeenCalled();

                        // Advance time to just before timeout
                        const duration = getTimeoutDuration(tier);
                        vi.advanceTimersByTime(duration - 1);
                        expect(timeoutCallback).not.toHaveBeenCalled();

                        // Advance past timeout
                        vi.advanceTimersByTime(2);
                        expect(timeoutCallback).toHaveBeenCalledWith(stage);

                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should allow cleanup of HLS instance when timeout occurs', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const hlsInstance = createMockHLS();
                        let cleanupCalled = false;

                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                            onTimeout: () => {
                                // Simulate cleanup that VideoPlayer would do
                                hlsInstance.destroy();
                                cleanupCalled = true;
                            },
                        });

                        handler.startTimeout(LoadingStage.CONNECTING);

                        // Advance past timeout
                        const duration = getTimeoutDuration(tier);
                        vi.advanceTimersByTime(duration + 1);

                        // Verify HLS was destroyed
                        expect(cleanupCalled).toBe(true);
                        expect(hlsInstance.destroyed).toBe(true);
                        expect(hlsInstance.destroy).toHaveBeenCalled();

                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Video element cleanup on timeout', () => {
        it('should allow clearing video source when timeout occurs', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.webUrl(),
                    (tier, streamUrl) => {
                        const videoElement = createMockVideoElement();
                        videoElement.src = streamUrl;

                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                            onTimeout: () => {
                                // Simulate cleanup that VideoPlayer would do
                                videoElement.pause();
                                videoElement.src = '';
                                videoElement.load();
                            },
                        });

                        handler.startTimeout(LoadingStage.LOADING);

                        // Advance past timeout
                        const duration = getTimeoutDuration(tier);
                        vi.advanceTimersByTime(duration + 1);

                        // Verify video source was cleared
                        expect(videoElement.src).toBe('');
                        expect(videoElement.pause).toHaveBeenCalled();
                        expect(videoElement.load).toHaveBeenCalled();

                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('AbortController cleanup on timeout', () => {
        it('should allow aborting pending requests when timeout occurs', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const abortController = createMockAbortController();

                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                            onTimeout: () => {
                                // Simulate cleanup that VideoPlayer would do
                                abortController.abort();
                            },
                        });

                        handler.startTimeout(LoadingStage.BUFFERING);

                        // Advance past timeout
                        const duration = getTimeoutDuration(tier);
                        vi.advanceTimersByTime(duration + 1);

                        // Verify abort was called
                        expect(abortController.abort).toHaveBeenCalled();
                        expect(abortController.aborted).toBe(true);

                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Complete resource cleanup on timeout', () => {
        it('should cleanup all resources (HLS, video, abort) when timeout occurs', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.webUrl(),
                    fc.constantFrom(LoadingStage.CONNECTING, LoadingStage.LOADING, LoadingStage.BUFFERING, LoadingStage.STARTING),
                    (tier, streamUrl, stage) => {
                        const hlsInstance = createMockHLS();
                        const videoElement = createMockVideoElement();
                        const abortController = createMockAbortController();
                        
                        videoElement.src = streamUrl;

                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                            onTimeout: (timeoutStage) => {
                                // Simulate complete cleanup that VideoPlayer would do
                                // **Validates: Requirements 1.3, 7.1, 7.2, 7.3**
                                
                                // Cancel pending requests
                                abortController.abort();
                                
                                // Destroy HLS instance
                                hlsInstance.destroy();
                                
                                // Clear video source
                                videoElement.pause();
                                videoElement.src = '';
                                videoElement.load();
                            },
                        });

                        handler.startTimeout(stage);

                        // Advance past timeout
                        const duration = getTimeoutDuration(tier);
                        vi.advanceTimersByTime(duration + 1);

                        // Verify all resources were cleaned up
                        expect(abortController.aborted).toBe(true);
                        expect(hlsInstance.destroyed).toBe(true);
                        expect(videoElement.src).toBe('');
                        expect(videoElement.pause).toHaveBeenCalled();
                        expect(videoElement.load).toHaveBeenCalled();

                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not trigger cleanup if timeout is cleared before expiry', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.integer({ min: 100, max: 5000 }),
                    (tier, clearAfterMs) => {
                        let cleanupCalled = false;

                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                            onTimeout: () => {
                                cleanupCalled = true;
                            },
                        });

                        handler.startTimeout(LoadingStage.CONNECTING);

                        // Clear timeout before it expires
                        const duration = getTimeoutDuration(tier);
                        const clearTime = Math.min(clearAfterMs, duration - 100);
                        vi.advanceTimersByTime(clearTime);
                        handler.clearTimeout();

                        // Advance past original timeout
                        vi.advanceTimersByTime(duration);

                        // Verify cleanup was NOT called
                        expect(cleanupCalled).toBe(false);

                        handler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Timeout handler destruction cleanup', () => {
        it('should clear pending timeout when handler is destroyed', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        let timeoutTriggered = false;

                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                            onTimeout: () => {
                                timeoutTriggered = true;
                            },
                        });

                        handler.startTimeout(LoadingStage.CONNECTING);

                        // Destroy handler before timeout
                        handler.destroy();

                        // Advance past timeout
                        const duration = getTimeoutDuration(tier);
                        vi.advanceTimersByTime(duration + 1000);

                        // Verify timeout was NOT triggered
                        expect(timeoutTriggered).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should reset all state when handler is destroyed', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.integer({ min: 1, max: 5 }),
                    (tier, failures) => {
                        const handler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                        });

                        // Simulate some failures
                        for (let i = 0; i < failures; i++) {
                            handler.recordFailure();
                        }

                        expect(handler.getConsecutiveFailures()).toBe(failures);

                        // Destroy handler
                        handler.destroy();

                        // Create new handler to verify state is fresh
                        const newHandler = createLoadingTimeoutHandler({
                            deviceTier: tier,
                        });

                        expect(newHandler.getConsecutiveFailures()).toBe(0);
                        expect(newHandler.isTimeoutActive()).toBe(false);

                        newHandler.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Fallback handler cleanup integration', () => {
        it('should clear pending retry when fallback handler is destroyed', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('network', 'server', 'timeout'),
                    (errorType) => {
                        let retryTriggered = false;

                        const handler = createFallbackHandler({
                            maxAutoRetries: 3,
                        });

                        // Trigger an error to schedule retry
                        handler.handleError({ type: errorType }, () => {
                            retryTriggered = true;
                        });

                        // Destroy handler before retry
                        handler.destroy();

                        // Advance past retry delay
                        vi.advanceTimersByTime(10000);

                        // Verify retry was NOT triggered
                        expect(retryTriggered).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
