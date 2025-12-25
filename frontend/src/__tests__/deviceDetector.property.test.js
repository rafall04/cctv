/**
 * Property-Based Tests for DeviceDetector
 * 
 * **Property 1: Device Capability Detection Consistency**
 * **Validates: Requirements 1.1**
 * 
 * For any device environment, the DeviceDetector SHALL return a consistent
 * DeviceCapabilities object with valid tier classification ('low', 'medium', or 'high')
 * based on the detected hardware metrics.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    detectDeviceTier,
    getDeviceCapabilities,
    getMaxConcurrentStreams,
} from '../utils/deviceDetector';

describe('DeviceDetector Property Tests', () => {
    /**
     * Property 1: Device Capability Detection Consistency
     * Feature: media-player-optimization, Property 1: Device Capability Detection Consistency
     * Validates: Requirements 1.1
     */
    describe('Property 1: Device Capability Detection Consistency', () => {
        it('should always return a valid tier for any RAM and CPU combination', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 32, noNaN: true }), // RAM in GB
                    fc.integer({ min: 1, max: 64 }), // CPU cores
                    fc.boolean(), // isMobile
                    (ram, cores, isMobile) => {
                        const tier = detectDeviceTier({ ram, cores, isMobile });
                        
                        // Tier must be one of the valid values
                        expect(['low', 'medium', 'high']).toContain(tier);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should classify low-end devices correctly: RAM ≤ 2GB implies low tier', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 2, noNaN: true }), // Low RAM
                    fc.integer({ min: 1, max: 64 }), // Any CPU cores
                    fc.boolean(), // Any mobile status
                    (ram, cores, isMobile) => {
                        const tier = detectDeviceTier({ ram, cores, isMobile });
                        expect(tier).toBe('low');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should classify low-end devices correctly: cores ≤ 2 implies low tier', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 32, noNaN: true }), // Any RAM
                    fc.integer({ min: 1, max: 2 }), // Low cores
                    fc.boolean(), // Any mobile status
                    (ram, cores, isMobile) => {
                        const tier = detectDeviceTier({ ram, cores, isMobile });
                        expect(tier).toBe('low');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should classify mobile devices with RAM ≤ 3GB as low tier', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 3, noNaN: true }), // Low mobile RAM
                    fc.integer({ min: 3, max: 64 }), // Enough cores to not trigger core-based low
                    (ram, cores) => {
                        const tier = detectDeviceTier({ ram, cores, isMobile: true });
                        expect(tier).toBe('low');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should classify high-end devices correctly: RAM > 4GB AND cores > 4 implies high tier', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: Math.fround(4.5), max: Math.fround(32), noNaN: true }), // High RAM (> 4GB)
                    fc.integer({ min: 5, max: 64 }), // High cores (> 4)
                    fc.boolean(), // Any mobile status (but high specs override)
                    (ram, cores, isMobile) => {
                        // For high tier, we need RAM > 4 AND cores > 4
                        // Mobile with RAM > 4 and cores > 4 should still be high
                        // unless mobile RAM ≤ 3 (but we're testing RAM > 4)
                        const tier = detectDeviceTier({ ram, cores, isMobile });
                        
                        // If mobile with RAM ≤ 3, it would be low, but we're testing RAM > 4
                        // So it should be high
                        expect(tier).toBe('high');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should classify medium-tier devices correctly', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: Math.fround(2.5), max: Math.fround(4), noNaN: true }), // Medium RAM (> 2, ≤ 4)
                    fc.integer({ min: 3, max: 4 }), // Medium cores (> 2, ≤ 4)
                    (ram, cores) => {
                        // Non-mobile with medium specs should be medium
                        const tier = detectDeviceTier({ ram, cores, isMobile: false });
                        expect(tier).toBe('medium');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return consistent capabilities object structure', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 32, noNaN: true }),
                    fc.integer({ min: 1, max: 64 }),
                    fc.boolean(),
                    (ram, cores, isMobile) => {
                        const caps = getDeviceCapabilities({ ram, cores, isMobile });
                        
                        // Check structure
                        expect(caps).toHaveProperty('tier');
                        expect(caps).toHaveProperty('ram');
                        expect(caps).toHaveProperty('cpuCores');
                        expect(caps).toHaveProperty('isMobile');
                        expect(caps).toHaveProperty('hasWebWorker');
                        expect(caps).toHaveProperty('connectionType');
                        expect(caps).toHaveProperty('maxConcurrentStreams');
                        
                        // Check types
                        expect(['low', 'medium', 'high']).toContain(caps.tier);
                        expect(typeof caps.ram).toBe('number');
                        expect(typeof caps.cpuCores).toBe('number');
                        expect(typeof caps.isMobile).toBe('boolean');
                        expect(typeof caps.hasWebWorker).toBe('boolean');
                        expect(typeof caps.connectionType).toBe('string');
                        expect(typeof caps.maxConcurrentStreams).toBe('number');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct max concurrent streams for each tier', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const maxStreams = getMaxConcurrentStreams(tier);
                        
                        if (tier === 'low') {
                            expect(maxStreams).toBe(2);
                        } else {
                            expect(maxStreams).toBe(3);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should be deterministic: same inputs always produce same tier', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 32, noNaN: true }),
                    fc.integer({ min: 1, max: 64 }),
                    fc.boolean(),
                    (ram, cores, isMobile) => {
                        const tier1 = detectDeviceTier({ ram, cores, isMobile });
                        const tier2 = detectDeviceTier({ ram, cores, isMobile });
                        const tier3 = detectDeviceTier({ ram, cores, isMobile });
                        
                        expect(tier1).toBe(tier2);
                        expect(tier2).toBe(tier3);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have maxConcurrentStreams consistent with tier in capabilities', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 32, noNaN: true }),
                    fc.integer({ min: 1, max: 64 }),
                    fc.boolean(),
                    (ram, cores, isMobile) => {
                        const caps = getDeviceCapabilities({ ram, cores, isMobile });
                        const expectedStreams = getMaxConcurrentStreams(caps.tier);
                        
                        expect(caps.maxConcurrentStreams).toBe(expectedStreams);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
