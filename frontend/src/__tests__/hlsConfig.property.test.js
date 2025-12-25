/**
 * Property-Based Tests for HLS Configuration
 * 
 * **Property 2: Device-based HLS Configuration**
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
 * 
 * For any device tier classification, the HLS configuration returned by getHLSConfig SHALL have:
 * - enableWorker = false for 'low' tier
 * - enableWorker = true for 'medium' and 'high' tiers
 * - maxBufferLength ≤ 15 for 'low' tier
 * - maxBufferLength ≤ 30 for 'high' tier
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    getHLSConfig,
    getConfigValue,
    shouldEnableWorker,
    getMaxBufferLength,
    getAvailableTiers,
    isValidTier,
    HLS_CONFIGS,
} from '../utils/hlsConfig';

describe('HLS Configuration Property Tests', () => {
    /**
     * Property 2: Device-based HLS Configuration
     * Feature: media-player-optimization, Property 2: Device-based HLS Configuration
     * Validates: Requirements 1.2, 1.3, 1.4, 1.5
     */
    describe('Property 2: Device-based HLS Configuration', () => {
        const validTiers = ['low', 'medium', 'high'];

        it('should return enableWorker=false for low tier', () => {
            fc.assert(
                fc.property(
                    fc.constant('low'),
                    fc.boolean(), // isMobile
                    (tier, isMobile) => {
                        const config = getHLSConfig(tier, { isMobile });
                        expect(config.enableWorker).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return enableWorker=true for medium tier', () => {
            fc.assert(
                fc.property(
                    fc.constant('medium'),
                    fc.boolean(),
                    (tier, isMobile) => {
                        const config = getHLSConfig(tier, { isMobile });
                        expect(config.enableWorker).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return enableWorker=true for high tier', () => {
            fc.assert(
                fc.property(
                    fc.constant('high'),
                    fc.boolean(),
                    (tier, isMobile) => {
                        const config = getHLSConfig(tier, { isMobile });
                        expect(config.enableWorker).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return maxBufferLength ≤ 15 for low tier', () => {
            fc.assert(
                fc.property(
                    fc.constant('low'),
                    fc.boolean(),
                    (tier, isMobile) => {
                        const config = getHLSConfig(tier, { isMobile });
                        expect(config.maxBufferLength).toBeLessThanOrEqual(15);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return maxBufferLength ≤ 30 for high tier', () => {
            fc.assert(
                fc.property(
                    fc.constant('high'),
                    fc.boolean(),
                    (tier, isMobile) => {
                        const config = getHLSConfig(tier, { isMobile });
                        expect(config.maxBufferLength).toBeLessThanOrEqual(30);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should always return a valid configuration object with required properties', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    fc.boolean(),
                    (tier, isMobile) => {
                        const config = getHLSConfig(tier, { isMobile });
                        
                        // Check all required properties exist
                        expect(config).toHaveProperty('enableWorker');
                        expect(config).toHaveProperty('lowLatencyMode');
                        expect(config).toHaveProperty('backBufferLength');
                        expect(config).toHaveProperty('maxBufferLength');
                        expect(config).toHaveProperty('maxMaxBufferLength');
                        expect(config).toHaveProperty('maxBufferSize');
                        expect(config).toHaveProperty('maxBufferHole');
                        expect(config).toHaveProperty('startLevel');
                        expect(config).toHaveProperty('abrEwmaDefaultEstimate');
                        expect(config).toHaveProperty('abrBandWidthFactor');
                        expect(config).toHaveProperty('abrBandWidthUpFactor');
                        expect(config).toHaveProperty('fragLoadingTimeOut');
                        expect(config).toHaveProperty('fragLoadingMaxRetry');
                        expect(config).toHaveProperty('fragLoadingRetryDelay');
                        
                        // Check types
                        expect(typeof config.enableWorker).toBe('boolean');
                        expect(typeof config.maxBufferLength).toBe('number');
                        expect(typeof config.maxBufferSize).toBe('number');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have increasing buffer sizes from low to high tier', () => {
            fc.assert(
                fc.property(
                    fc.constant(null), // Just need to run once per iteration
                    () => {
                        const lowConfig = getHLSConfig('low');
                        const mediumConfig = getHLSConfig('medium');
                        const highConfig = getHLSConfig('high');
                        
                        // Buffer length should increase with tier
                        expect(lowConfig.maxBufferLength).toBeLessThanOrEqual(mediumConfig.maxBufferLength);
                        expect(mediumConfig.maxBufferLength).toBeLessThanOrEqual(highConfig.maxBufferLength);
                        
                        // Buffer size should increase with tier
                        expect(lowConfig.maxBufferSize).toBeLessThanOrEqual(mediumConfig.maxBufferSize);
                        expect(mediumConfig.maxBufferSize).toBeLessThanOrEqual(highConfig.maxBufferSize);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should apply mobile overrides correctly', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    (tier) => {
                        const desktopConfig = getHLSConfig(tier, { isMobile: false });
                        const mobileConfig = getHLSConfig(tier, { isMobile: true });
                        
                        // Mobile should have same or smaller buffer
                        expect(mobileConfig.maxBufferLength).toBeLessThanOrEqual(desktopConfig.maxBufferLength);
                        
                        // Mobile should have same or more conservative ABR
                        expect(mobileConfig.abrBandWidthFactor).toBeLessThanOrEqual(desktopConfig.abrBandWidthFactor);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should respect custom overrides', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    fc.integer({ min: 5, max: 60 }), // custom maxBufferLength
                    (tier, customBuffer) => {
                        const config = getHLSConfig(tier, {
                            overrides: { maxBufferLength: customBuffer }
                        });
                        
                        expect(config.maxBufferLength).toBe(customBuffer);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('shouldEnableWorker should match config enableWorker', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    (tier) => {
                        const config = getHLSConfig(tier);
                        const shouldEnable = shouldEnableWorker(tier);
                        
                        expect(shouldEnable).toBe(config.enableWorker);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('getMaxBufferLength should match config maxBufferLength', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    (tier) => {
                        const config = getHLSConfig(tier);
                        const maxBuffer = getMaxBufferLength(tier);
                        
                        expect(maxBuffer).toBe(config.maxBufferLength);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle invalid tier by defaulting to medium', () => {
            fc.assert(
                fc.property(
                    fc.string().filter(s => !validTiers.includes(s)),
                    (invalidTier) => {
                        const config = getHLSConfig(invalidTier);
                        const mediumConfig = getHLSConfig('medium');
                        
                        // Should default to medium config
                        expect(config.enableWorker).toBe(mediumConfig.enableWorker);
                        expect(config.maxBufferLength).toBe(mediumConfig.maxBufferLength);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('isValidTier should correctly identify valid tiers', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    (tier) => {
                        expect(isValidTier(tier)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('isValidTier should reject invalid tiers', () => {
            fc.assert(
                fc.property(
                    fc.string().filter(s => !validTiers.includes(s)),
                    (invalidTier) => {
                        expect(isValidTier(invalidTier)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('getAvailableTiers should return all valid tiers', () => {
            const tiers = getAvailableTiers();
            expect(tiers).toContain('low');
            expect(tiers).toContain('medium');
            expect(tiers).toContain('high');
            expect(tiers.length).toBe(3);
        });

        it('low tier should have startLevel=0 (lowest quality)', () => {
            const config = getHLSConfig('low');
            expect(config.startLevel).toBe(0);
        });

        it('medium and high tiers should have startLevel=-1 (auto)', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('medium', 'high'),
                    (tier) => {
                        const config = getHLSConfig(tier);
                        expect(config.startLevel).toBe(-1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
