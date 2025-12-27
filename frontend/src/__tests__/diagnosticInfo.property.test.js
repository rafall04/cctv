/**
 * Property-Based Tests for DiagnosticInfo Component
 * 
 * Tests for:
 * - Property 10: Error Diagnostic Information
 * 
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    formatErrorType,
    formatDeviceTier,
    getEstimatedRetryTime,
    formatRetryTime,
    createDiagnosticInfo,
    formatDiagnosticText,
} from '../components/DiagnosticInfo';
import { FALLBACK_CONFIG } from '../utils/fallbackHandler';
import { VALID_LOADING_STAGES, VALID_ERROR_TYPES } from '../utils/streamLoaderTypes';

// Valid error types for testing
const validErrorTypes = ['timeout', 'network', 'server', 'media', 'unknown'];

// Valid device tiers for testing
const validDeviceTiers = ['low', 'medium', 'high'];

describe('DiagnosticInfo Property Tests', () => {
    /**
     * Property 10: Error Diagnostic Information
     * Feature: stream-loading-fix, Property 10: Error Diagnostic Information
     * Validates: Requirements 8.1, 8.2, 8.3
     * 
     * For any stream error, the error object SHALL include:
     * - Error type (timeout, network, server, media)
     * - Loading stage where error occurred
     * - Device tier information
     */
    describe('Property 10: Error Diagnostic Information', () => {
        /**
         * Requirement 8.1: Error type must be included
         */
        it('should include error type in diagnostic info', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    fc.constantFrom(...validDeviceTiers),
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    (errorType, deviceTier, stage) => {
                        const diagnosticInfo = createDiagnosticInfo({
                            errorType,
                            deviceTier,
                            stage,
                        });
                        
                        // Requirement 8.1: Error type must be present
                        expect(diagnosticInfo.errorType).toBe(errorType);
                        expect(typeof diagnosticInfo.errorType).toBe('string');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Requirement 8.2: Device tier must be included
         */
        it('should include device tier in diagnostic info', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    fc.constantFrom(...validDeviceTiers),
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    (errorType, deviceTier, stage) => {
                        const diagnosticInfo = createDiagnosticInfo({
                            errorType,
                            deviceTier,
                            stage,
                        });
                        
                        // Requirement 8.2: Device tier must be present
                        expect(diagnosticInfo.deviceTier).toBe(deviceTier);
                        expect(typeof diagnosticInfo.deviceTier).toBe('string');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Requirement 8.3: Loading stage must be included
         */
        it('should include loading stage in diagnostic info', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    fc.constantFrom(...validDeviceTiers),
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    (errorType, deviceTier, stage) => {
                        const diagnosticInfo = createDiagnosticInfo({
                            errorType,
                            deviceTier,
                            stage,
                        });
                        
                        // Requirement 8.3: Loading stage must be present
                        expect(diagnosticInfo.stage).toBe(stage);
                        expect(typeof diagnosticInfo.stage).toBe('string');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * All three required fields must be present together
         */
        it('should include all required diagnostic fields together', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    fc.constantFrom(...validDeviceTiers),
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    fc.integer({ min: 0, max: 10 }),
                    fc.integer({ min: 0, max: 10 }),
                    (errorType, deviceTier, stage, retryCount, consecutiveFailures) => {
                        const diagnosticInfo = createDiagnosticInfo({
                            errorType,
                            deviceTier,
                            stage,
                            retryCount,
                            consecutiveFailures,
                        });
                        
                        // All required fields must be present
                        expect(diagnosticInfo).toHaveProperty('errorType');
                        expect(diagnosticInfo).toHaveProperty('deviceTier');
                        expect(diagnosticInfo).toHaveProperty('stage');
                        expect(diagnosticInfo).toHaveProperty('timestamp');
                        expect(diagnosticInfo).toHaveProperty('retryCount');
                        expect(diagnosticInfo).toHaveProperty('consecutiveFailures');
                        
                        // Values must match input
                        expect(diagnosticInfo.errorType).toBe(errorType);
                        expect(diagnosticInfo.deviceTier).toBe(deviceTier);
                        expect(diagnosticInfo.stage).toBe(stage);
                        expect(diagnosticInfo.retryCount).toBe(retryCount);
                        expect(diagnosticInfo.consecutiveFailures).toBe(consecutiveFailures);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Error Type Formatting Tests
     */
    describe('Error Type Formatting', () => {
        it('should format all valid error types correctly', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    (errorType) => {
                        const formatted = formatErrorType(errorType);
                        
                        expect(typeof formatted).toBe('string');
                        expect(formatted.length).toBeGreaterThan(0);
                        
                        // Verify specific mappings
                        const expectedMappings = {
                            timeout: 'Timeout',
                            network: 'Network Error',
                            server: 'Server Error',
                            media: 'Media Error',
                            unknown: 'Unknown Error',
                        };
                        
                        expect(formatted).toBe(expectedMappings[errorType]);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return Unknown Error for invalid error types', async () => {
            await fc.assert(
                fc.property(
                    fc.string().filter(s => !validErrorTypes.includes(s)),
                    (invalidType) => {
                        const formatted = formatErrorType(invalidType);
                        expect(formatted).toBe('Unknown Error');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Device Tier Formatting Tests
     */
    describe('Device Tier Formatting', () => {
        it('should format all valid device tiers correctly', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validDeviceTiers),
                    (deviceTier) => {
                        const formatted = formatDeviceTier(deviceTier);
                        
                        expect(typeof formatted).toBe('string');
                        expect(formatted.length).toBeGreaterThan(0);
                        
                        // Verify specific mappings
                        const expectedMappings = {
                            low: 'Low-End',
                            medium: 'Medium',
                            high: 'High-End',
                        };
                        
                        expect(formatted).toBe(expectedMappings[deviceTier]);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return Unknown for invalid device tiers', async () => {
            await fc.assert(
                fc.property(
                    fc.string().filter(s => !validDeviceTiers.includes(s)),
                    (invalidTier) => {
                        const formatted = formatDeviceTier(invalidTier);
                        expect(formatted).toBe('Unknown');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Retry Time Estimation Tests
     * Validates: Requirements 8.5
     */
    describe('Retry Time Estimation', () => {
        it('should return correct retry delay for network errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constant('network'),
                    (errorType) => {
                        const retryTime = getEstimatedRetryTime(errorType, true);
                        expect(retryTime).toBe(FALLBACK_CONFIG.NETWORK_RETRY_DELAY);
                        expect(retryTime).toBe(3000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct retry delay for server errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constant('server'),
                    (errorType) => {
                        const retryTime = getEstimatedRetryTime(errorType, true);
                        expect(retryTime).toBe(FALLBACK_CONFIG.SERVER_RETRY_DELAY);
                        expect(retryTime).toBe(5000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct retry delay for timeout errors', async () => {
            await fc.assert(
                fc.property(
                    fc.constant('timeout'),
                    (errorType) => {
                        const retryTime = getEstimatedRetryTime(errorType, true);
                        expect(retryTime).toBe(FALLBACK_CONFIG.TIMEOUT_RETRY_DELAY);
                        expect(retryTime).toBe(3000);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return -1 when auto-retry is not available', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    (errorType) => {
                        const retryTime = getEstimatedRetryTime(errorType, false);
                        expect(retryTime).toBe(-1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return positive value when auto-retry is available', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    (errorType) => {
                        const retryTime = getEstimatedRetryTime(errorType, true);
                        expect(retryTime).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Retry Time Formatting Tests
     */
    describe('Retry Time Formatting', () => {
        it('should format positive retry times as seconds', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 60000 }),
                    (retryTimeMs) => {
                        const formatted = formatRetryTime(retryTimeMs);
                        
                        expect(typeof formatted).toBe('string');
                        expect(formatted).toMatch(/^~\d+s$/);
                        
                        // Verify the seconds value
                        const expectedSeconds = Math.ceil(retryTimeMs / 1000);
                        expect(formatted).toBe(`~${expectedSeconds}s`);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return manual retry message for negative values', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: -10000, max: -1 }),
                    (retryTimeMs) => {
                        const formatted = formatRetryTime(retryTimeMs);
                        expect(formatted).toBe('Manual retry required');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Diagnostic Text Formatting Tests
     * Validates: Requirements 8.4
     */
    describe('Diagnostic Text Formatting', () => {
        it('should include all required fields in formatted text', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    fc.constantFrom(...validDeviceTiers),
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    (errorType, deviceTier, stage) => {
                        const diagnosticInfo = createDiagnosticInfo({
                            errorType,
                            deviceTier,
                            stage,
                        });
                        
                        const text = formatDiagnosticText(diagnosticInfo);
                        
                        // Text should include all required information
                        expect(text).toContain('Error Type:');
                        expect(text).toContain('Device Tier:');
                        expect(text).toContain('Loading Stage:');
                        expect(text).toContain('Timestamp:');
                        
                        // Text should include the actual values
                        expect(text).toContain(formatErrorType(errorType));
                        expect(text).toContain(formatDeviceTier(deviceTier));
                        expect(text).toContain(stage);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should produce valid multi-line text format', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    fc.constantFrom(...validDeviceTiers),
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    (errorType, deviceTier, stage) => {
                        const diagnosticInfo = createDiagnosticInfo({
                            errorType,
                            deviceTier,
                            stage,
                        });
                        
                        const text = formatDiagnosticText(diagnosticInfo);
                        
                        // Should be multi-line
                        const lines = text.split('\n');
                        expect(lines.length).toBeGreaterThan(5);
                        
                        // Should have header and footer
                        expect(lines[0]).toContain('===');
                        expect(lines[lines.length - 1]).toContain('===');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Default Values Tests
     */
    describe('Default Values', () => {
        it('should use default values for missing optional fields', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        const diagnosticInfo = createDiagnosticInfo({});
                        
                        // Should have default values
                        expect(diagnosticInfo.errorType).toBe('unknown');
                        expect(diagnosticInfo.deviceTier).toBe('medium');
                        expect(diagnosticInfo.stage).toBe('error');
                        expect(diagnosticInfo.retryCount).toBe(0);
                        expect(diagnosticInfo.consecutiveFailures).toBe(0);
                        expect(diagnosticInfo.errorMessage).toBe('');
                        expect(diagnosticInfo.canAutoRetry).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should include timestamp in ISO format', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    (errorType) => {
                        const diagnosticInfo = createDiagnosticInfo({ errorType });
                        
                        expect(diagnosticInfo.timestamp).toBeDefined();
                        expect(typeof diagnosticInfo.timestamp).toBe('string');
                        
                        // Should be valid ISO date string
                        const date = new Date(diagnosticInfo.timestamp);
                        expect(date.toString()).not.toBe('Invalid Date');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Estimated Retry Time in Diagnostic Info
     */
    describe('Estimated Retry Time in Diagnostic Info', () => {
        it('should include estimated retry time based on error type', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...validErrorTypes),
                    fc.boolean(),
                    (errorType, canAutoRetry) => {
                        const diagnosticInfo = createDiagnosticInfo({
                            errorType,
                            canAutoRetry,
                        });
                        
                        expect(diagnosticInfo).toHaveProperty('estimatedRetryTime');
                        
                        if (canAutoRetry) {
                            expect(diagnosticInfo.estimatedRetryTime).toBeGreaterThan(0);
                        } else {
                            expect(diagnosticInfo.estimatedRetryTime).toBe(-1);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
