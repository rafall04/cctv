/**
 * Property-Based Tests for Cleanup on Unmount
 * 
 * **Property 12: Cleanup on Unmount**
 * **Validates: Requirements 7.4, 7.5**
 * 
 * For any component unmount during loading, all resources SHALL be cleaned up 
 * immediately (HLS destroyed, timeouts cleared, listeners removed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as unmountCleanupModule from '../utils/unmountCleanup';

const { 
    createCleanupManager, 
    combineCleanups, 
    createSafeTimeout,
    createSafeInterval,
    createSafeAbortController,
} = unmountCleanupModule;

describe('UnmountCleanup Property Tests', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Property 12: Cleanup on Unmount
     * Feature: stream-loading-fix, Property 12: Cleanup on Unmount
     * Validates: Requirements 7.4, 7.5
     */
    describe('Property 12: Cleanup on Unmount', () => {
        it('should clear all registered timeouts on cleanup', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10 }),
                    (numTimeouts) => {
                        const manager = createCleanupManager();
                        const callbacks = [];

                        for (let i = 0; i < numTimeouts; i++) {
                            const callback = vi.fn();
                            callbacks.push(callback);
                            const timeoutId = setTimeout(callback, 1000 + i * 100);
                            manager.registerTimeout(timeoutId);
                        }

                        expect(manager.getResourceCounts().timeouts).toBe(numTimeouts);
                        manager.cleanup();
                        vi.advanceTimersByTime(5000);

                        callbacks.forEach(cb => {
                            expect(cb).not.toHaveBeenCalled();
                        });

                        expect(manager.isCleanedUp()).toBe(true);
                        expect(manager.getResourceCounts().timeouts).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should clear all registered intervals on cleanup', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (numIntervals) => {
                        const manager = createCleanupManager();
                        const callbacks = [];

                        for (let i = 0; i < numIntervals; i++) {
                            const callback = vi.fn();
                            callbacks.push(callback);
                            const intervalId = setInterval(callback, 100);
                            manager.registerInterval(intervalId);
                        }

                        expect(manager.getResourceCounts().intervals).toBe(numIntervals);
                        manager.cleanup();
                        vi.advanceTimersByTime(1000);

                        callbacks.forEach(cb => {
                            expect(cb).not.toHaveBeenCalled();
                        });

                        expect(manager.getResourceCounts().intervals).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should abort all registered AbortControllers on cleanup', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (numControllers) => {
                        const manager = createCleanupManager();
                        const controllers = [];

                        for (let i = 0; i < numControllers; i++) {
                            const controller = new AbortController();
                            controllers.push(controller);
                            manager.registerAbortController(controller);
                        }

                        expect(manager.getResourceCounts().abortControllers).toBe(numControllers);
                        manager.cleanup();

                        controllers.forEach(controller => {
                            expect(controller.signal.aborted).toBe(true);
                        });

                        expect(manager.getResourceCounts().abortControllers).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should remove all registered event listeners on cleanup', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (numListeners) => {
                        const manager = createCleanupManager();
                        const mockTarget = {
                            addEventListener: vi.fn(),
                            removeEventListener: vi.fn(),
                        };

                        for (let i = 0; i < numListeners; i++) {
                            const handler = vi.fn();
                            manager.registerEventListener(mockTarget, 'event' + i, handler);
                        }

                        expect(manager.getResourceCounts().eventListeners).toBe(numListeners);
                        expect(mockTarget.addEventListener).toHaveBeenCalledTimes(numListeners);

                        manager.cleanup();

                        expect(mockTarget.removeEventListener).toHaveBeenCalledTimes(numListeners);
                        expect(manager.getResourceCounts().eventListeners).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should destroy HLS instance on cleanup', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    (hasHls) => {
                        const manager = createCleanupManager();

                        if (hasHls) {
                            const mockHls = { destroy: vi.fn() };
                            manager.registerHls(mockHls);

                            expect(manager.getResourceCounts().hasHls).toBe(true);
                            manager.cleanup();

                            expect(mockHls.destroy).toHaveBeenCalledTimes(1);
                            expect(manager.getResourceCounts().hasHls).toBe(false);
                        } else {
                            expect(() => manager.cleanup()).not.toThrow();
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should clear video element on cleanup', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    (hasVideo) => {
                        const manager = createCleanupManager();

                        if (hasVideo) {
                            const mockVideo = {
                                pause: vi.fn(),
                                load: vi.fn(),
                                src: 'http://example.com/stream.m3u8',
                            };
                            manager.registerVideo(mockVideo);

                            expect(manager.getResourceCounts().hasVideo).toBe(true);
                            manager.cleanup();

                            expect(mockVideo.pause).toHaveBeenCalledTimes(1);
                            expect(mockVideo.src).toBe('');
                            expect(mockVideo.load).toHaveBeenCalledTimes(1);
                            expect(manager.getResourceCounts().hasVideo).toBe(false);
                        } else {
                            expect(() => manager.cleanup()).not.toThrow();
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should be safe to call cleanup multiple times (idempotent)', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (numCleanupCalls) => {
                        const manager = createCleanupManager();
                        const mockHls = { destroy: vi.fn() };
                        
                        manager.registerTimeout(setTimeout(vi.fn(), 1000));
                        manager.registerHls(mockHls);

                        for (let i = 0; i < numCleanupCalls; i++) {
                            expect(() => manager.cleanup()).not.toThrow();
                        }

                        expect(mockHls.destroy).toHaveBeenCalledTimes(1);
                        expect(manager.isCleanedUp()).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not register new resources after cleanup', () => {
            fc.assert(
                fc.property(
                    fc.constant(true),
                    () => {
                        const manager = createCleanupManager();
                        manager.cleanup();

                        const timeoutId = setTimeout(vi.fn(), 1000);
                        manager.registerTimeout(timeoutId);
                        
                        const intervalId = setInterval(vi.fn(), 100);
                        manager.registerInterval(intervalId);
                        
                        const controller = new AbortController();
                        manager.registerAbortController(controller);

                        const counts = manager.getResourceCounts();
                        expect(counts.timeouts).toBe(0);
                        expect(counts.intervals).toBe(0);
                        expect(counts.abortControllers).toBe(0);

                        clearTimeout(timeoutId);
                        clearInterval(intervalId);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });


    describe('combineCleanups helper', () => {
        it('should execute all cleanup functions', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 5 }),
                    (numFunctions) => {
                        const cleanupFns = [];
                        
                        for (let i = 0; i < numFunctions; i++) {
                            cleanupFns.push(vi.fn());
                        }

                        const combined = combineCleanups(...cleanupFns);
                        combined();

                        cleanupFns.forEach(fn => {
                            expect(fn).toHaveBeenCalledTimes(1);
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle errors in cleanup functions gracefully', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 4 }),
                    (errorIndex) => {
                        const cleanupFns = [
                            vi.fn(),
                            vi.fn(),
                            vi.fn(),
                            vi.fn(),
                            vi.fn(),
                        ];

                        cleanupFns[errorIndex] = vi.fn(() => {
                            throw new Error('Cleanup error');
                        });

                        const combined = combineCleanups(...cleanupFns);
                        expect(() => combined()).not.toThrow();

                        cleanupFns.forEach(fn => {
                            expect(fn).toHaveBeenCalledTimes(1);
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('createSafeTimeout helper', () => {
        it('should create timeout that can be cleared', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 100, max: 5000 }),
                    (delay) => {
                        const callback = vi.fn();
                        const { clear } = createSafeTimeout(callback, delay);

                        clear();
                        vi.advanceTimersByTime(delay + 100);

                        expect(callback).not.toHaveBeenCalled();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should register with cleanup manager when provided', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 100, max: 1000 }),
                    (delay) => {
                        const manager = createCleanupManager();
                        const callback = vi.fn();

                        createSafeTimeout(callback, delay, manager);

                        expect(manager.getResourceCounts().timeouts).toBe(1);

                        manager.cleanup();
                        vi.advanceTimersByTime(delay + 100);

                        expect(callback).not.toHaveBeenCalled();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('createSafeInterval helper', () => {
        it('should create interval that can be cleared', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 50, max: 500 }),
                    (delay) => {
                        const callback = vi.fn();
                        const { clear } = createSafeInterval(callback, delay);

                        vi.advanceTimersByTime(delay * 2);
                        const callCount = callback.mock.calls.length;
                        expect(callCount).toBeGreaterThan(0);

                        clear();
                        vi.advanceTimersByTime(delay * 5);

                        expect(callback.mock.calls.length).toBe(callCount);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('createSafeAbortController helper', () => {
        it('should create AbortController registered with manager', () => {
            fc.assert(
                fc.property(
                    fc.constant(true),
                    () => {
                        const manager = createCleanupManager();
                        const controller = createSafeAbortController(manager);

                        expect(manager.getResourceCounts().abortControllers).toBe(1);
                        expect(controller.signal.aborted).toBe(false);

                        manager.cleanup();
                        expect(controller.signal.aborted).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
