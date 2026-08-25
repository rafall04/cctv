/*
 * Purpose: Verify public landing map chunk preloader caches the dynamic import request, and forgets it when the request fails.
 * Caller: Frontend focused landing map preload test gate.
 * Deps: Vitest and preloadLandingMapView.
 * MainFuncs: Map preload tests.
 * SideEffects: Imports the lazy MapView chunk in the test runtime; mocks it in the failure case.
 */

import { describe, expect, it, vi } from 'vitest';
import { preloadLandingMapView } from './preloadLandingMapView';

describe('preloadLandingMapView', () => {
    it('returns the same promise for repeated preload calls', () => {
        const first = preloadLandingMapView();
        const second = preloadLandingMapView();

        expect(second).toBe(first);
    });

    it('forgets a failed request so the next attempt really refetches', async () => {
        vi.resetModules();
        let attempts = 0;
        vi.doMock('../components/MapView', () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('Failed to fetch dynamically imported module: /assets/MapView-a1b2.js');
            }
            return { default: () => null };
        });

        // The message is vitest's own mock-factory wrapper, not the browser's — only the shape of
        // the failure (a rejected dynamic import) is what this test needs.
        const { preloadLandingMapView: preload } = await import('./preloadLandingMapView');
        await expect(preload()).rejects.toThrow();
        // A cached rejection would hand the same failure to every later caller — map mode would stay
        // broken for the whole visit, menu changes included.
        await expect(preload()).resolves.toBeTruthy();
        expect(attempts).toBe(2);

        vi.doUnmock('../components/MapView');
    });
});
