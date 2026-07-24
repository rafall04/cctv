import { describe, it, expect } from 'vitest';
import { getAreaCity, getCameraCityKey, groupCamerasByCity } from './publicCityMapping.js';

describe('publicCityMapping', () => {
    it('maps known area_name values to their canonical city', () => {
        expect(getAreaCity('KAB SURABAYA')).toEqual({ key: 'surabaya', label: 'Surabaya' });
        expect(getAreaCity('DI YOGYAKARTA')).toEqual({ key: 'yogyakarta', label: 'Yogyakarta' });
        expect(getAreaCity('KOTA SURAKARTA')).toEqual({ key: 'solo', label: 'Solo' });
    });

    it('rolls Bojonegoro sub-areas (village/district) up to one city', () => {
        expect(getAreaCity('DS DANDER').key).toBe('bojonegoro');
        expect(getAreaCity('DS TANJUNGHARJO').key).toBe('bojonegoro');
        expect(getAreaCity('KEC BOJONEGORO DAN SEKITARNYA').key).toBe('bojonegoro');
    });

    it('is case/whitespace tolerant (uses normalizeAreaKey)', () => {
        expect(getAreaCity('  kab   surabaya ')).toEqual({ key: 'surabaya', label: 'Surabaya' });
    });

    it('falls back for unknown areas by stripping the admin-level prefix', () => {
        expect(getAreaCity('KAB TUBAN')).toEqual({ key: 'tuban', label: 'Tuban' });
        expect(getAreaCity('KOTA MALANG')).toEqual({ key: 'malang', label: 'Malang' });
    });

    it('returns empty for missing/blank area', () => {
        expect(getAreaCity('')).toEqual({ key: '', label: '' });
        expect(getAreaCity(null)).toEqual({ key: '', label: '' });
        expect(getCameraCityKey({})).toBe('');
        expect(getCameraCityKey({ area_name: 'KAB JOMBANG' })).toBe('jombang');
    });

    it('groups cameras by city, sorted by count desc then label', () => {
        const cameras = [
            { area_name: 'KAB SURABAYA' }, { area_name: 'KAB SURABAYA' }, { area_name: 'KAB SURABAYA' },
            { area_name: 'DS DANDER' }, { area_name: 'DS TANJUNGHARJO' },
            { area_name: 'DI YOGYAKARTA' },
            { area_name: '' }, {},
        ];
        const groups = groupCamerasByCity(cameras);
        expect(groups).toEqual([
            { key: 'surabaya', label: 'Surabaya', count: 3 },
            { key: 'bojonegoro', label: 'Bojonegoro', count: 2 },
            { key: 'yogyakarta', label: 'Yogyakarta', count: 1 },
        ]);
    });

    it('handles empty / non-array input', () => {
        expect(groupCamerasByCity([])).toEqual([]);
        expect(groupCamerasByCity(undefined)).toEqual([]);
    });
});
