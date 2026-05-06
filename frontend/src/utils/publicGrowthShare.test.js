/*
 * Purpose: Verify public CCTV branded share helper output.
 * Caller: Frontend focused public growth utility test gate.
 * Deps: vitest, publicGrowthShare.
 * MainFuncs: Area and camera share text tests.
 * SideEffects: None.
 */

import { describe, expect, it, vi } from 'vitest';
import {
    buildAreaShareText,
    buildAreaUrl,
    buildCameraShareText,
    buildCameraUrl,
    getPublicAreaSlug,
    sharePublicText,
} from './publicGrowthShare';

describe('publicGrowthShare', () => {
    it('builds stable area URLs', () => {
        expect(buildAreaUrl('kab-surabaya', 'https://cctv.raf.my.id')).toBe('https://cctv.raf.my.id/area/kab-surabaya');
    });

    it('normalizes public area names into route slugs', () => {
        expect(getPublicAreaSlug({ area_name: 'KAB BOJONEGORO' })).toBe('kab-bojonegoro');
        expect(getPublicAreaSlug({ area_slug: 'kab-surabaya', area_name: 'KAB SURABAYA' })).toBe('kab-surabaya');
    });

    it('builds branded area share text', () => {
        expect(buildAreaShareText({ name: 'KAB SURABAYA', slug: 'kab-surabaya' }, 'https://cctv.raf.my.id')).toBe(
            'CCTV Online KAB SURABAYA - RAF NET\nPantau kamera publik area KAB SURABAYA:\nhttps://cctv.raf.my.id/area/kab-surabaya'
        );
    });

    it('builds camera share URLs and text', () => {
        const camera = { id: 1168, name: 'CCTV ALANG', area_name: 'KAB SURABAYA', area_slug: 'kab-surabaya' };
        expect(buildCameraUrl(camera, 'https://cctv.raf.my.id')).toBe('https://cctv.raf.my.id/area/kab-surabaya?camera=1168');
        expect(buildCameraShareText(camera, 'https://cctv.raf.my.id')).toContain('CCTV CCTV ALANG - RAF NET');
    });

    it('falls back to clipboard when native public sharing fails', async () => {
        const navigatorRef = {
            share: vi.fn().mockRejectedValue(new Error('not available')),
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        };

        const result = await sharePublicText({ text: 'CCTV Online', navigatorRef });

        expect(result).toEqual({ ok: true, status: 'clipboard' });
        expect(navigatorRef.clipboard.writeText).toHaveBeenCalledWith('CCTV Online');
    });
});
