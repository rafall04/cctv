/**
 * Property-Based Tests for StreamController
 * 
 * **Property 9: Visibility-based Stream Control**
 * **Validates: Requirements 4.2, 4.3**
 * 
 * For any visibility state change:
 * - When isVisible changes from true to false, stream SHALL be paused after delay
 * - When isVisible changes from false to true, stream SHALL resume playback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    createStreamController,
    getPauseDelayForTier,
    StreamStatus,
} from '../utils/streamController';
import { createVisibilityObserver } from '../utils/visibilityObserver';

// Mock video element
const createMockVideoElement = () => ({
    paused: true,
    src: '',
    pause: vi.fn(function() { this.paused = true; }),
    play: vi.fn(function() { 
        this.paused = false; 
        return Promise.resolve(); 
    }),
    load: vi.fn(),
});

describe('StreamController Property Tests', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    
    afterEach(() => {
        vi.useRealTimers();
    });
    
    /**
     * Property 9: Visibility-based Stream Control
     * Feature: media-player-optimization, Property 9: Visibility-based Stream Control
     * Validates: Requirements 4.2, 4.3
     */
    describe('Property 9: Visibility-based Stream Control', () => {
        it('should start in IDLE status', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const videoElement = createMockVideoElement();
                        const controller = createStreamController(videoElement, 'http://test.m3u8');
                        
                        expect(controller.getStatus()).toBe(StreamStatus.IDLE);
                        
                        controller.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should transition to LOADING after initialize', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const videoElement = createMockVideoElement();
                        const controller = createStreamController(videoElement, 'http://test.m3u8');
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        
                        expect(controller.getStatus()).toBe(StreamStatus.LOADING);
                        
                        controller.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should transition to PLAYING when setPlaying is called', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const videoElement = createMockVideoElement();
                        const controller = createStreamController(videoElement, 'http://test.m3u8');
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        controller.setPlaying();
                        
                        expect(controller.getStatus()).toBe(StreamStatus.PLAYING);
                        
                        controller.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should pause immediately when pause() is called', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const videoElement = createMockVideoElement();
                        videoElement.paused = false;
                        
                        const controller = createStreamController(videoElement, 'http://test.m3u8');
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        controller.setPlaying();
                        controller.pause();
                        
                        expect(controller.getStatus()).toBe(StreamStatus.PAUSED);
                        expect(videoElement.pause).toHaveBeenCalled();
                        
                        controller.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should resume when resume() is called after pause', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const videoElement = createMockVideoElement();
                        const controller = createStreamController(videoElement, 'http://test.m3u8');
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        controller.setPlaying();
                        controller.pause();
                        controller.resume();
                        
                        expect(controller.getStatus()).toBe(StreamStatus.PLAYING);
                        expect(videoElement.play).toHaveBeenCalled();
                        
                        controller.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should schedule pause after delay when visibility changes to false', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1000, max: 10000 }), // pauseDelay
                    (pauseDelay) => {
                        const videoElement = createMockVideoElement();
                        videoElement.paused = false;
                        
                        const controller = createStreamController(videoElement, 'http://test.m3u8', {
                            pauseDelay,
                        });
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        controller.setPlaying();
                        
                        // Simulate visibility change to false
                        controller.setVisibility(false);
                        
                        // Should still be playing before delay
                        expect(controller.getStatus()).toBe(StreamStatus.PLAYING);
                        
                        // Advance time by pause delay
                        vi.advanceTimersByTime(pauseDelay);
                        
                        // Should now be paused
                        expect(controller.getStatus()).toBe(StreamStatus.PAUSED);
                        
                        controller.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should cancel scheduled pause when visibility changes back to true', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1000, max: 10000 }), // pauseDelay
                    fc.integer({ min: 100, max: 500 }), // time before visibility returns
                    (pauseDelay, earlyReturn) => {
                        // Ensure earlyReturn is less than pauseDelay
                        const actualEarlyReturn = Math.min(earlyReturn, pauseDelay - 100);
                        
                        const videoElement = createMockVideoElement();
                        videoElement.paused = false;
                        
                        const controller = createStreamController(videoElement, 'http://test.m3u8', {
                            pauseDelay,
                        });
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        controller.setPlaying();
                        
                        // Simulate visibility change to false
                        controller.setVisibility(false);
                        
                        // Advance time partially
                        vi.advanceTimersByTime(actualEarlyReturn);
                        
                        // Should still be playing
                        expect(controller.getStatus()).toBe(StreamStatus.PLAYING);
                        
                        // Visibility returns to true
                        controller.setVisibility(true);
                        
                        // Advance time past original pause delay
                        vi.advanceTimersByTime(pauseDelay);
                        
                        // Should still be playing (pause was cancelled)
                        expect(controller.getStatus()).toBe(StreamStatus.PLAYING);
                        
                        controller.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should auto-resume when visibility returns and autoResume is true', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1000, max: 5000 }), // pauseDelay
                    (pauseDelay) => {
                        const videoElement = createMockVideoElement();
                        videoElement.paused = false;
                        
                        const controller = createStreamController(videoElement, 'http://test.m3u8', {
                            pauseDelay,
                            autoResume: true,
                        });
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        controller.setPlaying();
                        
                        // Simulate visibility change to false and wait for pause
                        controller.setVisibility(false);
                        vi.advanceTimersByTime(pauseDelay);
                        
                        expect(controller.getStatus()).toBe(StreamStatus.PAUSED);
                        
                        // Visibility returns
                        controller.setVisibility(true);
                        
                        // Should auto-resume
                        expect(controller.getStatus()).toBe(StreamStatus.PLAYING);
                        
                        controller.destroy();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should transition to DESTROYED after destroy()', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(StreamStatus.IDLE, StreamStatus.LOADING, StreamStatus.PLAYING, StreamStatus.PAUSED),
                    (initialStatus) => {
                        const videoElement = createMockVideoElement();
                        const controller = createStreamController(videoElement, 'http://test.m3u8');
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        
                        if (initialStatus === StreamStatus.PLAYING) {
                            controller.setPlaying();
                        } else if (initialStatus === StreamStatus.PAUSED) {
                            controller.setPlaying();
                            controller.pause();
                        }
                        
                        controller.destroy();
                        
                        expect(controller.getStatus()).toBe(StreamStatus.DESTROYED);
                        expect(mockHls.destroy).toHaveBeenCalled();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not allow state changes after destroy', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const videoElement = createMockVideoElement();
                        const controller = createStreamController(videoElement, 'http://test.m3u8');
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        controller.destroy();
                        
                        // Try to change state after destroy
                        controller.setPlaying();
                        controller.pause();
                        controller.resume();
                        
                        // Should remain destroyed
                        expect(controller.getStatus()).toBe(StreamStatus.DESTROYED);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should call onStatusChange callback on status transitions', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const videoElement = createMockVideoElement();
                        const statusChanges = [];
                        
                        const controller = createStreamController(videoElement, 'http://test.m3u8', {
                            onStatusChange: (status) => statusChanges.push(status),
                        });
                        
                        const mockHls = { destroy: vi.fn() };
                        controller.initialize(mockHls);
                        controller.setPlaying();
                        controller.pause();
                        controller.resume();
                        controller.destroy();
                        
                        expect(statusChanges).toContain(StreamStatus.LOADING);
                        expect(statusChanges).toContain(StreamStatus.PLAYING);
                        expect(statusChanges).toContain(StreamStatus.PAUSED);
                        expect(statusChanges).toContain(StreamStatus.DESTROYED);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('getPauseDelayForTier', () => {
        it('should return shorter delay for low tier', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const lowDelay = getPauseDelayForTier('low');
                        const mediumDelay = getPauseDelayForTier('medium');
                        
                        expect(lowDelay).toBeLessThan(mediumDelay);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return longer delay for high tier', () => {
            fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const highDelay = getPauseDelayForTier('high');
                        const mediumDelay = getPauseDelayForTier('medium');
                        
                        expect(highDelay).toBeGreaterThan(mediumDelay);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return valid delay for all tiers', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const delay = getPauseDelayForTier(tier);
                        
                        expect(typeof delay).toBe('number');
                        expect(delay).toBeGreaterThan(0);
                        expect(delay).toBeLessThanOrEqual(10000);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});

describe('VisibilityObserver Property Tests', () => {
    it('should track observed elements correctly', () => {
        // Skip if IntersectionObserver is not available (jsdom)
        if (typeof IntersectionObserver === 'undefined') {
            // Mock IntersectionObserver for testing
            global.IntersectionObserver = class {
                constructor(callback) {
                    this.callback = callback;
                    this.elements = new Set();
                }
                observe(el) { this.elements.add(el); }
                unobserve(el) { this.elements.delete(el); }
                disconnect() { this.elements.clear(); }
            };
        }
        
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10 }),
                (elementCount) => {
                    const observer = createVisibilityObserver();
                    const elements = [];
                    
                    // Create mock elements
                    for (let i = 0; i < elementCount; i++) {
                        elements.push(document.createElement('div'));
                    }
                    
                    // Observe all elements
                    elements.forEach(el => {
                        observer.observe(el, () => {});
                    });
                    
                    expect(observer.getObservedCount()).toBe(elementCount);
                    
                    // Unobserve half
                    const halfCount = Math.floor(elementCount / 2);
                    for (let i = 0; i < halfCount; i++) {
                        observer.unobserve(elements[i]);
                    }
                    
                    expect(observer.getObservedCount()).toBe(elementCount - halfCount);
                    
                    observer.disconnect();
                    expect(observer.getObservedCount()).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });
});
