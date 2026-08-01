/*
 * Purpose: Lock the matching rules that make 36 inconsistently-named cameras findable.
 * Caller: `npm test -- src/utils/playbackCameraPicker.test.js`.
 * Deps: vitest, ./playbackCameraPicker.js.
 * MainFuncs: Tests for normalizeText, cameraSearchHaystack, filterCameras, groupCamerasByArea, areaFacets.
 * SideEffects: None.
 *
 * Fixtures are copied from real production names (verbatim, including the inconsistent casing and
 * the underscore) — inventing tidy names would test a dataset we do not have.
 */

import { describe, it, expect } from 'vitest';
import {
    normalizeText,
    cameraSearchHaystack,
    filterCameras,
    filterByArea,
    groupCamerasByArea,
    areaFacets,
    distinctLocation,
} from './playbackCameraPicker.js';

const MAGETAN = 'KAB MAGETAN';
const BOJONEGORO = 'KEC BOJONEGORO DAN SEKITARNYA';

const CAMERAS = [
    { id: 1, name: 'S4_Ngariboyo', area_name: MAGETAN },
    { id: 2, name: 'SIMPANG 4 BUNDARAN JETAK', area_name: BOJONEGORO },
    { id: 3, name: 'SIMPANG 4 BASUKI RAHMAT - DR. CIPTO', area_name: BOJONEGORO },
    { id: 4, name: 'Jl. Basuki Rahmat Timur - Alun-Alun', area_name: MAGETAN },
    { id: 5, name: 'PEREMPATAN JEMBATAN SOSRODILOGO', location: 'SIMPANG 4 RAJEKWESI - SOSRODILOGO', area_name: BOJONEGORO },
    { id: 6, name: 'WISATA STRAWBERRY', area_name: MAGETAN },
];

const ids = (list) => list.map((c) => c.id).sort((a, b) => a - b);

describe('normalizeText', () => {
    it('flattens case and every punctuation run to single spaces', () => {
        expect(normalizeText('S4_Ngariboyo')).toBe('s4 ngariboyo');
        expect(normalizeText('SIMPANG 4 U.SUROPATI - PANGLIMA POLIM')).toBe('simpang 4 u suropati panglima polim');
        expect(normalizeText('Jl. Basuki Rahmat Timur - Alun-Alun')).toBe('jl basuki rahmat timur alun alun');
    });

    it('survives null and undefined', () => {
        expect(normalizeText(null)).toBe('');
        expect(normalizeText(undefined)).toBe('');
    });
});

describe('cameraSearchHaystack', () => {
    it('indexes a contracted junction under its long spelling too', () => {
        expect(cameraSearchHaystack({ name: 'S4_Ngariboyo' })).toContain('simpang 4 ngariboyo');
    });

    it('indexes a long junction under its contracted spelling too', () => {
        expect(cameraSearchHaystack({ name: 'SIMPANG 4 BUNDARAN JETAK' })).toContain('s4 bundaran jetak');
    });

    it('includes location and area, so an area name is searchable', () => {
        const hay = cameraSearchHaystack(CAMERAS[4]);
        expect(hay).toContain('rajekwesi');
        expect(hay).toContain('bojonegoro');
    });

    it('returns empty for a camera with nothing to index', () => {
        expect(cameraSearchHaystack({})).toBe('');
    });
});

