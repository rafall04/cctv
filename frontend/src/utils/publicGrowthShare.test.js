import { describe, expect, it } from 'vitest';
import {
    buildAreaPath,
    buildAreaUrl,
    buildCameraUrl,
    getPublicAreaSlug,
} from './publicGrowthShare';

describe('publicGrowthShare', () => {
    it('normalizes raw area names into canonical area paths', () => {
        expect(getPublicAreaSlug('Jakarta Pusat')).toBe('jakarta-pusat');
        expect(buildAreaPath('Jakarta Pusat')).toBe('/area/jakarta-pusat');
    });

    it('prefers persisted area slug fields over display names', () => {
        expect(buildAreaPath({
            slug: 'tanah-abang',
            name: 'Tanah Abang Updated',
        })).toBe('/area/tanah-abang');
    });

    it('builds canonical area URLs', () => {
        expect(buildAreaUrl({ slug: 'tanah-abang' }, 'https://cctv.example.com'))
            .toBe('https://cctv.example.com/area/tanah-abang');
    });

    it('builds canonical area camera URLs with slug camera params', () => {
        expect(buildCameraUrl({
            id: 7,
            name: 'Gerbang Utama',
            area_slug: 'tanah-abang',
        }, 'https://cctv.example.com')).toBe('https://cctv.example.com/area/tanah-abang?camera=7-gerbang-utama');
    });

    it('falls back to the landing camera URL when area slug is missing', () => {
        expect(buildCameraUrl({
            id: 8,
            name: 'Lobby Barat',
        }, 'https://cctv.example.com')).toBe('https://cctv.example.com/?camera=8-lobby-barat');
    });
});
