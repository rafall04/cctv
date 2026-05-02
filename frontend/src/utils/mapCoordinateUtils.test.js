/*
 * Purpose: Verifies shared map coordinate normalization helpers before MapView consumes them.
 * Caller: Vitest frontend utility test suite.
 * Deps: vitest, mapCoordinateUtils.
 * MainFuncs: mapCoordinateUtils behavior coverage.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import {
    getBoundsCenterFromCameras,
    getValidCoordinatePair,
    hasValidCoords,
    normalizeAreaKey,
} from './mapCoordinateUtils.js';

describe('mapCoordinateUtils', () => {
    it('validates non-zero numeric camera coordinates', () => {
        expect(hasValidCoords({ latitude: '-6.2', longitude: '106.8' })).toBe(true);
        expect(hasValidCoords({ latitude: '0', longitude: '0' })).toBe(false);
        expect(hasValidCoords({ latitude: 'abc', longitude: '106.8' })).toBe(false);
        expect(hasValidCoords(null)).toBe(false);
    });

    it('normalizes area keys for stable grouping', () => {
        expect(normalizeAreaKey('  Area   Selatan  ')).toBe('area selatan');
        expect(normalizeAreaKey(null)).toBe('');
    });

    it('returns parsed coordinate pairs only for valid values', () => {
        expect(getValidCoordinatePair({ latitude: '-6.2', longitude: '106.8' })).toEqual({
            latitude: -6.2,
            longitude: 106.8,
        });
        expect(getValidCoordinatePair({ latitude: '0', longitude: '0' })).toBeNull();
        expect(getValidCoordinatePair(undefined)).toBeNull();
    });

    it('calculates center from valid camera bounds and ignores invalid cameras', () => {
        expect(getBoundsCenterFromCameras([
            { latitude: '-6.3', longitude: '106.7' },
            { latitude: '-6.1', longitude: '106.9' },
            { latitude: 'bad', longitude: '106.9' },
        ])).toEqual({
            latitude: -6.199999999999999,
            longitude: 106.80000000000001,
        });
        expect(getBoundsCenterFromCameras([{ latitude: '0', longitude: '0' }])).toBeNull();
        expect(getBoundsCenterFromCameras(null)).toBeNull();
    });
});
