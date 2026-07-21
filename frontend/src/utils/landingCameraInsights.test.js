/*
 * Purpose: Verify public camera quality badge derivation.
 * Caller: Frontend focused public landing insight test gate.
 * Deps: Vitest and landingCameraInsights utilities.
 * MainFuncs: getPublicCameraQuality tests.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { getPublicCameraQuality } from './landingCameraInsights';

describe('landingCameraInsights', () => {
    it('classifies camera quality using public-safe camera fields', () => {
        expect(getPublicCameraQuality({ status: 'maintenance' }).label).toBe('Gangguan');
        expect(getPublicCameraQuality({ is_online: 0 }).label).toBe('Offline');
        expect(getPublicCameraQuality({ is_online: 1, live_viewers: 7 }).label).toBe('Ramai');
        expect(getPublicCameraQuality({ is_online: 1, created_at: '2026-05-06 09:00:00' }, new Date('2026-05-06T12:00:00+07:00')).label).toBe('Baru');
        expect(getPublicCameraQuality({ is_online: 1, is_tunnel: 0 }).label).toBe('Stabil');
    });
});
