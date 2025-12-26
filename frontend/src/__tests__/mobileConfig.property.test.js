/**
 * Property-Based Tests for Mobile Configuration
 * 
 * **Property 14: Mobile HLS Configuration**
 * **Validates: Requirements 7.1, 7.2**
 * 
 * For any mobile device detection, the HLS configuration SHALL use mobile-optimized
 * settings including smaller initial buffer and conservative ABR.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    getHLSConfig,
    getMobileHLSConfig,
    HLS_CONFIGS,
    MOBILE_PHONE_CONFIG,
    MOBILE_TABLET_CONFIG,
} from '../utils/hlsConfig';
import {
    detectDeviceTier,
    getDeviceCapabilities,
    isMobileDevice,
    getMobileDeviceType,
    hasTouchSupport,
    getScreenOrientation,
    isLowEndMobile,
} from '../utils/deviceDetector';

describe('Mobile Configuration Property Tests', () => {
    /**
     * Property 14: Mobile HLS Configuration
     * Feature: media-player-optimization, Property 14: Mobile HLS Configuration
     * Validates: Requirements 7.1, 7.2
     */
    describe('Property 14: Mobile HLS Configuration', () => {
        const validTiers = ['low', 'medium', 'high'];
        const mobileDeviceTypes = ['phone', 'tablet'];

        it('should return mobile-optimized config for phone devices', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    (tier) => {
                        const config = getHLSConfig(tier, {
                            isMobile: true,
                            mobileDeviceType: 'phone',
                        });
                        
                        // Phone config should have smaller buffer
                        expect(config.maxBufferLength).toBeLessThanOrEqual(20);
                        
                        // Phone config should have conservative ABR
                        expect(config.abrBandWidthFactor).toBeLessThanOrEqual(0.7);
                        expect(config.abrBandWidthUpFactor).toBeLessThanOrEqual(0.5);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return mobile-optimized config for tablet devices', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    (tier) => {
                        const config = getHLSConfig(tier, {
                            isMobile: true,
                            mobileDeviceType: 'tablet',
                        });
                        
                        // Tablet config should have moderate buffer
                        expect(config.maxBufferLength).toBeLessThanOrEqual(25);
                        
                        // Tablet config should have moderate ABR
                        expect(config.abrBandWidthFactor).toBeLessThanOrEqual(0.8);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have smaller or equal buffer for mobile vs same tier desktop', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    (tier) => {
                        const desktopConfig = getHLSConfig(tier, { isMobile: false });
                        const mobilePhoneConfig = getHLSConfig(tier, {
                            isMobile: true,
                            mobileDeviceType: 'phone',
                        });
                        
                        // Phone mobile should have same or smaller buffer than same tier desktop
                        expect(mobilePhoneConfig.maxBufferLength).toBeLessThanOrEqual(
                            desktopConfig.maxBufferLength
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have more conservative ABR for mobile vs desktop', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    fc.constantFrom(...mobileDeviceTypes),
                    (tier, deviceType) => {
                        const desktopConfig = getHLSConfig(tier, { isMobile: false });
                        const mobileConfig = getHLSConfig(tier, {
                            isMobile: true,
                            mobileDeviceType: deviceType,
                        });
                        
                        // Mobile should have same or more conservative ABR
                        expect(mobileConfig.abrBandWidthFactor).toBeLessThanOrEqual(
                            desktopConfig.abrBandWidthFactor
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('getMobileHLSConfig should return valid mobile configuration', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...mobileDeviceTypes),
                    fc.constantFrom(...validTiers),
                    (deviceType, tier) => {
                        const config = getMobileHLSConfig(deviceType, tier);
                        
                        // Should have all required HLS properties
                        expect(config).toHaveProperty('enableWorker');
                        expect(config).toHaveProperty('maxBufferLength');
                        expect(config).toHaveProperty('maxBufferSize');
                        expect(config).toHaveProperty('abrBandWidthFactor');
                        expect(config).toHaveProperty('abrBandWidthUpFactor');
                        
                        // Should be mobile-optimized
                        expect(config.maxBufferLength).toBeLessThanOrEqual(20);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('phone config should have smaller buffer than tablet config', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...validTiers),
                    (tier) => {
                        const phoneConfig = getHLSConfig(tier, {
                            isMobile: true,
                            mobileDeviceType: 'phone',
                        });
                        const tabletConfig = getHLSConfig(tier, {
                            isMobile: true,
                            mobileDeviceType: 'tablet',
                        });
                        
                        // Phone should have smaller or equal buffer than tablet
                        expect(phoneConfig.maxBufferLength).toBeLessThanOrEqual(
                            tabletConfig.maxBufferLength
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('phone config should start with lowest quality (startLevel=0)', () => {
            const phoneConfig = getHLSConfig('medium', {
                isMobile: true,
                mobileDeviceType: 'phone',
            });
            
            expect(phoneConfig.startLevel).toBe(0);
        });

        it('MOBILE_PHONE_CONFIG should have expected values', () => {
            expect(MOBILE_PHONE_CONFIG.maxBufferLength).toBe(15);
            expect(MOBILE_PHONE_CONFIG.startLevel).toBe(0);
            expect(MOBILE_PHONE_CONFIG.abrBandWidthFactor).toBe(0.6);
            expect(MOBILE_PHONE_CONFIG.abrBandWidthUpFactor).toBe(0.4);
        });

        it('MOBILE_TABLET_CONFIG should have expected values', () => {
            expect(MOBILE_TABLET_CONFIG.maxBufferLength).toBe(20);
            expect(MOBILE_TABLET_CONFIG.startLevel).toBe(-1); // Auto for tablets
            expect(MOBILE_TABLET_CONFIG.abrBandWidthFactor).toBe(0.7);
            expect(MOBILE_TABLET_CONFIG.abrBandWidthUpFactor).toBe(0.5);
        });
    });

    describe('Mobile Device Detection', () => {
        it('getMobileDeviceType should return valid device type', () => {
            const deviceType = getMobileDeviceType();
            expect(['phone', 'tablet', 'desktop']).toContain(deviceType);
        });

        it('hasTouchSupport should return boolean', () => {
            const hasTouch = hasTouchSupport();
            expect(typeof hasTouch).toBe('boolean');
        });

        it('getScreenOrientation should return valid orientation', () => {
            const orientation = getScreenOrientation();
            expect(['portrait', 'landscape']).toContain(orientation);
        });

        it('isLowEndMobile should correctly identify low-end mobile devices', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 3, noNaN: true }), // Low RAM
                    fc.integer({ min: 1, max: 2 }), // Low cores
                    (ram, cores) => {
                        const isLowEnd = isLowEndMobile({ ram, cores, isMobile: true });
                        expect(isLowEnd).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('isLowEndMobile should return false for non-mobile devices', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 32, noNaN: true }),
                    fc.integer({ min: 1, max: 64 }),
                    (ram, cores) => {
                        const isLowEnd = isLowEndMobile({ ram, cores, isMobile: false });
                        expect(isLowEnd).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('getDeviceCapabilities should include mobile-specific properties', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0.5, max: 32, noNaN: true }),
                    fc.integer({ min: 1, max: 64 }),
                    fc.boolean(),
                    (ram, cores, isMobile) => {
                        const caps = getDeviceCapabilities({ ram, cores, isMobile });
                        
                        // Should have mobile-specific properties
                        expect(caps).toHaveProperty('mobileDeviceType');
                        expect(caps).toHaveProperty('hasTouch');
                        expect(caps).toHaveProperty('screenOrientation');
                        expect(caps).toHaveProperty('screenDimensions');
                        expect(caps).toHaveProperty('isLowEndMobile');
                        
                        // Validate types
                        expect(['phone', 'tablet', 'desktop']).toContain(caps.mobileDeviceType);
                        expect(typeof caps.hasTouch).toBe('boolean');
                        expect(['portrait', 'landscape']).toContain(caps.screenOrientation);
                        expect(typeof caps.screenDimensions.width).toBe('number');
                        expect(typeof caps.screenDimensions.height).toBe('number');
                        expect(typeof caps.isLowEndMobile).toBe('boolean');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
