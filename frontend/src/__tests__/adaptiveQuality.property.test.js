/**
 * Property-Based Tests for AdaptiveQuality Module
 * 
 * **Property 12: Bandwidth-based Quality Adaptation**
 * **Validates: Requirements 6.2, 6.3**
 * 
 * For any bandwidth measurement:
 * - When bandwidth < 500kbps, quality level SHALL be reduced
 * - When bandwidth > 2Mbps (stable), higher quality levels SHALL be allowed
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    determineQualityAction,
    calculateRecommendedLevel,
    formatBandwidth,
    getMaxQualityForNetwork,
    isOscillating,
    BANDWIDTH_THRESHOLDS,
    QUALITY_SETTINGS,
    NETWORK_TYPES,
    QualityAction,
} from '../utils/adaptiveQuality';

describe('AdaptiveQuality Property Tests', () => {
    /**
     * Property 12: Bandwidth-based Quality Adaptation
     * Feature: media-player-optimization, Property 12: Bandwidth-based Quality Adaptation
     * Validates: Requirements 6.2, 6.3
     */
    describe('Property 12: Bandwidth-based Quality Adaptation', () => {
        
        it('should return DECREASE or FORCE_LOWEST action when bandwidth < 500kbps', () => {
            fc.assert(
                fc.property(
                    // Generate bandwidth values below 500kbps (but positive)
                    fc.integer({ min: 1, max: BANDWIDTH_THRESHOLDS.LOW - 1 }),
                    fc.integer({ min: 0, max: 10 }), // stableSamples
                    (bandwidth, stableSamples) => {
                        const result = determineQualityAction(bandwidth, stableSamples);
                        
                        // Should either decrease or force lowest
                        expect([QualityAction.DECREASE, QualityAction.FORCE_LOWEST]).toContain(result.action);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return FORCE_LOWEST action when bandwidth < 200kbps', () => {
            fc.assert(
                fc.property(
                    // Generate bandwidth values below 200kbps (but positive)
                    fc.integer({ min: 1, max: BANDWIDTH_THRESHOLDS.VERY_LOW - 1 }),
                    fc.integer({ min: 0, max: 10 }),
                    (bandwidth, stableSamples) => {
                        const result = determineQualityAction(bandwidth, stableSamples);
                        
                        expect(result.action).toBe(QualityAction.FORCE_LOWEST);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return INCREASE action when bandwidth > 2Mbps with sufficient stable samples', () => {
            fc.assert(
                fc.property(
                    // Generate bandwidth values above 2Mbps
                    fc.integer({ min: BANDWIDTH_THRESHOLDS.HIGH + 1, max: 50000000 }),
                    // Generate stable samples >= MIN_STABLE_SAMPLES
                    fc.integer({ min: QUALITY_SETTINGS.MIN_STABLE_SAMPLES, max: 20 }),
                    (bandwidth, stableSamples) => {
                        const result = determineQualityAction(bandwidth, stableSamples);
                        
                        expect(result.action).toBe(QualityAction.INCREASE);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return MAINTAIN action when bandwidth > 2Mbps but not enough stable samples', () => {
            fc.assert(
                fc.property(
                    // Generate bandwidth values above 2Mbps
                    fc.integer({ min: BANDWIDTH_THRESHOLDS.HIGH + 1, max: 50000000 }),
                    // Generate stable samples < MIN_STABLE_SAMPLES
                    fc.integer({ min: 0, max: QUALITY_SETTINGS.MIN_STABLE_SAMPLES - 1 }),
                    (bandwidth, stableSamples) => {
                        const result = determineQualityAction(bandwidth, stableSamples);
                        
                        expect(result.action).toBe(QualityAction.MAINTAIN);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return MAINTAIN action when bandwidth is in normal range (500kbps - 2Mbps)', () => {
            fc.assert(
                fc.property(
                    // Generate bandwidth values in normal range
                    fc.integer({ min: BANDWIDTH_THRESHOLDS.LOW, max: BANDWIDTH_THRESHOLDS.HIGH }),
                    fc.integer({ min: 0, max: 10 }),
                    (bandwidth, stableSamples) => {
                        const result = determineQualityAction(bandwidth, stableSamples);
                        
                        expect(result.action).toBe(QualityAction.MAINTAIN);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle invalid bandwidth values gracefully', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.constant(NaN),
                        fc.constant(-1),
                        fc.constant(-100),
                        fc.constant(undefined),
                        fc.constant(null)
                    ),
                    (invalidBandwidth) => {
                        const result = determineQualityAction(invalidBandwidth, 0);
                        
                        // Should maintain current quality for invalid input
                        expect(result.action).toBe(QualityAction.MAINTAIN);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('calculateRecommendedLevel should decrease level when bandwidth is low', () => {
            fc.assert(
                fc.property(
                    // Low bandwidth
                    fc.integer({ min: BANDWIDTH_THRESHOLDS.VERY_LOW, max: BANDWIDTH_THRESHOLDS.LOW - 1 }),
                    // Current level > 0 so we can decrease
                    fc.integer({ min: 1, max: 5 }),
                    // Max level
                    fc.integer({ min: 5, max: 10 }),
                    (bandwidth, currentLevel, maxLevel) => {
                        const result = calculateRecommendedLevel(bandwidth, currentLevel, maxLevel, {
                            stableSamples: 0,
                            history: [],
                        });
                        
                        // Level should decrease or stay at 0
                        expect(result.level).toBeLessThan(currentLevel);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('calculateRecommendedLevel should force level 0 when bandwidth is very low', () => {
            fc.assert(
                fc.property(
                    // Very low bandwidth
                    fc.integer({ min: 1, max: BANDWIDTH_THRESHOLDS.VERY_LOW - 1 }),
                    // Any current level
                    fc.integer({ min: 0, max: 5 }),
                    // Max level
                    fc.integer({ min: 5, max: 10 }),
                    (bandwidth, currentLevel, maxLevel) => {
                        const result = calculateRecommendedLevel(bandwidth, currentLevel, maxLevel, {
                            stableSamples: 0,
                            history: [],
                        });
                        
                        expect(result.level).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('calculateRecommendedLevel should increase level when bandwidth is high and stable', () => {
            fc.assert(
                fc.property(
                    // High bandwidth
                    fc.integer({ min: BANDWIDTH_THRESHOLDS.HIGH + 1, max: 50000000 }),
                    // Current level < max so we can increase
                    fc.integer({ min: 0, max: 4 }),
                    // Max level
                    fc.constant(5),
                    // Stable samples
                    fc.integer({ min: QUALITY_SETTINGS.MIN_STABLE_SAMPLES, max: 10 }),
                    (bandwidth, currentLevel, maxLevel, stableSamples) => {
                        const result = calculateRecommendedLevel(bandwidth, currentLevel, maxLevel, {
                            stableSamples,
                            history: [],
                        });
                        
                        // Level should increase (unless already at max)
                        if (currentLevel < maxLevel) {
                            expect(result.level).toBeGreaterThan(currentLevel);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('calculateRecommendedLevel should never exceed maxLevel', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 100000000 }), // Any bandwidth
                    fc.integer({ min: 0, max: 10 }), // Current level
                    fc.integer({ min: 1, max: 10 }), // Max level
                    fc.integer({ min: 0, max: 20 }), // Stable samples
                    (bandwidth, currentLevel, maxLevel, stableSamples) => {
                        const result = calculateRecommendedLevel(bandwidth, currentLevel, maxLevel, {
                            stableSamples,
                            history: [],
                        });
                        
                        expect(result.level).toBeLessThanOrEqual(maxLevel);
                        expect(result.level).toBeGreaterThanOrEqual(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('calculateRecommendedLevel should prevent oscillation', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: BANDWIDTH_THRESHOLDS.HIGH + 1, max: 50000000 }),
                    fc.integer({ min: 1, max: 5 }),
                    fc.constant(5),
                    (bandwidth, currentLevel, maxLevel) => {
                        // Create oscillating history
                        const now = Date.now();
                        const oscillatingHistory = [
                            { timestamp: now - 1000, level: 3 },
                            { timestamp: now - 2000, level: 2 },
                            { timestamp: now - 3000, level: 3 },
                        ];
                        
                        const result = calculateRecommendedLevel(bandwidth, currentLevel, maxLevel, {
                            stableSamples: QUALITY_SETTINGS.MIN_STABLE_SAMPLES,
                            history: oscillatingHistory,
                        });
                        
                        // Should maintain to prevent oscillation
                        expect(result.action).toBe(QualityAction.MAINTAIN);
                        expect(result.level).toBe(currentLevel);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Bandwidth Formatting', () => {
        it('should format bandwidth correctly for any positive value', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 1000000000 }),
                    (bps) => {
                        const formatted = formatBandwidth(bps);
                        
                        expect(typeof formatted).toBe('string');
                        expect(formatted.length).toBeGreaterThan(0);
                        
                        // Should contain appropriate unit
                        if (bps >= 1000000) {
                            expect(formatted).toContain('Mbps');
                        } else if (bps >= 1000) {
                            expect(formatted).toContain('kbps');
                        } else {
                            expect(formatted).toContain('bps');
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Network Type Quality Limits', () => {
        it('should return valid max quality for all network types', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...Object.keys(NETWORK_TYPES)),
                    (networkType) => {
                        const maxQuality = getMaxQualityForNetwork(networkType);
                        
                        expect(typeof maxQuality).toBe('number');
                        expect(maxQuality).toBeGreaterThanOrEqual(-1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return -1 (unlimited) for high-speed networks', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('4g', 'wifi'),
                    (networkType) => {
                        const maxQuality = getMaxQualityForNetwork(networkType);
                        
                        expect(maxQuality).toBe(-1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return 0 (lowest) for slow networks', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('slow-2g', '2g'),
                    (networkType) => {
                        const maxQuality = getMaxQualityForNetwork(networkType);
                        
                        expect(maxQuality).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle unknown network types gracefully', () => {
            fc.assert(
                fc.property(
                    fc.string().filter(s => !Object.keys(NETWORK_TYPES).includes(s)),
                    (unknownType) => {
                        const maxQuality = getMaxQualityForNetwork(unknownType);
                        
                        // Should default to unknown config
                        expect(maxQuality).toBe(NETWORK_TYPES.unknown.maxQuality);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Oscillation Detection', () => {
        it('should detect oscillation when too many changes in window', () => {
            const now = Date.now();
            
            fc.assert(
                fc.property(
                    // Generate history with many recent changes at distinct timestamps
                    fc.array(
                        fc.integer({ min: 0, max: QUALITY_SETTINGS.MAX_OSCILLATIONS + 5 }),
                        { minLength: QUALITY_SETTINGS.MAX_OSCILLATIONS, maxLength: 10 }
                    ).map(offsets => 
                        offsets.map((offset, index) => ({
                            // Ensure distinct timestamps within the window
                            timestamp: now - (index * 100) - offset,
                            level: index % 2, // Alternate levels to simulate oscillation
                        }))
                    ).filter(history => {
                        // Ensure all entries are within the oscillation window
                        return history.every(entry => 
                            now - entry.timestamp < QUALITY_SETTINGS.OSCILLATION_WINDOW
                        );
                    }),
                    (history) => {
                        const result = isOscillating(history);
                        
                        // Should detect oscillation
                        expect(result).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect oscillation with few changes', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            timestamp: fc.integer({ min: 0, max: Date.now() }),
                            level: fc.integer({ min: 0, max: 5 }),
                        }),
                        { minLength: 0, maxLength: QUALITY_SETTINGS.MAX_OSCILLATIONS - 1 }
                    ),
                    (history) => {
                        const result = isOscillating(history);
                        
                        // Should not detect oscillation with few entries
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect oscillation with old changes', () => {
            const now = Date.now();
            
            fc.assert(
                fc.property(
                    // Generate history with old changes (outside window)
                    fc.array(
                        fc.record({
                            timestamp: fc.integer({ 
                                min: 0, 
                                max: now - QUALITY_SETTINGS.OSCILLATION_WINDOW - 1 
                            }),
                            level: fc.integer({ min: 0, max: 5 }),
                        }),
                        { minLength: QUALITY_SETTINGS.MAX_OSCILLATIONS, maxLength: 10 }
                    ),
                    (history) => {
                        const result = isOscillating(history);
                        
                        // Should not detect oscillation with old entries
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle empty or invalid history', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.constant([]),
                        fc.constant(null),
                        fc.constant(undefined)
                    ),
                    (invalidHistory) => {
                        const result = isOscillating(invalidHistory);
                        
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Threshold Constants', () => {
        it('should have LOW threshold at 500kbps', () => {
            expect(BANDWIDTH_THRESHOLDS.LOW).toBe(500000);
        });

        it('should have HIGH threshold at 2Mbps', () => {
            expect(BANDWIDTH_THRESHOLDS.HIGH).toBe(2000000);
        });

        it('should have VERY_LOW threshold at 200kbps', () => {
            expect(BANDWIDTH_THRESHOLDS.VERY_LOW).toBe(200000);
        });

        it('should have thresholds in ascending order', () => {
            expect(BANDWIDTH_THRESHOLDS.VERY_LOW).toBeLessThan(BANDWIDTH_THRESHOLDS.LOW);
            expect(BANDWIDTH_THRESHOLDS.LOW).toBeLessThan(BANDWIDTH_THRESHOLDS.HIGH);
        });
    });
});
