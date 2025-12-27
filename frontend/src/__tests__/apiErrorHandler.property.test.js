/**
 * Property-Based Tests for API Error Handler
 * 
 * **Property 8: API Error Message Mapping**
 * **Validates: Requirements 2.6, 2.7, 10.4, 10.5, 10.6**
 * 
 * For any API error response with a status code, the error handler SHALL map it to
 * a user-friendly message: 401 → session expired, 403 → access denied, 404 → not found,
 * 500 → server error, network error → connection error.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    ERROR_MESSAGES,
    getErrorMessageByStatus,
    isNetworkError,
    isTimeoutError,
    isAuthError,
    isForbiddenError,
    isNotFoundError,
    isValidationError,
    isServerError,
    isRateLimitError,
    parseApiError,
    getErrorMessage,
} from '../hooks/useApiError';

describe('API Error Handler Property Tests', () => {
    /**
     * Property 8: API Error Message Mapping
     * Feature: admin-ux-improvement, Property 8: API Error Message Mapping
     * Validates: Requirements 2.6, 2.7, 10.4, 10.5, 10.6
     */
    describe('Property 8: API Error Message Mapping', () => {
        it('should map 401 status to session expired message', () => {
            fc.assert(
                fc.property(
                    fc.constant(401),
                    (status) => {
                        const message = getErrorMessageByStatus(status);
                        expect(message).toBe(ERROR_MESSAGES[401]);
                        expect(message).toContain('session');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should map 403 status to access denied message', () => {
            fc.assert(
                fc.property(
                    fc.constant(403),
                    (status) => {
                        const message = getErrorMessageByStatus(status);
                        expect(message).toBe(ERROR_MESSAGES[403]);
                        expect(message).toContain('permission');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should map 404 status to not found message', () => {
            fc.assert(
                fc.property(
                    fc.constant(404),
                    (status) => {
                        const message = getErrorMessageByStatus(status);
                        expect(message).toBe(ERROR_MESSAGES[404]);
                        expect(message).toContain('not found');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should map 500 status to server error message', () => {
            fc.assert(
                fc.property(
                    fc.constant(500),
                    (status) => {
                        const message = getErrorMessageByStatus(status);
                        expect(message).toBe(ERROR_MESSAGES[500]);
                        expect(message.toLowerCase()).toContain('server error');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should map null/undefined status to network error message', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(null, undefined),
                    (status) => {
                        const message = getErrorMessageByStatus(status);
                        expect(message).toBe(ERROR_MESSAGES.NETWORK_ERROR);
                        expect(message.toLowerCase()).toContain('connect');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return default message for unknown status codes', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 600, max: 999 }), // Unknown status codes
                    (status) => {
                        const message = getErrorMessageByStatus(status);
                        expect(message).toBe(ERROR_MESSAGES.DEFAULT);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should map all 5xx status codes to appropriate server error messages', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(500, 502, 503, 504),
                    (status) => {
                        const message = getErrorMessageByStatus(status);
                        expect(message).toBeDefined();
                        expect(typeof message).toBe('string');
                        expect(message.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should always return a non-empty string for any status', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.integer({ min: 100, max: 599 }),
                        fc.constant(null),
                        fc.constant(undefined)
                    ),
                    (status) => {
                        const message = getErrorMessageByStatus(status);
                        expect(typeof message).toBe('string');
                        expect(message.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Network Error Detection', () => {
        it('should detect network errors with ERR_NETWORK code', () => {
            fc.assert(
                fc.property(
                    fc.constant({ code: 'ERR_NETWORK' }),
                    (error) => {
                        expect(isNetworkError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect network errors with ECONNABORTED code', () => {
            fc.assert(
                fc.property(
                    fc.constant({ code: 'ECONNABORTED' }),
                    (error) => {
                        expect(isNetworkError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect network errors when request exists but no response', () => {
            fc.assert(
                fc.property(
                    fc.constant({ request: {}, response: undefined }),
                    (error) => {
                        expect(isNetworkError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect network errors from error messages', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        { message: 'Network Error' },
                        { message: 'Failed to fetch' },
                        { message: 'net::ERR_CONNECTION_REFUSED' },
                        { message: 'ECONNREFUSED' },
                        { message: 'ENOTFOUND' }
                    ),
                    (error) => {
                        expect(isNetworkError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect network error when response exists', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 200, max: 599 }),
                    (status) => {
                        const error = { response: { status } };
                        expect(isNetworkError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return false for null/undefined errors', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(null, undefined),
                    (error) => {
                        expect(isNetworkError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Auth Error Detection', () => {
        it('should detect 401 as auth error', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 401 } }),
                    (error) => {
                        expect(isAuthError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect other status codes as auth error', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 200, max: 599 }).filter(s => s !== 401),
                    (status) => {
                        const error = { response: { status } };
                        expect(isAuthError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return false for null/undefined errors', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(null, undefined),
                    (error) => {
                        expect(isAuthError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Forbidden Error Detection', () => {
        it('should detect 403 as forbidden error', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 403 } }),
                    (error) => {
                        expect(isForbiddenError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect other status codes as forbidden error', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 200, max: 599 }).filter(s => s !== 403),
                    (status) => {
                        const error = { response: { status } };
                        expect(isForbiddenError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Not Found Error Detection', () => {
        it('should detect 404 as not found error', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 404 } }),
                    (error) => {
                        expect(isNotFoundError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect other status codes as not found error', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 200, max: 599 }).filter(s => s !== 404),
                    (status) => {
                        const error = { response: { status } };
                        expect(isNotFoundError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Validation Error Detection', () => {
        it('should detect 400 and 422 as validation errors', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(400, 422),
                    (status) => {
                        const error = { response: { status } };
                        expect(isValidationError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect other status codes as validation error', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 200, max: 599 }).filter(s => s !== 400 && s !== 422),
                    (status) => {
                        const error = { response: { status } };
                        expect(isValidationError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Server Error Detection', () => {
        it('should detect 5xx status codes as server errors', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 500, max: 599 }),
                    (status) => {
                        const error = { response: { status } };
                        expect(isServerError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect non-5xx status codes as server errors', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 200, max: 499 }),
                    (status) => {
                        const error = { response: { status } };
                        expect(isServerError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Rate Limit Error Detection', () => {
        it('should detect 429 as rate limit error', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 429 } }),
                    (error) => {
                        expect(isRateLimitError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not detect other status codes as rate limit error', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 200, max: 599 }).filter(s => s !== 429),
                    (status) => {
                        const error = { response: { status } };
                        expect(isRateLimitError(error)).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Timeout Error Detection', () => {
        it('should detect timeout errors from ECONNABORTED with timeout message', () => {
            fc.assert(
                fc.property(
                    fc.constant({ code: 'ECONNABORTED', message: 'timeout of 5000ms exceeded' }),
                    (error) => {
                        expect(isTimeoutError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect 504 as timeout error', () => {
            fc.assert(
                fc.property(
                    fc.constant({ response: { status: 504 } }),
                    (error) => {
                        expect(isTimeoutError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect timeout from error message', () => {
            fc.assert(
                fc.property(
                    fc.constant({ message: 'Request timeout' }),
                    (error) => {
                        expect(isTimeoutError(error)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('parseApiError', () => {
        it('should return structured error for any HTTP status', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 200, max: 599 }),
                    (status) => {
                        const error = { response: { status } };
                        const parsed = parseApiError(error);
                        
                        expect(parsed).toHaveProperty('status', status);
                        expect(parsed).toHaveProperty('message');
                        expect(parsed).toHaveProperty('code');
                        expect(parsed).toHaveProperty('isNetworkError');
                        expect(parsed).toHaveProperty('isAuthError');
                        expect(parsed).toHaveProperty('isValidationError');
                        expect(parsed).toHaveProperty('isServerError');
                        expect(typeof parsed.message).toBe('string');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should correctly identify error types in parsed result', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        { status: 401, expectedType: 'isAuthError' },
                        { status: 403, expectedType: 'isForbiddenError' },
                        { status: 404, expectedType: 'isNotFoundError' },
                        { status: 500, expectedType: 'isServerError' },
                        { status: 429, expectedType: 'isRateLimitError' }
                    ),
                    ({ status, expectedType }) => {
                        const error = { response: { status } };
                        const parsed = parseApiError(error);
                        
                        expect(parsed[expectedType]).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should use server-provided message when available', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (serverMessage) => {
                        const error = {
                            response: {
                                status: 400,
                                data: { message: serverMessage }
                            }
                        };
                        const parsed = parseApiError(error);
                        
                        expect(parsed.message).toBe(serverMessage);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle null/undefined errors gracefully', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(null, undefined),
                    (error) => {
                        const parsed = parseApiError(error);
                        
                        expect(parsed.status).toBeNull();
                        expect(parsed.message).toBe(ERROR_MESSAGES.DEFAULT);
                        expect(parsed.isNetworkError).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should detect network errors and set appropriate message', () => {
            fc.assert(
                fc.property(
                    fc.constant({ code: 'ERR_NETWORK', request: {} }),
                    (error) => {
                        const parsed = parseApiError(error);
                        
                        expect(parsed.isNetworkError).toBe(true);
                        expect(parsed.message).toBe(ERROR_MESSAGES.NETWORK_ERROR);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should extract error details from response', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        field: fc.string(),
                        message: fc.string()
                    }),
                    (details) => {
                        const error = {
                            response: {
                                status: 400,
                                data: { details }
                            }
                        };
                        const parsed = parseApiError(error);
                        
                        expect(parsed.details).toEqual(details);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('getErrorMessage', () => {
        it('should return user-friendly message for any error', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.constant({ response: { status: 401 } }),
                        fc.constant({ response: { status: 403 } }),
                        fc.constant({ response: { status: 404 } }),
                        fc.constant({ response: { status: 500 } }),
                        fc.constant({ code: 'ERR_NETWORK' }),
                        fc.constant(null)
                    ),
                    (error) => {
                        const message = getErrorMessage(error);
                        
                        expect(typeof message).toBe('string');
                        expect(message.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
