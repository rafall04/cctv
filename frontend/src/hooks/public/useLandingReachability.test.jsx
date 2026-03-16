import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const getApiUrlMock = vi.fn();

vi.mock('../../config/config.js', () => ({
    getApiUrl: () => getApiUrlMock(),
}));

describe('resolveHealthUrl', () => {
    const originalLocation = window.location;

    beforeEach(() => {
        getApiUrlMock.mockReset();
    });

    afterEach(() => {
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
