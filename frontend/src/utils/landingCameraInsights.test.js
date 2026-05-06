/*
 * Purpose: Verify public camera quality badges and smart feed section derivation.
 * Caller: Frontend focused public landing insight test gate.
 * Deps: Vitest and landingCameraInsights utilities.
 * MainFuncs: getPublicCameraQuality, buildPublicSmartFeedSections tests.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { buildPublicSmartFeedSections, getPublicCameraQuality } from './landingCameraInsights';

describe('landingCameraInsights', () => {
    it('classifies camera quality using public-safe camera fields', () => {
        expect(getPublicCameraQuality({ status: 'maintenance' }).label).toBe('Gangguan');
        expect(getPublicCameraQuality({ is_online: 0 }).label).toBe('Offline');
        expect(getPublicCameraQuality({ is_online: 1, live_viewers: 7 }).label).toBe('Ramai');
        expect(getPublicCameraQuality({ is_online: 1, created_at: '2026-05-06 09:00:00' }, new Date('2026-05-06T12:00:00+07:00')).label).toBe('Baru');
        expect(getPublicCameraQuality({ is_online: 1, is_tunnel: 0 }).label).toBe('Stabil');
    });

    it('builds compact smart feed sections without duplicating empty groups', () => {
        const sections = buildPublicSmartFeedSections([
            { id: 1, name: 'Ramai', area_name: 'A', is_online: 1, live_viewers: 8, total_views: 20, created_at: '2026-05-01 08:00:00' },
            { id: 2, name: 'Baru', area_name: 'B', is_online: 1, live_viewers: 0, total_views: 3, created_at: '2026-05-06 08:00:00' },
            { id: 3, name: 'Top', area_name: 'A', is_online: 1, live_viewers: 0, total_views: 90, created_at: '' },
            { id: 4, name: 'Stabil', area_name: 'C', is_online: 1, live_viewers: 0, total_views: 12, created_at: '' },
            { id: 5, name: 'Rekomendasi', area_name: 'C', is_online: 1, live_viewers: 0, total_views: 0, created_at: '' },
        ], new Date('2026-05-06T12:00:00+07:00'));

        expect(sections.map((section) => section.key)).toEqual(['busy', 'newest', 'top', 'recommended']);
        expect(sections.find((section) => section.key === 'busy').cameras[0].name).toBe('Ramai');
        expect(sections.find((section) => section.key === 'newest').cameras[0].name).toBe('Baru');
        expect(sections.find((section) => section.key === 'top').cameras[0].name).toBe('Top');
    });
});
