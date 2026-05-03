/**
 * Purpose: Verifies marker offset metadata for cameras sharing nearly identical coordinates.
 * Caller: Frontend Vitest suite.
 * Deps: mapMarkerLayout utility.
 * MainFuncs: map marker layout tests.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { applyMarkerOffset } from './mapMarkerLayout';

describe('mapMarkerLayout', () => {
    it('keeps the first camera at its original coordinate and offsets stacked cameras', () => {
        const cameras = [
            { id: 1, latitude: '-7.100000', longitude: '111.900000' },
            { id: 2, latitude: '-7.100000', longitude: '111.900000' },
            { id: 3, latitude: '-7.100000', longitude: '111.900000' },
        ];

        const result = applyMarkerOffset(cameras, 0.0003);

        expect(result[0]).toEqual(expect.objectContaining({
            _displayLat: -7.1,
            _displayLng: 111.9,
            _isGrouped: false,
            _groupIndex: 0,
        }));
        expect(result[1]._isGrouped).toBe(true);
        expect(result[1]._groupIndex).toBe(1);
        expect(result[1]._displayLat).toBeCloseTo(-7.09985);
        expect(result[1]._displayLng).toBeCloseTo(111.9002598);
        expect(result[2]._isGrouped).toBe(true);
        expect(result[2]._groupIndex).toBe(2);
    });

    it('groups cameras within four decimal coordinate precision', () => {
        const result = applyMarkerOffset([
            { id: 1, latitude: '-7.100000', longitude: '111.900000' },
            { id: 2, latitude: '-7.100040', longitude: '111.900040' },
            { id: 3, latitude: '-7.100200', longitude: '111.900200' },
        ]);

        expect(result[0]._isGrouped).toBe(false);
        expect(result[1]._isGrouped).toBe(true);
        expect(result[2]._isGrouped).toBe(false);
        expect(result.map((camera) => camera._groupIndex)).toEqual([0, 1, 0]);
    });
});
