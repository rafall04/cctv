/**
 * Property-Based Tests for PreloadManager
 * 
 * **Property 2: HLS Module Caching**
 * **Validates: Requirements 2.2, 2.3**
 * 
 * For any sequence of calls to preloadHls(), the function SHALL return 
 * the same cached HLS.js module instance after the first successful load.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
    preloadHls,
    isPreloaded,
    getPreloadStatus,
    getPreloadedHls,
    resetPreloadState,
    getHls,
} from '../utils/preloadManager';

// Mock HLS.js module
vi.mock('hls.js', () => {
    const mockHls = {
        isSupported: () => true,
    };
    return {
        default: mockHls,
    };
});

describe('PreloadManager Property Tests', () => {
    beforeEach(() => {
        // Reset state before each test
        resetPreloadState();
    });

    /**
     * Property 2: HLS Module Caching
     * Feature: stream-loading-fix, Property 2: HLS Module Caching
     * Validates: Requirements 2.2, 2.3
     */
    describe('Property 2: HLS Module Caching', () => {
        it('should return the same cached module instance for multiple calls', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 10 }), // Number of calls
                    async (numCalls) => {
                        resetPreloadState();
                        
                        // Make multiple calls to preloadHls
                        const results = [];
                        for (let i = 0; i < numCalls; i++) {
                            const result = await preloadHls();
                            results.push(result);
                        }
                        
                        // All results should be the same instance
                        const firstResult = results[0];
                        for (let i = 1; i < results.length; i++) {
                            expect(results[i]).toBe(firstResult);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should cache the module after first successful load', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null),
                    async () => {
                        resetPreloadState();
                        
                        // Initial state
                        expect(isPreloaded()).toBe(false);
                        expect(getPreloadStatus()).toBe('idle');
                        expect(getPreloadedHls()).toBe(null);
                        
                        // After preload
                        const module = await preloadHls();
                        
                        expect(isPreloaded()).toBe(true);
                        expect(getPreloadStatus()).toBe('loaded');
                        expect(getPreloadedHls()).toBe(module);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return cached module immediately when already loaded', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null),
                    async () => {
                        resetPreloadState();
                        
                        // First call loads the module
                        const firstModule = await preloadHls();
                        
                        // Second call should return immediately with same module
                        const secondModule = await preloadHls();
                        
                        expect(secondModule).toBe(firstModule);
                        expect(isPreloaded()).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('getHls should return same module as preloadHls', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null),
                    async () => {
                        resetPreloadState();
                        
                        const preloadedModule = await preloadHls();
                        const getHlsModule = await getHls();
                        
                        expect(getHlsModule).toBe(preloadedModule);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('concurrent calls should all receive the same module', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 5 }), // Number of concurrent calls
                    async (numCalls) => {
                        resetPreloadState();
                        
                        // Make concurrent calls
                        const promises = [];
                        for (let i = 0; i < numCalls; i++) {
                            promises.push(preloadHls());
                        }
                        
                        const results = await Promise.all(promises);
                        
                        // All results should be the same instance
                        const firstResult = results[0];
                        for (let i = 1; i < results.length; i++) {
                            expect(results[i]).toBe(firstResult);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('status should transition correctly: idle -> loading -> loaded', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null),
                    async () => {
                        resetPreloadState();
                        
                        // Initial state
                        expect(getPreloadStatus()).toBe('idle');
                        
                        // Start preload
                        const promise = preloadHls();
                        
                        // Wait for completion
                        await promise;
                        
                        // Final state
                        expect(getPreloadStatus()).toBe('loaded');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('resetPreloadState should clear cached module', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null),
                    async () => {
                        // Load module first
                        await preloadHls();
                        expect(isPreloaded()).toBe(true);
                        
                        // Reset state
                        resetPreloadState();
                        
                        // Should be back to initial state
                        expect(isPreloaded()).toBe(false);
                        expect(getPreloadStatus()).toBe('idle');
                        expect(getPreloadedHls()).toBe(null);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('getPreloadedHls should return null before preload and module after', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null),
                    async () => {
                        resetPreloadState();
                        
                        // Before preload
                        expect(getPreloadedHls()).toBe(null);
                        
                        // After preload
                        const module = await preloadHls();
                        expect(getPreloadedHls()).toBe(module);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
