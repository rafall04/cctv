/**
 * Property-Based Tests for MultiViewManager
 * 
 * **Property 10: Multi-View Stream Limits**
 * **Validates: Requirements 4.5**
 * 
 * For any Multi-View activation on a device with tier T, the number of concurrent
 * streams SHALL NOT exceed:
 * - 2 streams for 'low' tier
 * - 3 streams for 'medium' and 'high' tiers
 * 
 * **Property 18: Multi-View Cleanup**
 * **Validates: Requirements 8.5**
 * 
 * For any Multi-View exit event, ALL stream instances SHALL be properly destroyed
 * and resources released.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    getStreamLimit,
    wouldExceedLimit,
    staggeredInitialize,
    createMultiViewManager,
    validateStreamLimit,
    validateCleanup,
    DEFAULT_STAGGER_DELAY,
    StreamStatus,
    delay,
} from '../utils/multiViewManager';
import { getMaxConcurrentStreams } from '../utils/deviceDetector';

describe('MultiViewManager Property Tests', () => {
    /**
     * Property 10: Multi-View Stream Limits
     * Feature: media-player-optimization, Property 10: Multi-View Stream Limits
     * Validates: Requirements 4.5
     */
    describe('Property 10: Multi-View Stream Limits', () => {
        it('should enforce correct stream limits based on device tier', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const limit = getStreamLimit({ tier });
                        
                        if (tier === 'low') {
                            expect(limit).toBe(2);
                        } else {
                            expect(limit).toBe(3);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should correctly detect when stream limit would be exceeded', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.integer({ min: 0, max: 10 }),
                    (tier, currentCount) => {
                        const limit = getStreamLimit({ tier });
                        const wouldExceed = wouldExceedLimit(currentCount, { tier });
                        
                        // Should exceed if currentCount >= limit
                        expect(wouldExceed).toBe(currentCount >= limit);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should validate stream limits correctly', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }),
                    fc.constantFrom('low', 'medium', 'high'),
                    (streamCount, tier) => {
                        const isValid = validateStreamLimit(streamCount, tier);
                        const limit = getMaxConcurrentStreams(tier);
                        
                        expect(isValid).toBe(streamCount <= limit);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should never allow more streams than the device tier limit in manager', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 10 }),
                    (tier, cameraIds) => {
                        const maxStreams = getMaxConcurrentStreams(tier);
                        const manager = createMultiViewManager({ maxStreams });
                        
                        // Try to add all cameras
                        const uniqueIds = [...new Set(cameraIds)];
                        for (const id of uniqueIds) {
                            manager.addStream({ id, name: `Camera ${id}`, streams: { hls: `http://test/${id}` } });
                        }
                        
                        // Stream count should never exceed limit
                        expect(manager.getStreamCount()).toBeLessThanOrEqual(maxStreams);
                        
                        // Cleanup
                        manager.cleanup();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should report capacity correctly based on device tier', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.integer({ min: 0, max: 5 }),
                    (tier, numToAdd) => {
                        const maxStreams = getMaxConcurrentStreams(tier);
                        const manager = createMultiViewManager({ maxStreams });
                        
                        // Add streams up to numToAdd
                        for (let i = 0; i < numToAdd; i++) {
                            manager.addStream({ id: i, name: `Camera ${i}`, streams: { hls: `http://test/${i}` } });
                        }
                        
                        const actualCount = manager.getStreamCount();
                        const expectedAtCapacity = actualCount >= maxStreams;
                        
                        expect(manager.isAtCapacity()).toBe(expectedAtCapacity);
                        
                        // Cleanup
                        manager.cleanup();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should prevent adding duplicate cameras', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    fc.integer({ min: 2, max: 10 }),
                    (cameraId, attempts) => {
                        const manager = createMultiViewManager({ maxStreams: 3 });
                        
                        // First add should succeed
                        const firstAdd = manager.addStream({ 
                            id: cameraId, 
                            name: `Camera ${cameraId}`, 
                            streams: { hls: `http://test/${cameraId}` } 
                        });
                        expect(firstAdd).toBe(true);
                        
                        // Subsequent adds of same camera should fail
                        for (let i = 1; i < attempts; i++) {
                            const result = manager.addStream({ 
                                id: cameraId, 
                                name: `Camera ${cameraId}`, 
                                streams: { hls: `http://test/${cameraId}` } 
                            });
                            expect(result).toBe(false);
                        }
                        
                        // Should still only have 1 stream
                        expect(manager.getStreamCount()).toBe(1);
                        
                        // Cleanup
                        manager.cleanup();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should correctly report canAddStream based on current count and limit', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 0, maxLength: 5 }),
                    (tier, cameraIds) => {
                        const maxStreams = getMaxConcurrentStreams(tier);
                        const manager = createMultiViewManager({ maxStreams });
                        
                        // Add unique cameras
                        const uniqueIds = [...new Set(cameraIds)];
                        for (const id of uniqueIds) {
                            manager.addStream({ id, name: `Camera ${id}`, streams: { hls: `http://test/${id}` } });
                        }
                        
                        const currentCount = manager.getStreamCount();
                        const newCameraId = 9999; // ID that doesn't exist
                        
                        // canAddStream should return true only if under limit
                        expect(manager.canAddStream(newCameraId)).toBe(currentCount < maxStreams);
                        
                        // Cleanup
                        manager.cleanup();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 18: Multi-View Cleanup
     * Feature: media-player-optimization, Property 18: Multi-View Cleanup
     * Validates: Requirements 8.5
     */
    describe('Property 18: Multi-View Cleanup', () => {
        it('should have zero streams after cleanup', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.integer({ min: 1, max: 1000 }),
                            name: fc.string({ minLength: 1, maxLength: 50 }),
                        }),
                        { minLength: 0, maxLength: 5 }
                    ),
                    (cameras) => {
                        const manager = createMultiViewManager({ maxStreams: 3 });
                        
                        // Add cameras (with unique IDs)
                        const uniqueCameras = cameras.filter((c, i, arr) => 
                            arr.findIndex(x => x.id === c.id) === i
                        );
                        
                        for (const camera of uniqueCameras) {
                            manager.addStream({ 
                                ...camera, 
                                streams: { hls: `http://test/${camera.id}` } 
                            });
                        }
                        
                        // Cleanup
                        manager.cleanup();
                        
                        // Validate cleanup
                        expect(validateCleanup(manager)).toBe(true);
                        expect(manager.getStreamCount()).toBe(0);
                        expect(manager.hasStreams()).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should properly remove individual streams', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 3 }),
                    (cameraIds) => {
                        const manager = createMultiViewManager({ maxStreams: 3 });
                        const uniqueIds = [...new Set(cameraIds)];
                        
                        // Add all cameras
                        for (const id of uniqueIds) {
                            manager.addStream({ id, name: `Camera ${id}`, streams: { hls: `http://test/${id}` } });
                        }
                        
                        const initialCount = manager.getStreamCount();
                        
                        // Remove each camera one by one
                        for (let i = 0; i < uniqueIds.length; i++) {
                            const id = uniqueIds[i];
                            const removed = manager.removeStream(id);
                            expect(removed).toBe(true);
                            expect(manager.getStreamCount()).toBe(initialCount - i - 1);
                        }
                        
                        // Should be empty
                        expect(manager.getStreamCount()).toBe(0);
                        expect(manager.hasStreams()).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return false when removing non-existent stream', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    fc.integer({ min: 1001, max: 2000 }),
                    (existingId, nonExistingId) => {
                        const manager = createMultiViewManager({ maxStreams: 3 });
                        
                        // Add one camera
                        manager.addStream({ id: existingId, name: `Camera ${existingId}`, streams: { hls: `http://test/${existingId}` } });
                        
                        // Try to remove non-existing camera
                        const removed = manager.removeStream(nonExistingId);
                        expect(removed).toBe(false);
                        
                        // Original should still exist
                        expect(manager.getStreamCount()).toBe(1);
                        
                        // Cleanup
                        manager.cleanup();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should allow re-adding cameras after cleanup', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 3 }),
                    (cameraIds) => {
                        const manager = createMultiViewManager({ maxStreams: 3 });
                        const uniqueIds = [...new Set(cameraIds)];
                        
                        // Add cameras
                        for (const id of uniqueIds) {
                            manager.addStream({ id, name: `Camera ${id}`, streams: { hls: `http://test/${id}` } });
                        }
                        
                        // Cleanup
                        manager.cleanup();
                        expect(manager.getStreamCount()).toBe(0);
                        
                        // Re-add same cameras
                        for (const id of uniqueIds) {
                            const added = manager.addStream({ id, name: `Camera ${id}`, streams: { hls: `http://test/${id}` } });
                            expect(added).toBe(true);
                        }
                        
                        // Should have same count as before
                        expect(manager.getStreamCount()).toBe(Math.min(uniqueIds.length, 3));
                        
                        // Final cleanup
                        manager.cleanup();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct active streams list', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.integer({ min: 1, max: 1000 }),
                            name: fc.string({ minLength: 1, maxLength: 50 }),
                        }),
                        { minLength: 0, maxLength: 5 }
                    ),
                    (cameras) => {
                        const manager = createMultiViewManager({ maxStreams: 3 });
                        
                        // Add unique cameras
                        const uniqueCameras = cameras.filter((c, i, arr) => 
                            arr.findIndex(x => x.id === c.id) === i
                        ).slice(0, 3); // Limit to max streams
                        
                        for (const camera of uniqueCameras) {
                            manager.addStream({ 
                                ...camera, 
                                streams: { hls: `http://test/${camera.id}` } 
                            });
                        }
                        
                        const activeStreams = manager.getActiveStreams();
                        
                        // Should have correct count
                        expect(activeStreams.length).toBe(manager.getStreamCount());
                        
                        // All added cameras should be in active streams
                        for (const camera of uniqueCameras) {
                            expect(activeStreams.some(s => s.id === camera.id)).toBe(true);
                        }
                        
                        // Cleanup
                        manager.cleanup();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Additional property tests for staggered initialization
     */
    describe('Staggered Initialization Properties', () => {
        it('should initialize all cameras in order with delays', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 5 }),
                    async (cameraIds) => {
                        const uniqueIds = [...new Set(cameraIds)];
                        const cameras = uniqueIds.map(id => ({ id, name: `Camera ${id}` }));
                        const initOrder = [];
                        
                        const initFn = async (camera) => {
                            initOrder.push(camera.id);
                        };
                        
                        const results = await staggeredInitialize(cameras, initFn, { delayMs: 1 });
                        
                        // All cameras should be initialized
                        expect(results.length).toBe(cameras.length);
                        
                        // Order should match input order
                        expect(initOrder).toEqual(uniqueIds);
                        
                        // All should succeed
                        expect(results.every(r => r.success)).toBe(true);
                    }
                ),
                { numRuns: 20 } // Fewer runs for async tests
            );
        });

        it('should handle initialization errors without affecting other streams', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 5 }),
                    fc.integer({ min: 0, max: 4 }),
                    async (cameraIds, failIndex) => {
                        const uniqueIds = [...new Set(cameraIds)];
                        if (uniqueIds.length < 2) return; // Need at least 2 cameras
                        
                        const cameras = uniqueIds.map(id => ({ id, name: `Camera ${id}` }));
                        const actualFailIndex = failIndex % cameras.length;
                        const errors = [];
                        
                        const initFn = async (camera) => {
                            const idx = cameras.findIndex(c => c.id === camera.id);
                            if (idx === actualFailIndex) {
                                throw new Error(`Init failed for camera ${camera.id}`);
                            }
                        };
                        
                        const results = await staggeredInitialize(cameras, initFn, { 
                            delayMs: 1,
                            onError: (camera, error) => errors.push({ camera, error }),
                        });
                        
                        // All cameras should have results
                        expect(results.length).toBe(cameras.length);
                        
                        // Only one should fail
                        const failures = results.filter(r => !r.success);
                        expect(failures.length).toBe(1);
                        expect(failures[0].camera.id).toBe(cameras[actualFailIndex].id);
                        
                        // Others should succeed
                        const successes = results.filter(r => r.success);
                        expect(successes.length).toBe(cameras.length - 1);
                        
                        // Error callback should be called
                        expect(errors.length).toBe(1);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });
});
