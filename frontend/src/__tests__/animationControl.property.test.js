/**
 * Property-Based Tests for AnimationControl
 * 
 * **Property 11: Low-End Animation Disable**
 * **Validates: Requirements 5.2**
 * 
 * For any low-end device, loading animations SHALL be disabled
 * (no animate-pulse, animate-spin classes during loading).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    shouldDisableAnimations,
    getAnimationClass,
    getAnimationClasses,
    getLoadingIndicatorClass,
    getAdaptiveAnimationClass,
    createAnimationConfig,
    ANIMATION_MAPPINGS,
} from '../utils/animationControl';

describe('AnimationControl Property Tests', () => {
    /**
     * Property 11: Low-End Animation Disable
     * Feature: stream-loading-fix, Property 11: Low-End Animation Disable
     * Validates: Requirements 5.2
     */
    describe('Property 11: Low-End Animation Disable', () => {
        it('should disable animations for low-end devices', () => {
            fc.assert(
                fc.property(
                    fc.constant('low'),
                    (tier) => {
                        const result = shouldDisableAnimations({ tier });
                        expect(result).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should enable animations for medium and high-end devices', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('medium', 'high'),
                    (tier) => {
                        const result = shouldDisableAnimations({ tier });
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return empty string for animation class on low-end devices', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('animate-spin', 'animate-pulse', 'animate-bounce'),
                    (animationClass) => {
                        const result = getAnimationClass(animationClass, { tier: 'low' });
                        expect(result).toBe('');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return the animation class for medium/high-end devices', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('animate-spin', 'animate-pulse', 'animate-bounce'),
                    fc.constantFrom('medium', 'high'),
                    (animationClass, tier) => {
                        const result = getAnimationClass(animationClass, { tier });
                        expect(result).toBe(animationClass);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return empty string for multiple animation classes on low-end devices', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.constantFrom('animate-spin', 'animate-pulse', 'animate-bounce'), { minLength: 1, maxLength: 3 }),
                    (animationClasses) => {
                        const result = getAnimationClasses(animationClasses, { tier: 'low' });
                        expect(result).toBe('');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return space-separated animation classes for medium/high-end devices', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.constantFrom('animate-spin', 'animate-pulse', 'animate-bounce'), { minLength: 1, maxLength: 3 }),
                    fc.constantFrom('medium', 'high'),
                    (animationClasses, tier) => {
                        const result = getAnimationClasses(animationClasses, { tier });
                        expect(result).toBe(animationClasses.join(' '));
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return static class for loading indicator on low-end devices', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('animate-spin', 'animate-pulse'),
                    fc.string({ minLength: 1, maxLength: 20 }),
                    (animatedClass, staticClass) => {
                        const result = getLoadingIndicatorClass(animatedClass, staticClass, { tier: 'low' });
                        expect(result).toBe(staticClass);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return animated class for loading indicator on medium/high-end devices', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('animate-spin', 'animate-pulse'),
                    fc.string({ minLength: 1, maxLength: 20 }),
                    fc.constantFrom('medium', 'high'),
                    (animatedClass, staticClass, tier) => {
                        const result = getLoadingIndicatorClass(animatedClass, staticClass, { tier });
                        expect(result).toBe(animatedClass);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct adaptive animation class based on tier', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('spin', 'pulse', 'bounce', 'ping', 'shimmer'),
                    fc.constantFrom('low', 'medium', 'high'),
                    (animationType, tier) => {
                        const result = getAdaptiveAnimationClass(animationType, { tier });
                        const mapping = ANIMATION_MAPPINGS[animationType];
                        
                        if (tier === 'low') {
                            expect(result).toBe(mapping.static);
                        } else {
                            expect(result).toBe(mapping.animated);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should create consistent animation config based on tier', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    (tier) => {
                        const config = createAnimationConfig({ tier });
                        
                        // Check structure
                        expect(config).toHaveProperty('disableAnimations');
                        expect(config).toHaveProperty('spin');
                        expect(config).toHaveProperty('pulse');
                        expect(config).toHaveProperty('bounce');
                        expect(config).toHaveProperty('ping');
                        expect(config).toHaveProperty('shimmer');
                        
                        // Check consistency
                        if (tier === 'low') {
                            expect(config.disableAnimations).toBe(true);
                            expect(config.spin).toBe('');
                            expect(config.pulse).toBe('opacity-75');
                            expect(config.bounce).toBe('');
                            expect(config.ping).toBe('');
                            expect(config.shimmer).toBe('');
                        } else {
                            expect(config.disableAnimations).toBe(false);
                            expect(config.spin).toBe('animate-spin');
                            expect(config.pulse).toBe('animate-pulse');
                            expect(config.bounce).toBe('animate-bounce');
                            expect(config.ping).toBe('animate-ping');
                            expect(config.shimmer).toBe('animate-[shimmer_2s_infinite]');
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should be deterministic: same tier always produces same result', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.constantFrom('animate-spin', 'animate-pulse', 'animate-bounce'),
                    (tier, animationClass) => {
                        const result1 = getAnimationClass(animationClass, { tier });
                        const result2 = getAnimationClass(animationClass, { tier });
                        const result3 = getAnimationClass(animationClass, { tier });
                        
                        expect(result1).toBe(result2);
                        expect(result2).toBe(result3);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should respect forceDisable option regardless of tier', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('low', 'medium', 'high'),
                    fc.constantFrom('animate-spin', 'animate-pulse', 'animate-bounce'),
                    (tier, animationClass) => {
                        const result = getAnimationClass(animationClass, { tier, forceDisable: true });
                        expect(result).toBe('');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
