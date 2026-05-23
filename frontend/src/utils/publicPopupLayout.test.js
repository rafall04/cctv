import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO,
    NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO,
    getPublicPopupBodyStyle,
    getPublicPopupModalStyle,
    getVideoAspectRatio,
    normalizePublicPopupAspectRatio,
} from './publicPopupLayout.js';

describe('publicPopupLayout', () => {
    it('menjaga ratio fullscreen tetap auto', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: true,
            isPlaybackLocked: false,
            videoAspectRatio: 4 / 3,
        })).toEqual({ aspectRatio: 'auto' });
    });

    it('memakai ratio stabil untuk non-live popup', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: true,
            videoAspectRatio: 4 / 3,
        })).toEqual({ aspectRatio: String(NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO) });
    });

    it('menormalkan rasio 16:9 padded ke 16:9', () => {
        expect(normalizePublicPopupAspectRatio(1920 / 1088)).toBe(16 / 9);
        expect(normalizePublicPopupAspectRatio(1280 / 736)).toBe(16 / 9);
    });

    it('menormalkan rasio 4:3 padded ke 4:3', () => {
        expect(normalizePublicPopupAspectRatio(720 / 544)).toBe(4 / 3);
        expect(normalizePublicPopupAspectRatio(640 / 480)).toBe(4 / 3);
    });

    it('membiarkan rasio non-standar tetap apa adanya', () => {
        const rawRatio = 1.42;
        expect(normalizePublicPopupAspectRatio(rawRatio)).toBe(rawRatio);
    });

    it('mengambil rasio video yang sudah dinormalisasi dari metadata', () => {
        const video = { videoWidth: 1920, videoHeight: 1088 };
        expect(getVideoAspectRatio(video)).toBe(16 / 9);
    });

    it('fallback ke ratio live default saat metadata belum tersedia', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: null,
        })).toEqual({ aspectRatio: String(DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO) });
    });

    it('menghitung lebar modal live desktop berdasarkan tinggi yang tersedia', () => {
        expect(getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
            headerHeight: 88,
            footerHeight: 64,
            maxDesktopWidth: 1024,
        })).toEqual({
            maxHeight: 'calc(100vh - 16px)',
            width: '1024px',
        });
    });

    it('tidak memaksa width desktop khusus pada mobile', () => {
        expect(getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 390,
            viewportHeight: 844,
            headerHeight: 88,
            footerHeight: 64,
            maxDesktopWidth: 1024,
        })).toEqual({
            maxHeight: 'calc(100vh - 16px)',
        });
    });

    it('membiarkan modal non-live tetap memakai layout stabil lama', () => {
        expect(getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: true,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
            headerHeight: 88,
            footerHeight: 64,
            maxDesktopWidth: 1024,
        })).toEqual({
            maxHeight: 'calc(100vh - 16px)',
        });
    });

    it('mengabaikan tinggi ads — video tidak boleh mengecil saat slot iklan load', () => {
        // Regresi: dulu topAdHeight + bottomAdHeight ikut dikurangkan dari
        // availableBodyHeight, dan body memakai `aspect-ratio: 16/9`, jadi
        // setiap kali ResizeObserver di InlineAdSlot meneruskan tinggi baru,
        // modal menyusut dan CCTV ikut menyusut. Fungsi ini sekarang tidak
        // boleh menerima/memakai field ad-height — kalau pun nilai dikirim
        // (compat lama), output harus identik dengan tanpa ads.
        const baseArgs = {
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
            headerHeight: 88,
            footerHeight: 64,
            maxDesktopWidth: 1024,
        };
        const without = getPublicPopupModalStyle(baseArgs);
        const withAdNoise = getPublicPopupModalStyle({
            ...baseArgs,
            topAdHeight: 120,
            bottomAdHeight: 220,
        });
        expect(withAdNoise).toEqual(without);
    });
});

