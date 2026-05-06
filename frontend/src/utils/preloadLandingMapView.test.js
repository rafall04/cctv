/*
 * Purpose: Verify public landing map chunk preloader caches the dynamic import request.
 * Caller: Frontend focused landing map preload test gate.
 * Deps: Vitest and preloadLandingMapView.
 * MainFuncs: Map preload tests.
 * SideEffects: Imports the lazy MapView chunk in the test runtime.
 */

import { describe, expect, it } from 'vitest';
import { preloadLandingMapView } from './preloadLandingMapView';

describe('preloadLandingMapView', () => {
    it('returns the same promise for repeated preload calls', () => {
        const first = preloadLandingMapView();
        const second = preloadLandingMapView();

        expect(second).toBe(first);
    });
});
