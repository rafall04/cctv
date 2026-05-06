/*
 * Purpose: Verify public landing camera filter search index keeps large lists cheap and stable.
 * Caller: Frontend focused landing filter test gate.
 * Deps: Vitest, useLandingCameraFilters pure helpers.
 * MainFuncs: buildLandingCameraSearchIndex tests.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { buildLandingCameraSearchIndex, normalizeSearchText } from './useLandingCameraFilters';

describe('landing camera filter search index', () => {
    it('normalizes search text once for camera name, location, and area fields', () => {
        const indexed = buildLandingCameraSearchIndex([
            {
                id: 1,
                name: 'CCTV Gerbang Utara',
                location: 'Jalan Raya',
                area_name: 'KAB SURABAYA',
            },
        ]);

        expect(indexed).toHaveLength(1);
        expect(indexed[0].camera.id).toBe(1);
        expect(indexed[0].searchText).toContain('cctv gerbang utara');
        expect(indexed[0].searchText).toContain('jalan raya');
        expect(indexed[0].searchText).toContain('kab surabaya');
    });

    it('folds diacritics so public search works across mobile keyboard variants', () => {
        expect(normalizeSearchText('Café MÁLAM')).toBe('cafe malam');
    });
});
