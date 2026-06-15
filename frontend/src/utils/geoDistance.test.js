/*
 * Purpose: Verify geographic distance helpers (haversine, label formatting, distance sort).
 * Caller: Frontend util test gate.
 * Deps: Vitest, geoDistance.
 * MainFuncs: distance helper tests.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { haversineMeters, formatDistanceLabel, sortCamerasByDistance } from './geoDistance.js';

describe('haversineMeters', () => {
    it('returns ~0 for identical coordinates', () => {
        const point = { latitude: -7.15, longitude: 111.88 };
        expect(haversineMeters(point, point)).toBeLessThan(1);
    });

    it('approximates one degree of latitude (~111 km)', () => {
        const a = { latitude: -7, longitude: 111 };
        const b = { latitude: -6, longitude: 111 };
        const meters = haversineMeters(a, b);
        // ~111.19 km
        expect(meters).toBeGreaterThan(110000);
        expect(meters).toBeLessThan(112000);
    });

    it('returns null when either side lacks valid coordinates', () => {
        const valid = { latitude: -7.15, longitude: 111.88 };
        expect(haversineMeters(valid, { latitude: null, longitude: null })).toBeNull();
        expect(haversineMeters(null, valid)).toBeNull();
        // 0,0 is treated as "unset" by getValidCoordinatePair
        expect(haversineMeters(valid, { latitude: 0, longitude: 0 })).toBeNull();
    });
});

describe('formatDistanceLabel', () => {
    it('formats sub-kilometer distances in rounded meters', () => {
        expect(formatDistanceLabel(0)).toBe('0 m');
        expect(formatDistanceLabel(354)).toBe('350 m');
        expect(formatDistanceLabel(994)).toBe('990 m');
    });

    it('formats kilometer distances with a comma decimal', () => {
        expect(formatDistanceLabel(1234)).toBe('1,2 km');
        expect(formatDistanceLabel(999)).toBe('1,0 km');
    });

    it('returns null for invalid input', () => {
        expect(formatDistanceLabel(null)).toBeNull();
        expect(formatDistanceLabel(undefined)).toBeNull();
        expect(formatDistanceLabel(Number.NaN)).toBeNull();
        expect(formatDistanceLabel(-10)).toBeNull();
    });
});

describe('sortCamerasByDistance', () => {
    const origin = { id: 1, latitude: -7.15, longitude: 111.88 };

    it('orders cameras nearest-first and tags each with _distanceMeters', () => {
        const far = { id: 2, latitude: -6.15, longitude: 111.88 };
        const near = { id: 3, latitude: -7.05, longitude: 111.88 };

        const sorted = sortCamerasByDistance([far, near], origin);

        expect(sorted.map((camera) => camera.id)).toEqual([3, 2]);
        expect(Number.isFinite(sorted[0]._distanceMeters)).toBe(true);
        expect(sorted[0]._distanceMeters).toBeLessThan(sorted[1]._distanceMeters);
    });

    it('ranks cameras with coordinates ahead of those without, then applies the tiebreaker', () => {
        const withCoords = { id: 2, latitude: -7.0, longitude: 111.88 };
        const noCoordsLowViews = { id: 3, total_views: 5 };
        const noCoordsHighViews = { id: 4, total_views: 50 };

        const tiebreaker = (left, right) => Number(right.total_views || 0) - Number(left.total_views || 0);
        const sorted = sortCamerasByDistance(
            [noCoordsLowViews, noCoordsHighViews, withCoords],
            origin,
            tiebreaker,
        );

        expect(sorted.map((camera) => camera.id)).toEqual([2, 4, 3]);
        expect(sorted[0]._distanceMeters).not.toBeNull();
        expect(sorted[1]._distanceMeters).toBeNull();
    });

    it('does not mutate the input array', () => {
        const input = [
            { id: 2, latitude: -6.15, longitude: 111.88 },
            { id: 3, latitude: -7.05, longitude: 111.88 },
        ];
        const snapshot = input.map((camera) => camera.id);
        sortCamerasByDistance(input, origin);
        expect(input.map((camera) => camera.id)).toEqual(snapshot);
    });
});
