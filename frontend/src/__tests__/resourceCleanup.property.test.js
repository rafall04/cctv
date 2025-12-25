/**
 * Property-Based Tests for Resource Cleanup
 * 
 * **Property 5: Resource Cleanup Completeness**
 * For any stream lifecycle event (camera switch or component unmount), 
 * all associated resources (HLS instance, video element src, event listeners) 
 * SHALL be properly released.
 * 
 * **Validates: Requirements 2.4, 2.5**
 * 
 * Feature: media-player-optimization, Property 5: Resource Cleanup Completeness
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { createStreamController, StreamStatus } from '../utils/streamController';

// Mock video element factory
const createMockVideoElement = () => {
    const listeners = new Map();
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
        addEventListener: vi.fn((event, handler) => {
            if (!listeners.has(event)) {
                listeners.set(event, []);
            }
            listeners.get(event).push(handler);
        }),
        removeEventListener: vi.fn((event, handler) => {
            if (listeners.has(event)) {
                const handlers = listeners.get(event);
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }),
        _getListenerCount: (event) => {
            return listeners.has(event) ? listeners.get(event).length : 0;
        },
        _getAllListenerCount: () => {
            let count = 0;
            listeners.forEach(handlers => count += handlers.length);
            return count;
        },
    };
};

// Mock HLS instance factory
const createMockHLS = () => {
    let destroyed = false;
    const listeners = new Map();
    
    return {
        get destroyed() { return destroyed; },
        loadSource: vi.fn(),
        attachMedia: vi.fn(),
        startLoad: vi.fn(),
        stopLoad: vi.fn(),
        recoverMediaError: vi.fn(),
        swapAudioCodec: vi.fn(),
        destroy: vi.fn(() => { destroyed = true; }),
        on: vi.fn((event, handler) => {
            if (!listeners.has(event)) {
                listeners.set(event, []);
            }
            listeners.get(event).push(handler);
        }),
        off: vi.fn((event, handler) => {
            if (listeners.has(event)) {
                const handlers = listeners.get(event);
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }),
        _getListenerCount: () => {
            let count = 0;
            listeners.forEach(handlers => count += handlers.length);
            return count;
        },
    };
};

describe('Property 5: Resource Cleanup Completeness', () => {
    /**
     * **Validates: Requirements 2.4, 2.5**
     * Feature: media-player-optimization, Property 5: Resource Cleanup Completeness
     */
    
    describe('StreamController cleanup', () => {
        it('should destroy HLS instance on controller destroy', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (tier, streamUrl) => {
                        const videoElement = createMockVideoElement();
                        const hlsInstance = createMockHLS();
                        
                        const controller = createStreamController(videoElement, streamUrl, {
                            deviceTier: tier,
                        });
                        
                        // Initialize with HLS instance
                        controller.initialize(hlsInstance);
                        
                        // Verify HLS is not destroyed yet
                        expect(hlsInstance.destroyed).toBe(false);
                        
                        // Destroy controller
                        controller.destroy();
                        
                        // Verify HLS instance was destroyed
                        expect(hlsInstance.destroy).toHaveBeenCalled();
                        expect(hlsInstance.destroyed).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should clear video source on controller destroy', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.webUrl(),
                    (tier, streamUrl) => {
                        const videoElement = createMockVideoElement();
                        videoElement.src = streamUrl;
                        
                        const controller = createStreamController(videoElement, streamUrl, {
                            deviceTier: tier,
                        });
                        
                        controller.initialize(createMockHLS());
                        
                        // Destroy controller
                        controller.destroy();
                        
                        // Verify video source was cleared
                        expect(videoElement.src).toBe('');
                        expect(videoElement.load).toHaveBeenCalled();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should pause video on controller destroy', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (tier, streamUrl) => {
                        const videoElement = createMockVideoElement();
                        
                        const controller = createStreamController(videoElement, streamUrl, {
                            deviceTier: tier,
                        });
                        
                        controller.initialize(createMockHLS());
                        controller.setPlaying();
                        
                        // Destroy controller
                        controller.destroy();
                        
                        // Verify video was paused
                        expect(videoElement.pause).toHaveBeenCalled();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should set status to DESTROYED after cleanup', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (tier, streamUrl) => {
                        const videoElement = createMockVideoElement();
                        
                        const controller = createStreamController(videoElement, streamUrl, {
                            deviceTier: tier,
                        });
                        
                        controller.initialize(createMockHLS());
                        
                        // Destroy controller
                        controller.destroy();
                        
                        // Verify status is DESTROYED
                        expect(controller.getStatus()).toBe(StreamStatus.DESTROYED);
                        expect(controller.isActive()).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Multiple lifecycle operations', () => {
        it('should handle multiple init/destroy cycles without resource leaks', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10 }),
                    fc.constantFrom('low', 'medium', 'high'),
                    (cycles, tier) => {
                        const videoElement = createMockVideoElement();
                        const hlsInstances = [];
                        
                        for (let i = 0; i < cycles; i++) {
                            const hlsInstance = createMockHLS();
                            hlsInstances.push(hlsInstance);
                            
                            const controller = createStreamController(videoElement, `http://test.com/stream${i}`, {
                                deviceTier: tier,
                            });
                            
                            controller.initialize(hlsInstance);
                            controller.setPlaying();
                            controller.destroy();
                            
                            // Each HLS instance should be destroyed
                            expect(hlsInstance.destroyed).toBe(true);
                        }
                        
                        // All HLS instances should be destroyed
                        expect(hlsInstances.every(hls => hls.destroyed)).toBe(true);
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('should not allow operations after destroy', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (tier, streamUrl) => {
                        const videoElement = createMockVideoElement();
                        
                        const controller = createStreamController(videoElement, streamUrl, {
                            deviceTier: tier,
                        });
                        
                        controller.initialize(createMockHLS());
                        controller.destroy();
                        
                        // Reset mock call counts
                        videoElement.play.mockClear();
                        videoElement.pause.mockClear();
                        
                        // Try operations after destroy - should be no-ops
                        controller.pause();
                        controller.resume();
                        controller.setPlaying();
                        
                        // Status should remain DESTROYED
                        expect(controller.getStatus()).toBe(StreamStatus.DESTROYED);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Cleanup with different initial states', () => {
        it('should cleanup properly from any status', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        StreamStatus.IDLE,
                        StreamStatus.LOADING,
                        StreamStatus.PLAYING,
                        StreamStatus.PAUSED,
                        StreamStatus.ERROR
                    ),
                    fc.constantFrom('low', 'medium', 'high'),
                    (initialStatus, tier) => {
                        const videoElement = createMockVideoElement();
                        const hlsInstance = createMockHLS();
                        
                        const controller = createStreamController(videoElement, 'http://test.com/stream', {
                            deviceTier: tier,
                        });
                        
                        controller.initialize(hlsInstance);
                        
                        // Set to initial status
                        switch (initialStatus) {
                            case StreamStatus.PLAYING:
                                controller.setPlaying();
                                break;
                            case StreamStatus.PAUSED:
                                controller.pause();
                                break;
                            case StreamStatus.ERROR:
                                controller.setError(new Error('Test error'));
                                break;
                            // IDLE and LOADING are handled by initialize
                        }
                        
                        // Destroy from any state
                        controller.destroy();
                        
                        // Should always end up DESTROYED
                        expect(controller.getStatus()).toBe(StreamStatus.DESTROYED);
                        expect(hlsInstance.destroyed).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Timeout cleanup', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should clear pending pause timeout on destroy', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.integer({ min: 1000, max: 10000 }),
                    (tier, pauseDelay) => {
                        const videoElement = createMockVideoElement();
                        
                        const controller = createStreamController(videoElement, 'http://test.com/stream', {
                            deviceTier: tier,
                            pauseDelay,
                        });
                        
                        controller.initialize(createMockHLS());
                        controller.setPlaying();
                        
                        // Trigger visibility change to schedule pause
                        controller.setVisibility(false);
                        
                        // Destroy before timeout fires
                        controller.destroy();
                        
                        // Advance timers past the pause delay
                        vi.advanceTimersByTime(pauseDelay + 1000);
                        
                        // Status should still be DESTROYED (not PAUSED)
                        expect(controller.getStatus()).toBe(StreamStatus.DESTROYED);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Edge cases', () => {
        it('should handle destroy without initialize', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (tier, streamUrl) => {
                        const videoElement = createMockVideoElement();
                        
                        const controller = createStreamController(videoElement, streamUrl, {
                            deviceTier: tier,
                        });
                        
                        // Destroy without initialize - should not throw
                        expect(() => controller.destroy()).not.toThrow();
                        expect(controller.getStatus()).toBe(StreamStatus.DESTROYED);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle double destroy gracefully', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (tier, streamUrl) => {
                        const videoElement = createMockVideoElement();
                        const hlsInstance = createMockHLS();
                        
                        const controller = createStreamController(videoElement, streamUrl, {
                            deviceTier: tier,
                        });
                        
                        controller.initialize(hlsInstance);
                        
                        // Double destroy - should not throw
                        expect(() => {
                            controller.destroy();
                            controller.destroy();
                        }).not.toThrow();
                        
                        expect(controller.getStatus()).toBe(StreamStatus.DESTROYED);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle null/undefined video element gracefully', () => {
            // This tests the robustness of cleanup when video element is missing
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (tier, streamUrl) => {
                        // Create controller with null video element
                        const controller = createStreamController(null, streamUrl, {
                            deviceTier: tier,
                        });
                        
                        // Should not throw on destroy
                        expect(() => controller.destroy()).not.toThrow();
                    }
                ),
                { numRuns: 50 }
            );
        });
    });
});
