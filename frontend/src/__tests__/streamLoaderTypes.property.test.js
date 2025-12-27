/**
 * Property-Based Tests for StreamLoaderTypes
 * 
 * Tests for:
 * - Property 5: Loading Stage Progression
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    LoadingStage,
    LOADING_STAGE_MESSAGES,
    LOADING_STAGE_ORDER,
    VALID_LOADING_STAGES,
    VALID_ERROR_TYPES,
    ErrorType,
    createStreamError,
    getStageMessage,
    isValidStage,
    isValidStageTransition,
    getNextStage,
    isLoadingComplete,
    isErrorStage,
    getStageIndex,
} from '../utils/streamLoaderTypes';

describe('StreamLoaderTypes Property Tests', () => {
    /**
     * Property 5: Loading Stage Progression
     * Feature: stream-loading-fix, Property 5: Loading Stage Progression
     * Validates: Requirements 4.1, 4.2, 4.3, 4.4
     * 
     * For any successful stream load, the loading stages SHALL progress in order:
     * 'connecting' → 'loading' → 'buffering' → 'starting' → 'playing'
     */
    describe('Property 5: Loading Stage Progression', () => {
        it('should have exactly 5 stages in the correct progression order', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(null),
                    () => {
                        expect(LOADING_STAGE_ORDER).toHaveLength(5);
                        expect(LOADING_STAGE_ORDER[0]).toBe(LoadingStage.CONNECTING);
                        expect(LOADING_STAGE_ORDER[1]).toBe(LoadingStage.LOADING);
                        expect(LOADING_STAGE_ORDER[2]).toBe(LoadingStage.BUFFERING);
                        expect(LOADING_STAGE_ORDER[3]).toBe(LoadingStage.STARTING);
                        expect(LOADING_STAGE_ORDER[4]).toBe(LoadingStage.PLAYING);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should allow valid forward transitions in the progression order', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 3 }),
                    (fromIndex) => {
                        const fromStage = LOADING_STAGE_ORDER[fromIndex];
                        const toStage = LOADING_STAGE_ORDER[fromIndex + 1];
                        
                        expect(isValidStageTransition(fromStage, toStage)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not allow backward transitions in the progression order', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 4 }),
                    (fromIndex) => {
                        const fromStage = LOADING_STAGE_ORDER[fromIndex];
                        const toStage = LOADING_STAGE_ORDER[fromIndex - 1];
                        
                        expect(isValidStageTransition(fromStage, toStage)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should allow transition to error from any stage', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...LOADING_STAGE_ORDER),
                    (fromStage) => {
                        expect(isValidStageTransition(fromStage, LoadingStage.ERROR)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should allow transition to timeout from any stage', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...LOADING_STAGE_ORDER),
                    (fromStage) => {
                        expect(isValidStageTransition(fromStage, LoadingStage.TIMEOUT)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should only allow transition from error/timeout to connecting (retry)', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(LoadingStage.ERROR, LoadingStage.TIMEOUT),
                    fc.constantFrom(...LOADING_STAGE_ORDER),
                    (errorStage, targetStage) => {
                        const isValid = isValidStageTransition(errorStage, targetStage);
                        
                        if (targetStage === LoadingStage.CONNECTING) {
                            expect(isValid).toBe(true);
                        } else {
                            expect(isValid).toBe(false);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct next stage for each stage in progression', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 3 }),
                    (index) => {
                        const currentStage = LOADING_STAGE_ORDER[index];
                        const expectedNext = LOADING_STAGE_ORDER[index + 1];
                        
                        expect(getNextStage(currentStage)).toBe(expectedNext);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return null for next stage when at playing', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(LoadingStage.PLAYING),
                    (stage) => {
                        expect(getNextStage(stage)).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return null for next stage when at error states', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(LoadingStage.ERROR, LoadingStage.TIMEOUT),
                    (stage) => {
                        expect(getNextStage(stage)).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have correct stage index for all stages in order', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 4 }),
                    (index) => {
                        const stage = LOADING_STAGE_ORDER[index];
                        expect(getStageIndex(stage)).toBe(index);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return -1 for stage index of error states', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(LoadingStage.ERROR, LoadingStage.TIMEOUT),
                    (stage) => {
                        expect(getStageIndex(stage)).toBe(-1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Loading Stage Messages Tests
     * Validates: Requirements 4.1, 4.2, 4.3, 4.4
     */
    describe('Loading Stage Messages', () => {
        it('should have a message for every valid loading stage', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    (stage) => {
                        const message = LOADING_STAGE_MESSAGES[stage];
                        expect(message).toBeDefined();
                        expect(typeof message).toBe('string');
                        expect(message.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct message for connecting stage (Req 4.1)', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(LoadingStage.CONNECTING),
                    (stage) => {
                        expect(getStageMessage(stage)).toBe('Connecting to server...');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct message for loading stage (Req 4.2)', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(LoadingStage.LOADING),
                    (stage) => {
                        expect(getStageMessage(stage)).toBe('Loading stream data...');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct message for buffering stage (Req 4.3)', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(LoadingStage.BUFFERING),
                    (stage) => {
                        expect(getStageMessage(stage)).toBe('Buffering video...');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return correct message for starting stage (Req 4.4)', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(LoadingStage.STARTING),
                    (stage) => {
                        expect(getStageMessage(stage)).toBe('Starting playback...');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return fallback message for invalid stage', async () => {
            await fc.assert(
                fc.property(
                    fc.string().filter(s => !VALID_LOADING_STAGES.includes(s)),
                    (invalidStage) => {
                        expect(getStageMessage(invalidStage)).toBe('Loading...');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Stage Validation Tests
     */
    describe('Stage Validation', () => {
        it('should validate all defined loading stages as valid', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    (stage) => {
                        expect(isValidStage(stage)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should invalidate random strings as stages', async () => {
            await fc.assert(
                fc.property(
                    fc.string().filter(s => !VALID_LOADING_STAGES.includes(s)),
                    (invalidStage) => {
                        expect(isValidStage(invalidStage)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Loading Complete Tests
     */
    describe('Loading Complete Detection', () => {
        it('should detect playing as loading complete', async () => {
            await fc.assert(
                fc.property(
                    fc.constant(LoadingStage.PLAYING),
                    (stage) => {
                        expect(isLoadingComplete(stage)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect error states as loading complete', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(LoadingStage.ERROR, LoadingStage.TIMEOUT),
                    (stage) => {
                        expect(isLoadingComplete(stage)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect intermediate stages as loading complete', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(
                        LoadingStage.CONNECTING,
                        LoadingStage.LOADING,
                        LoadingStage.BUFFERING,
                        LoadingStage.STARTING
                    ),
                    (stage) => {
                        expect(isLoadingComplete(stage)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Error Stage Detection Tests
     */
    describe('Error Stage Detection', () => {
        it('should detect error and timeout as error stages', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(LoadingStage.ERROR, LoadingStage.TIMEOUT),
                    (stage) => {
                        expect(isErrorStage(stage)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect non-error stages as error stages', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(
                        LoadingStage.CONNECTING,
                        LoadingStage.LOADING,
                        LoadingStage.BUFFERING,
                        LoadingStage.STARTING,
                        LoadingStage.PLAYING
                    ),
                    (stage) => {
                        expect(isErrorStage(stage)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * StreamError Creation Tests
     * Validates: Requirements 8.1, 8.2, 8.3
     */
    describe('StreamError Creation', () => {
        it('should create error with all required fields', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...VALID_ERROR_TYPES),
                    fc.string({ minLength: 1 }),
                    fc.constantFrom(...VALID_LOADING_STAGES),
                    fc.constantFrom('low', 'medium', 'high'),
                    (type, message, stage, deviceTier) => {
                        const error = createStreamError({
                            type,
                            message,
                            stage,
                            deviceTier,
                        });
                        
                        // Requirement 8.1: Error type
                        expect(error.type).toBe(type);
                        // Requirement 8.3: Loading stage where error occurred
                        expect(error.stage).toBe(stage);
                        // Requirement 8.2: Device tier information
                        expect(error.deviceTier).toBe(deviceTier);
                        expect(error.message).toBe(message);
                        expect(typeof error.timestamp).toBe('number');
                        expect(error.retryCount).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should default invalid error type to unknown', async () => {
            await fc.assert(
                fc.property(
                    fc.string().filter(s => !VALID_ERROR_TYPES.includes(s)),
                    (invalidType) => {
                        const error = createStreamError({
                            type: invalidType,
                            message: 'Test error',
                            stage: LoadingStage.CONNECTING,
                            deviceTier: 'medium',
                        });
                        
                        expect(error.type).toBe(ErrorType.UNKNOWN);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should default invalid stage to error', async () => {
            await fc.assert(
                fc.property(
                    fc.string().filter(s => !VALID_LOADING_STAGES.includes(s)),
                    (invalidStage) => {
                        const error = createStreamError({
                            type: ErrorType.NETWORK,
                            message: 'Test error',
                            stage: invalidStage,
                            deviceTier: 'medium',
                        });
                        
                        expect(error.stage).toBe(LoadingStage.ERROR);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should include retry count when provided', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }),
                    (retryCount) => {
                        const error = createStreamError({
                            type: ErrorType.TIMEOUT,
                            message: 'Timeout error',
                            stage: LoadingStage.LOADING,
                            deviceTier: 'low',
                            retryCount,
                        });
                        
                        expect(error.retryCount).toBe(retryCount);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should include details when provided', async () => {
            await fc.assert(
                fc.property(
                    fc.record({
                        url: fc.string(),
                        statusCode: fc.integer({ min: 100, max: 599 }),
                    }),
                    (details) => {
                        const error = createStreamError({
                            type: ErrorType.SERVER,
                            message: 'Server error',
                            stage: LoadingStage.CONNECTING,
                            deviceTier: 'high',
                            details,
                        });
                        
                        expect(error.details).toEqual(details);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should have timestamp close to current time', async () => {
            await fc.assert(
                fc.property(
                    fc.constantFrom(...VALID_ERROR_TYPES),
                    (type) => {
                        const before = Date.now();
                        const error = createStreamError({
                            type,
                            message: 'Test',
                            stage: LoadingStage.CONNECTING,
                            deviceTier: 'medium',
                        });
                        const after = Date.now();
                        
                        expect(error.timestamp).toBeGreaterThanOrEqual(before);
                        expect(error.timestamp).toBeLessThanOrEqual(after);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
