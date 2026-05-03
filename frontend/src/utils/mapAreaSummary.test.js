/**
 * Purpose: Verifies public map area aggregate summary grouping, counts, anchors, and sorting.
 * Caller: Frontend Vitest suite.
 * Deps: mapAreaSummary utilities.
 * MainFuncs: map area summary tests.
 * SideEffects: Mocks console warnings for missing anchors.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAreaSummaryList, getCentroidFromCameras } from './mapAreaSummary';

describe('mapAreaSummary', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calculates a centroid from valid camera coordinates only', () => {
        expect(getCentroidFromCameras([
            { latitude: '-7.0', longitude: '111.0' },
            { latitude: '-7.2', longitude: '111.2' },
            { latitude: '', longitude: '' },
        ])).toEqual({
            latitude: -7.1,
            longitude: 111.1,
        });
    });

    it('groups cameras by normalized area name with status counts and area metadata', () => {
        const summaries = buildAreaSummaryList(
            [{ name: 'Area B', coverage_scope: 'district', viewport_zoom_override: 14 }],
            [
                { id: 1, area_name: 'Area B', latitude: '-7.0', longitude: '111.0', is_online: 1, status: 'active' },
                { id: 2, area_name: 'area b', latitude: '-7.2', longitude: '111.2', is_online: 0, status: 'active' },
                { id: 3, area_name: 'Area A', latitude: '-7.4', longitude: '111.4', is_online: 1, status: 'maintenance' },
            ]
        );

        expect(summaries.map((summary) => summary.areaName)).toEqual(['Area A', 'Area B']);
        expect(summaries[1]).toEqual(expect.objectContaining({
            areaKey: 'area b',
            cameraCount: 2,
            onlineCount: 1,
            offlineCount: 1,
            coverage_scope: 'district',
            viewport_zoom_override: 14,
            hasValidAnchor: true,
            source: 'centroid',
        }));
        expect(summaries[1].anchor).toEqual({ latitude: -7.1, longitude: 111.1 });
    });

    it('keeps missing-anchor groups visible with a warning instead of dropping them', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const summaries = buildAreaSummaryList([], [
            { id: 1, area_name: 'Area Tanpa Koordinat', latitude: '', longitude: '', is_online: 1, status: 'active' },
        ]);

        expect(summaries[0]).toEqual(expect.objectContaining({
            areaName: 'Area Tanpa Koordinat',
            cameraCount: 1,
            hasValidAnchor: false,
            source: 'missing_coordinates',
            anchor: null,
        }));
        expect(warnSpy).toHaveBeenCalledWith('[MapView] Area aggregate missing valid anchor', {
            areaName: 'Area Tanpa Koordinat',
            cameraCount: 1,
            source: 'missing_coordinates',
        });
    });
});
