import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
    applyOptimisticToggle,
    simulateOptimisticUpdate,
    createToggleHandler
} from '../utils/optimisticUpdate';

/**
 * Property-Based Tests for Optimistic Update
 * 
 * Feature: admin-ux-improvement
 * Property 11: Optimistic Update Rollback
 * Validates: Requirements 4.9
 * 
 * Tests that for any optimistic UI update (e.g., toggle camera status),
 * if the API call fails, the UI state SHALL be reverted to its previous value.
 */

describe('Optimistic Update', () => {
    /**
     * Feature: admin-ux-improvement
     * Property 11: Optimistic Update Rollback
     * Validates: Requirements 4.9
     * 
     * For any optimistic UI update, if the API call fails,
     * the UI state SHALL be reverted to its previous value.
     */
    describe('Property 11: Optimistic Update Rollback', () => {
        it('should rollback to previous state when API fails', () => {
            fc.assert(
                fc.property(
                    // Generate random initial state (boolean or 0/1)
                    fc.oneof(
                        fc.boolean(),
                        fc.constantFrom(0, 1)
                    ),
                    // Generate random optimistic value
                    fc.oneof(
                        fc.boolean(),
                        fc.constantFrom(0, 1)
                    ),
                    (initialState, optimisticValue) => {
                        // Simulate API failure
                        const result = simulateOptimisticUpdate(
                            initialState,
                            optimisticValue,
                            false, // API fails
                            'Network error'
                        );

                        // Property: Final state should equal initial state after rollback
                        expect(result.finalState).toBe(initialState);
                        expect(result.rolledBack).toBe(true);
                        expect(result.error).toBeDefined();
                        expect(result.apiSucceeded).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should maintain optimistic value when API succeeds', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.boolean(),
                        fc.constantFrom(0, 1)
                    ),
                    fc.oneof(
                        fc.boolean(),
                        fc.constantFrom(0, 1)
                    ),
                    (initialState, optimisticValue) => {
                        // Simulate API success
                        const result = simulateOptimisticUpdate(
                            initialState,
                            optimisticValue,
                            true // API succeeds
                        );

                        // Property: Final state should equal optimistic value
                        expect(result.finalState).toBe(optimisticValue);
                        expect(result.rolledBack).toBe(false);
                        expect(result.error).toBeNull();
                        expect(result.apiSucceeded).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should correctly apply toggle to list items', () => {
            // Generate array of cameras with unique IDs
            const uniqueCamerasArb = fc.array(
                fc.record({
                    name: fc.string({ minLength: 1, maxLength: 50 }),
                    enabled: fc.constantFrom(0, 1)
                }),
                { minLength: 1, maxLength: 20 }
            ).map(cameras => 
                // Assign unique sequential IDs
                cameras.map((camera, index) => ({ ...camera, id: index + 1 }))
            );

            fc.assert(
                fc.property(
                    uniqueCamerasArb,
                    fc.nat({ max: 19 }), // Index to select
                    (cameras, indexMod) => {
                        // Ensure we have at least one camera
                        if (cameras.length === 0) return true;

                        const index = indexMod % cameras.length;
                        const targetCamera = cameras[index];
                        const newValue = targetCamera.enabled === 1 ? 0 : 1;

                        // Apply optimistic toggle
                        const updatedCameras = applyOptimisticToggle(
                            cameras,
                            targetCamera.id,
                            'enabled',
                            newValue
                        );

                        // Property 1: Target item should have new value
                        const updatedTarget = updatedCameras.find(c => c.id === targetCamera.id);
                        expect(updatedTarget.enabled).toBe(newValue);

                        // Property 2: Other items should be unchanged
                        cameras.forEach(camera => {
                            if (camera.id !== targetCamera.id) {
                                const updatedCamera = updatedCameras.find(c => c.id === camera.id);
                                expect(updatedCamera.enabled).toBe(camera.enabled);
                            }
                        });

                        // Property 3: Array length should be preserved
                        expect(updatedCameras.length).toBe(cameras.length);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should rollback toggle correctly on API failure', async () => {
            // Test with mock state management
            const cameraArb = fc.record({
                id: fc.integer({ min: 1, max: 1000 }),
                name: fc.string({ minLength: 1, maxLength: 50 }),
                enabled: fc.constantFrom(0, 1)
            });

            await fc.assert(
                fc.asyncProperty(
                    fc.array(cameraArb, { minLength: 1, maxLength: 10 }),
                    fc.nat({ max: 9 }),
                    async (cameras, indexMod) => {
                        if (cameras.length === 0) return true;

                        const index = indexMod % cameras.length;
                        const targetCamera = cameras[index];
                        const originalEnabled = targetCamera.enabled;

                        // Mock state
                        let currentItems = [...cameras];
                        const getItems = () => currentItems;
                        const setItems = (items) => { currentItems = items; };

                        // Mock failing API
                        const failingApi = vi.fn().mockRejectedValue(new Error('Network error'));
                        const onError = vi.fn();

                        const toggleHandler = createToggleHandler({
                            getItems,
                            setItems,
                            apiCall: failingApi,
                            field: 'enabled',
                            onError
                        });

                        // Execute toggle
                        const result = await toggleHandler(targetCamera);

                        // Property: After failed API call, state should be rolled back
                        const finalTarget = currentItems.find(c => c.id === targetCamera.id);
                        expect(finalTarget.enabled).toBe(originalEnabled);
                        expect(result.rolledBack).toBe(true);
                        expect(result.success).toBe(false);
                        expect(onError).toHaveBeenCalled();

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should maintain state on successful API call', async () => {
            const cameraArb = fc.record({
                id: fc.integer({ min: 1, max: 1000 }),
                name: fc.string({ minLength: 1, maxLength: 50 }),
                enabled: fc.constantFrom(0, 1)
            });

            await fc.assert(
                fc.asyncProperty(
                    fc.array(cameraArb, { minLength: 1, maxLength: 10 }),
                    fc.nat({ max: 9 }),
                    async (cameras, indexMod) => {
                        if (cameras.length === 0) return true;

                        const index = indexMod % cameras.length;
                        const targetCamera = cameras[index];
                        const expectedNewValue = targetCamera.enabled === 1 ? 0 : 1;

                        // Mock state
                        let currentItems = [...cameras];
                        const getItems = () => currentItems;
                        const setItems = (items) => { currentItems = items; };

                        // Mock successful API
                        const successApi = vi.fn().mockResolvedValue({ success: true });
                        const onError = vi.fn();

                        const toggleHandler = createToggleHandler({
                            getItems,
                            setItems,
                            apiCall: successApi,
                            field: 'enabled',
                            onError
                        });

                        // Execute toggle
                        const result = await toggleHandler(targetCamera);

                        // Property: After successful API call, state should have new value
                        const finalTarget = currentItems.find(c => c.id === targetCamera.id);
                        expect(finalTarget.enabled).toBe(expectedNewValue);
                        expect(result.rolledBack).toBe(false);
                        expect(result.success).toBe(true);
                        expect(onError).not.toHaveBeenCalled();

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
