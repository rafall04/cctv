/*
 * Purpose: Lock the two things that make a 36-camera picker usable — de-duplicated labels and
 *          per-area grouping.
 * Caller: `npm test -- src/components/playback/PlaybackHeader.test.jsx`.
 * Deps: vitest, @testing-library/react, ./PlaybackHeader.jsx.
 * MainFuncs: Tests for cameraOptionLabel and groupCamerasByArea.
 * SideEffects: None.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlaybackHeader, { cameraOptionLabel, groupCamerasByArea } from './PlaybackHeader.jsx';

describe('cameraOptionLabel', () => {
    it('drops the location when it only repeats the name', () => {
        expect(cameraOptionLabel({
            name: 'SIMPANG 3 AHMAD YANI - VETERAN',
            location: 'SIMPANG 3 AHMAD YANI - VETERAN',
        })).toBe('SIMPANG 3 AHMAD YANI - VETERAN');
    });

    it('drops the location when the name already contains it', () => {
        expect(cameraOptionLabel({ name: 'SIMPANG 4 RAJEKWESI UTARA', location: 'RAJEKWESI' }))
            .toBe('SIMPANG 4 RAJEKWESI UTARA');
    });

    it('keeps the location when it adds something', () => {
        expect(cameraOptionLabel({ name: 'KAMERA 1', location: 'ALUN-ALUN' }))
            .toBe('KAMERA 1 — ALUN-ALUN');
    });

    it('survives a missing location', () => {
        expect(cameraOptionLabel({ name: 'KAMERA 1' })).toBe('KAMERA 1');
    });
});

describe('groupCamerasByArea', () => {
    const cameras = [
        { id: 1, name: 'ZETA', area_name: 'KAB MAGETAN' },
        { id: 2, name: 'ALFA', area_name: 'KEC BOJONEGORO DAN SEKITARNYA' },
        { id: 3, name: 'BETA', area_name: 'KAB MAGETAN' },
        { id: 4, name: 'GAMMA', area_name: '' },
    ];

    it('groups by area, sorts areas, and sorts names inside each area', () => {
        expect(groupCamerasByArea(cameras).map((g) => [g.area, g.cameras.map((c) => c.name)]))
            .toEqual([
                ['KAB MAGETAN', ['BETA', 'ZETA']],
                ['KEC BOJONEGORO DAN SEKITARNYA', ['ALFA']],
                ['Lainnya', ['GAMMA']],
            ]);
    });

    it('keeps area-less cameras last instead of dropping them', () => {
        const groups = groupCamerasByArea(cameras);
        expect(groups.at(-1).area).toBe('Lainnya');
        expect(groups.flatMap((g) => g.cameras)).toHaveLength(cameras.length);
    });

    it('does not blow up on an empty or missing list', () => {
        expect(groupCamerasByArea([])).toEqual([]);
        expect(groupCamerasByArea(undefined)).toEqual([]);
    });
});

describe('PlaybackHeader picker', () => {
    it('renders one optgroup per area with its camera count, and every camera exactly once', () => {
        const cameras = [
            { id: 1, name: 'ZETA', area_name: 'KAB MAGETAN' },
            { id: 2, name: 'ALFA', area_name: 'KEC BOJONEGORO DAN SEKITARNYA' },
            { id: 3, name: 'BETA', area_name: 'KAB MAGETAN' },
        ];
        const { container } = render(
            <PlaybackHeader cameras={cameras} selectedCamera={cameras[0]} onCameraChange={vi.fn()} />,
        );

        const groups = [...container.querySelectorAll('optgroup')].map((g) => g.label);
        expect(groups).toEqual(['KAB MAGETAN (2)', 'KEC BOJONEGORO DAN SEKITARNYA (1)']);
        expect(container.querySelectorAll('option')).toHaveLength(cameras.length);
        expect(screen.getByLabelText('Pilih kamera').value).toBe('1');
    });
});