describe('filterCameras', () => {
    it('returns everything for an empty or whitespace query', () => {
        expect(filterCameras(CAMERAS, '')).toHaveLength(CAMERAS.length);
        expect(filterCameras(CAMERAS, '   ')).toHaveLength(CAMERAS.length);
    });

    it('matches words in any order, not just as a prefix', () => {
        expect(ids(filterCameras(CAMERAS, 'cipto basuki'))).toEqual([3]);
    });

    it('finds a contracted name when the visitor types the long spelling', () => {
        expect(ids(filterCameras(CAMERAS, 'simpang 4 ngariboyo'))).toEqual([1]);
    });

    it('finds a long name when the visitor types the contracted spelling', () => {
        expect(ids(filterCameras(CAMERAS, 's4 jetak'))).toEqual([2]);
    });

    it('ignores the punctuation the operator happened to use', () => {
        expect(ids(filterCameras(CAMERAS, 's4-ngariboyo'))).toEqual([1]);
        expect(ids(filterCameras(CAMERAS, 'alun alun'))).toEqual([4]);
    });

    it('matches on location even when the name says nothing about it', () => {
        expect(ids(filterCameras(CAMERAS, 'rajekwesi'))).toEqual([5]);
    });

    it('requires every word — an AND match, so common words do not return the whole list', () => {
        expect(ids(filterCameras(CAMERAS, 'simpang'))).toEqual([1, 2, 3, 5]);
        expect(ids(filterCameras(CAMERAS, 'simpang strawberry'))).toEqual([]);
    });

    it('survives a missing list', () => {
        expect(filterCameras(undefined, 'apa saja')).toEqual([]);
    });
});

describe('groupCamerasByArea', () => {
    it('sorts areas, sorts names inside each, and keeps the area-less bucket last', () => {
        const cameras = [...CAMERAS, { id: 7, name: 'TANPA AREA' }];
        expect(groupCamerasByArea(cameras).map((g) => [g.area, g.cameras.length])).toEqual([
            [MAGETAN, 3],
            [BOJONEGORO, 3],
            ['Lainnya', 1],
        ]);
        expect(groupCamerasByArea(cameras)[0].cameras.map((c) => c.name)).toEqual([
            'Jl. Basuki Rahmat Timur - Alun-Alun', 'S4_Ngariboyo', 'WISATA STRAWBERRY',
        ]);
    });

    it('never drops a camera', () => {
        expect(groupCamerasByArea(CAMERAS).flatMap((g) => g.cameras)).toHaveLength(CAMERAS.length);
    });

    it('survives empty and missing input', () => {
        expect(groupCamerasByArea([])).toEqual([]);
        expect(groupCamerasByArea(undefined)).toEqual([]);
    });
});

describe('filterByArea', () => {
    it('narrows to one area', () => {
        expect(ids(filterByArea(CAMERAS, MAGETAN))).toEqual([1, 4, 6]);
    });

    it('treats the all-key and an unknown key as no narrowing', () => {
        expect(filterByArea(CAMERAS, 'all')).toHaveLength(CAMERAS.length);
        expect(filterByArea(CAMERAS, '')).toHaveLength(CAMERAS.length);
    });

    it('reaches area-less cameras through the fallback bucket', () => {
        expect(ids(filterByArea([...CAMERAS, { id: 7, name: 'TANPA AREA' }], 'Lainnya'))).toEqual([7]);
    });
});

describe('distinctLocation', () => {
    it('drops a location that only repeats the name', () => {
        expect(distinctLocation({ name: 'SIMPANG 3 AHMAD YANI - VETERAN', location: 'SIMPANG 3 AHMAD YANI - VETERAN' })).toBe('');
    });

    it('drops a location the name already contains, ignoring punctuation differences', () => {
        expect(distinctLocation({ name: 'SIMPANG 4 RAJEKWESI UTARA', location: 'Rajekwesi' })).toBe('');
        expect(distinctLocation({ name: 'S4_Ngariboyo', location: 'S4 Ngariboyo' })).toBe('');
    });

    it('keeps a location that adds something, in its original form', () => {
        expect(distinctLocation(CAMERAS[4])).toBe('SIMPANG 4 RAJEKWESI - SOSRODILOGO');
    });

    it('returns empty when there is no location at all', () => {
        expect(distinctLocation({ name: 'WISATA STRAWBERRY' })).toBe('');
    });
});

describe('areaFacets', () => {
    it('puts an all-chip first and counts each area', () => {
        expect(areaFacets(CAMERAS)).toEqual([
            { key: 'all', label: 'Semua', count: 6 },
            { key: MAGETAN, label: MAGETAN, count: 3 },
            { key: BOJONEGORO, label: BOJONEGORO, count: 3 },
        ]);
    });

    it('still reports a zero total rather than throwing', () => {
        expect(areaFacets([])).toEqual([{ key: 'all', label: 'Semua', count: 0 }]);
    });
});
