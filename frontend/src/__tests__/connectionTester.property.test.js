/**
 * Property-Based Tests for ConnectionTester
 * 
 * **Property 3: Connection Test Timeout**
 * **Property 4: Server Unreachable Error**
 * **Validates: Requirements 3.2, 3.4**
 * 
 * For any connection test, the test SHALL timeout after exactly 5000ms if no response is received.
 * For any connection test that fails (timeout or error), the result SHALL have reachable=false and include an error message.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    testConnection,
    isServerReachable,
    testMediaMTXConnection,
    DEFAULT_TIMEOUT,
} from '../utils/connectionTester';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock performance.now for latency testing
const mockPerformanceNow = vi.fn();
const originalPerformanceNow = performance.now;

describe('ConnectionTester Property Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPerformanceNow.mockReturnValue(0);
        performance.now = mockPerformanceNow;
    });

    afterEach(() => {
        performance.now = originalPerformanceNow;
    });

    /**
     * Property 3: Connection Test Timeout
     * Feature: stream-loading-fix, Property 3: Connection Test Timeout
     * Validates: Requirements 3.4
     */
    describe('Property 3: Connection Test Timeout', () => {
        it('should use default timeout of 5000ms', () => {
            expect(DEFAULT_TIMEOUT).toBe(5000);
        });

        it('should return timeout error when AbortError is thrown', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(), // Generate random URLs
                    async (url) => {
                        // Mock fetch to throw AbortError (simulating timeout)
                        const abortError = new DOMException('Aborted', 'AbortError');
                        mockFetch.mockRejectedValue(abortError);
                        mockPerformanceNow.mockReturnValue(0);

                        const result = await testConnection(url, DEFAULT_TIMEOUT);
                        
                        // Should return unreachable with timeout error
                        expect(result.reachable).toBe(false);
                        expect(result.error).toBe('Connection timeout');
                        expect(result.latency).toBe(-1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should pass AbortSignal to fetch for timeout handling', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    async (url) => {
                        mockFetch.mockResolvedValue({ ok: true });
                        mockPerformanceNow.mockReturnValue(0);

                        await testConnection(url, DEFAULT_TIMEOUT);
                        
                        // Verify AbortSignal was passed
                        expect(mockFetch).toHaveBeenCalledWith(
                            url,
                            expect.objectContaining({
                                signal: expect.any(AbortSignal),
                            })
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle various timeout values correctly', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1000, max: 10000 }), // Custom timeout values
                    async (customTimeout) => {
                        // Mock fetch to throw AbortError
                        const abortError = new DOMException('Aborted', 'AbortError');
                        mockFetch.mockRejectedValue(abortError);
                        mockPerformanceNow.mockReturnValue(0);

                        const result = await testConnection('http://test.example.com', customTimeout);
                        
                        expect(result.reachable).toBe(false);
                        expect(result.error).toBe('Connection timeout');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Server Unreachable Error
     * Feature: stream-loading-fix, Property 4: Server Unreachable Error
     * Validates: Requirements 3.2
     */
    describe('Property 4: Server Unreachable Error', () => {
        it('should return reachable=false and error message when connection fails', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    fc.constantFrom(
                        new TypeError('Failed to fetch'),
                        new Error('Network error'),
                        new Error('DNS lookup failed'),
                        new Error('Connection refused')
                    ),
                    async (url, error) => {
                        mockFetch.mockRejectedValue(error);
                        mockPerformanceNow.mockReturnValue(0);

                        const result = await testConnection(url);
                        
                        // Should return unreachable with error message
                        expect(result.reachable).toBe(false);
                        expect(result.latency).toBe(-1);
                        expect(typeof result.error).toBe('string');
                        expect(result.error.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return reachable=true when server responds successfully', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    fc.integer({ min: 10, max: 1000 }), // Simulated latency
                    async (url, latency) => {
                        let startTime = 0;
                        mockPerformanceNow
                            .mockReturnValueOnce(startTime)
                            .mockReturnValueOnce(startTime + latency);
                        
                        mockFetch.mockResolvedValue({ ok: true });

                        const result = await testConnection(url);
                        
                        expect(result.reachable).toBe(true);
                        expect(result.latency).toBe(latency);
                        expect(result.error).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle TypeError with "Failed to fetch" as server unreachable', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    async (url) => {
                        const fetchError = new TypeError('Failed to fetch');
                        mockFetch.mockRejectedValue(fetchError);
                        mockPerformanceNow.mockReturnValue(0);

                        const result = await testConnection(url);
                        
                        expect(result.reachable).toBe(false);
                        expect(result.error).toBe('Server unreachable');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle AbortError as connection timeout', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    async (url) => {
                        const abortError = new DOMException('Aborted', 'AbortError');
                        mockFetch.mockRejectedValue(abortError);
                        mockPerformanceNow.mockReturnValue(0);

                        const result = await testConnection(url);
                        
                        expect(result.reachable).toBe(false);
                        expect(result.error).toBe('Connection timeout');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should use HEAD method for lightweight check', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    async (url) => {
                        mockFetch.mockResolvedValue({ ok: true });
                        mockPerformanceNow.mockReturnValue(0);

                        await testConnection(url);
                        
                        expect(mockFetch).toHaveBeenCalledWith(
                            url,
                            expect.objectContaining({
                                method: 'HEAD',
                            })
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should use no-cors mode for cross-origin requests', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    async (url) => {
                        mockFetch.mockResolvedValue({ ok: true });
                        mockPerformanceNow.mockReturnValue(0);

                        await testConnection(url);
                        
                        expect(mockFetch).toHaveBeenCalledWith(
                            url,
                            expect.objectContaining({
                                mode: 'no-cors',
                            })
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * isServerReachable helper tests
     */
    describe('isServerReachable helper', () => {
        it('should return true when server is reachable', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    async (url) => {
                        mockFetch.mockResolvedValue({ ok: true });
                        mockPerformanceNow.mockReturnValue(0);

                        const result = await isServerReachable(url);
                        
                        expect(result).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return false when server is unreachable', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.webUrl(),
                    async (url) => {
                        mockFetch.mockRejectedValue(new Error('Connection failed'));
                        mockPerformanceNow.mockReturnValue(0);

                        const result = await isServerReachable(url);
                        
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * testMediaMTXConnection helper tests
     */
    describe('testMediaMTXConnection helper', () => {
        it('should construct correct URL with stream path', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant('http://localhost:8888'),
                    fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/), // Alphanumeric stream paths
                    async (baseUrl, streamPath) => {
                        mockFetch.mockResolvedValue({ ok: true });
                        mockPerformanceNow.mockReturnValue(0);

                        await testMediaMTXConnection(baseUrl, streamPath);
                        
                        const expectedUrl = `${baseUrl}/${streamPath}/index.m3u8`;
                        expect(mockFetch).toHaveBeenCalledWith(
                            expectedUrl,
                            expect.any(Object)
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should use base URL when no stream path provided', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant('http://localhost:8888'),
                    async (baseUrl) => {
                        mockFetch.mockResolvedValue({ ok: true });
                        mockPerformanceNow.mockReturnValue(0);

                        await testMediaMTXConnection(baseUrl);
                        
                        expect(mockFetch).toHaveBeenCalledWith(
                            baseUrl,
                            expect.any(Object)
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
