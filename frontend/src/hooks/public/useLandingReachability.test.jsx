/*
 * Purpose: Verify landing reachability URL resolution and resilience to flaky health-check responses.
 * Caller: Vitest frontend suite during landing connectivity regression coverage.
 * Deps: Vitest, React Testing Library hooks, mocked runtime config, mocked connection tester.
 * MainFuncs: resolveHealthUrl tests and useLandingReachability tests.
 * SideEffects: Mocks console warnings and browser location only.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const getApiUrlMock = vi.fn();
const testBackendReachabilityMock = vi.fn();

vi.mock('../../config/config.js', () => ({
    getApiUrl: () => getApiUrlMock(),
}));

vi.mock('../../utils/connectionTester', () => ({
    testBackendReachability: (...args) => testBackendReachabilityMock(...args),
}));

describe('resolveHealthUrl', () => {
    const originalLocation = window.location;

    beforeEach(() => {
        getApiUrlMock.mockReset();
    });

afterEach(() => {
    testBackendReachabilityMock.mockReset();
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
        });
    });

    it('uses same-origin /health when runtime api base is relative-empty on IP access', async () => {
        getApiUrlMock.mockReturnValue('');
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                hostname: '172.17.11.12',
                protocol: 'http:',
            },
        });

        const { resolveHealthUrl } = await import('./useLandingReachability.js');
        expect(resolveHealthUrl()).toBe('/health');
    });

    it('uses the configured api base health endpoint when an absolute backend host is configured', async () => {
        getApiUrlMock.mockReturnValue('https://api-cctv.raf.my.id');
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                hostname: 'cctv.raf.my.id',
                protocol: 'https:',
            },
        });

        const { resolveHealthUrl } = await import('./useLandingReachability.js');
        expect(resolveHealthUrl()).toBe('https://api-cctv.raf.my.id/health');
    });
});

describe('useLandingReachability', () => {
    beforeEach(() => {
        getApiUrlMock.mockReset();
        testBackendReachabilityMock.mockReset();
        getApiUrlMock.mockReturnValue('/api');
    });

    it('treats undefined health-check responses as unreachable without throwing', async () => {
        testBackendReachabilityMock.mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { useLandingReachability } = await import('./useLandingReachability.js');

        renderHook(() => useLandingReachability());

        await waitFor(() => {
            expect(testBackendReachabilityMock).toHaveBeenCalledWith('/api/health');
        });

        await waitFor(() => {
            expect(warnSpy).toHaveBeenCalledWith('[LandingPage] Backend health check unreachable');
        });

        expect(warnSpy).not.toHaveBeenCalledWith(
            '[LandingPage] Backend health check failed:',
            expect.any(TypeError)
        );

        warnSpy.mockRestore();
    });
});
