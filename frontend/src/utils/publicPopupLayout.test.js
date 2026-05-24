/*
Purpose: Lock the v4 aspect-ratio-fit sizing semantics for the public live popup.
Caller: Vitest frontend utility suite.
Deps: vitest, publicPopupLayout module.
MainFuncs: tests for getPublicPopupBodyStyle, getPublicPopupModalStyle, getVideoAspectRatio, normalizePublicPopupAspectRatio.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO,
    NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO,
    PUBLIC_POPUP_MIN_DESKTOP_WIDTH,
    getPublicPopupBodyStyle,
    getPublicPopupModalStyle,
    getVideoAspectRatio,
    normalizePublicPopupAspectRatio,
} from './publicPopupLayout.js';

describe('publicPopupLayout — body aspect (v4 aspect-fit)', () => {
    it('keeps fullscreen body ratio as auto so the video fills the container natively', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: true,
            isPlaybackLocked: false,
            videoAspectRatio: 4 / 3,
        })).toEqual({ aspectRatio: 'auto' });
    });

    it('uses the stable non-live ratio while playback is locked', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: true,
            videoAspectRatio: 4 / 3,
        })).toEqual({ aspectRatio: String(NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO) });
    });

    it('falls back to the default live ratio when metadata is not yet available', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: null,
        })).toEqual({ aspectRatio: String(DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO) });
    });

    it('forwards a detected aspect ratio (e.g., 4:3 for old CCTVs) to the body', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 4 / 3,
        })).toEqual({ aspectRatio: String(4 / 3) });
    });

    it('forwards a detected portrait ratio (e.g., 9:16 phone-mounted CCTV) to the body', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
        })).toEqual({ aspectRatio: String(9 / 16) });
    });

    it('no longer caps the body max-height — modal-width math already prevents overflow', () => {
        // v3 had `maxHeight: 92vh` as a defensive cap; v4 removes it
        // because the modal-width formula `min(viewportWidth,
        // viewportHeight * aspectRatio)` already guarantees the body's
        // aspect-derived height never exceeds viewport on its own.
        const style = getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
        });
        expect(style.maxHeight).toBeUndefined();
    });
});

describe('publicPopupLayout — aspect normalisation', () => {
    it('normalises 16:9 with vendor padding back to clean 16:9', () => {
        expect(normalizePublicPopupAspectRatio(1920 / 1088)).toBe(16 / 9);
        expect(normalizePublicPopupAspectRatio(1280 / 736)).toBe(16 / 9);
    });

    it('normalises 4:3 with vendor padding back to clean 4:3', () => {
        expect(normalizePublicPopupAspectRatio(720 / 544)).toBe(4 / 3);
        expect(normalizePublicPopupAspectRatio(640 / 480)).toBe(4 / 3);
    });

    it('snaps near-portrait to 9:16 so phone-mounted CCTVs sit cleanly', () => {
        expect(normalizePublicPopupAspectRatio(540 / 960)).toBe(9 / 16);
    });

    it('leaves a non-standard ratio (e.g., panoramic 1.42) unsnapped', () => {
        const rawRatio = 1.42;
        expect(normalizePublicPopupAspectRatio(rawRatio)).toBe(rawRatio);
    });

    it('reads + normalises the ratio from a video metadata object', () => {
        expect(getVideoAspectRatio({ videoWidth: 1920, videoHeight: 1088 })).toBe(16 / 9);
        expect(getVideoAspectRatio({ videoWidth: 640, videoHeight: 480 })).toBe(4 / 3);
        expect(getVideoAspectRatio(null)).toBeNull();
        expect(getVideoAspectRatio({ videoWidth: 0, videoHeight: 0 })).toBeNull();
    });
});

describe('publicPopupLayout — desktop modal sizing (v4 aspect-ratio fit)', () => {
    it('sizes a 16:9 camera in a 16:9 viewport to the full viewport width', () => {
        // 1366×768 viewport, 16:9 camera. width-bound = 1366,
        // height-bound = 768 * 16/9 = 1365.33. Tied at 1365.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(style.width).toBe('1365px');
    });

    it('shrinks the modal for a 4:3 camera so the sides match the cameras native aspect', () => {
        // 1366×768 viewport, 4:3 camera. height-bound = 768 * 4/3 =
        // 1024. width-bound = 1366. The tighter height-bound wins.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 4 / 3,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(style.width).toBe('1024px');
    });

    it('applies the portrait min-width so chrome stays readable on a 9:16 source', () => {
        // 1366×768, 9:16 camera. height-bound = 768 * 9/16 = 432.
        // Above the 400 minimum, so it stays at 432.
        const portraitTall = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(portraitTall.width).toBe('432px');

        // Same camera in a SHORTER viewport (480px tall): height-bound
        // = 480 * 9/16 = 270. Below the 400 min, floor kicks in.
        const portraitShort = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
            viewportWidth: 1366,
            viewportHeight: 480,
        });
        expect(portraitShort.width).toBe(`${PUBLIC_POPUP_MIN_DESKTOP_WIDTH}px`);
    });

    it('scales linearly with viewport — no hard cap on desktop', () => {
        // 1920×1080, 16:9 camera. height-bound = 1080 * 16/9 = 1920.
        // Width-bound = 1920. Tied at 1920.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1920,
            viewportHeight: 1080,
        });
        expect(style.width).toBe('1920px');
    });

    it('lets a 4K monitor render a 4K-wide modal — Fullscreen is for "I want even bigger"', () => {
        // 3840×2160, 16:9 camera. Both bounds = 3840. Modal fills.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 3840,
            viewportHeight: 2160,
        });
        expect(style.width).toBe('3840px');
    });

    it('does not impose a JS width on mobile viewports — lets Tailwind w-full take over', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 390,
            viewportHeight: 844,
        });
        expect(style.width).toBeUndefined();
        expect(style.maxHeight).toBe('100vh');
    });

    it('returns the bare maxHeight only when playback is locked, regardless of viewport', () => {
        // Non-live state: stable rectangular shell, no aspect-fit
        // sizing (full-bleed-feel reads wrong for an error screen).
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: true,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(style.width).toBeUndefined();
        expect(style.maxHeight).toBe('100vh');
    });

    it('returns an empty style in fullscreen — the CSS w-full h-full takes over', () => {
        expect(getPublicPopupModalStyle({
            isFullscreen: true,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
        })).toEqual({});
    });

    it('ignores legacy headerHeight/footerHeight/maxDesktopWidth/ad-height args (v1+v2+v3 compat)', () => {
        const baseArgs = {
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
        };
        const without = getPublicPopupModalStyle(baseArgs);
        const withLegacy = getPublicPopupModalStyle({
            ...baseArgs,
            headerHeight: 240,
            footerHeight: 180,
            topAdHeight: 120,
            bottomAdHeight: 220,
            maxDesktopWidth: 1024,
            videoHeightFraction: 0.78,
        });
        expect(withLegacy).toEqual(without);
    });

    it('refuses to invent a width when given garbage viewport metrics', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: NaN,
            viewportHeight: 0,
        });
        expect(style.width).toBeUndefined();
        expect(style.maxHeight).toBe('100vh');
    });

    it('honours an explicit caller-supplied minDesktopWidth override', () => {
        // Caller forces a tighter floor (e.g., for an embedded preview
        // surface that can't bear the default 400 px). Portrait video
        // at 480p would otherwise hit the 400 default.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
            viewportWidth: 1366,
            viewportHeight: 480,
            minDesktopWidth: 240,
        });
        // height-bound = 480 * 9/16 = 270. Above 240 floor, used as-is.
        expect(style.width).toBe('270px');
    });
});
