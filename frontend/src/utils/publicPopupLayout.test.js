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

describe('publicPopupLayout — desktop modal sizing (v6 aspect-fit + backdrop-scroll)', () => {
    it('sizes a 16:9 camera in a 16:9 viewport to the full viewport width, NO maxHeight', () => {
        // 1366×768 viewport, 16:9 camera. width-bound = 1366,
        // height-bound = 768 * 16/9 = 1365.33. Tied at 1365.
        // CRITICAL v6: no maxHeight on the modal — the backdrop owns
        // the scroll now, not the modal.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(style).toEqual({ width: '1365px' });
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
        expect(style).toEqual({ width: '1024px' });
    });

    it('applies the portrait min-width so chrome stays readable on a 9:16 source', () => {
        const portraitTall = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(portraitTall).toEqual({ width: '432px' });

        const portraitShort = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
            viewportWidth: 1366,
            viewportHeight: 480,
        });
        expect(portraitShort).toEqual({ width: `${PUBLIC_POPUP_MIN_DESKTOP_WIDTH}px` });
    });

    it('scales linearly with viewport — no hard cap on desktop', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1920,
            viewportHeight: 1080,
        });
        expect(style).toEqual({ width: '1920px' });
    });

    it('lets a 4K monitor render a 4K-wide modal — Fullscreen is for "I want even bigger"', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 3840,
            viewportHeight: 2160,
        });
        expect(style).toEqual({ width: '3840px' });
    });

    it('does not impose a JS style on mobile viewports — lets Tailwind w-full + backdrop scroll take over', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 390,
            viewportHeight: 844,
        });
        // v6: empty style on mobile, NO maxHeight (backdrop handles
        // scroll). w-full on the CSS class controls width.
        expect(style).toEqual({});
    });

    it('keeps a maxHeight cap ONLY when playback is locked — error card stays sensibly sized', () => {
        // Non-live state (CORS-blocked, codec-incompatible, offline)
        // is the one path that still wants a `maxHeight` cap — a
        // full-bleed aspect-fit error card reads as panic; a stable
        // rectangle reads as "this thing failed".
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

    it('ignores legacy headerHeight/footerHeight/maxDesktopWidth/ad-height args (v1..v5 compat)', () => {
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
        expect(style).toEqual({});
    });

    it('honours an explicit caller-supplied minDesktopWidth override', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
            viewportWidth: 1366,
            viewportHeight: 480,
            minDesktopWidth: 240,
        });
        // height-bound = 480 * 9/16 = 270. Above 240 floor, used as-is.
        expect(style).toEqual({ width: '270px' });
    });
});

describe('publicPopupLayout — desktop modal sizing with chrome budget (v7)', () => {
    it('reserves chrome height so header + video fit one screen (16:9)', () => {
        // 1920×1080, 16:9, chrome=200 → budget = 880.
        // heightBound = 880 * 16/9 = 1564.4 → 1564 (tighter than 1920).
        // video height = 1564 / (16/9) ≈ 880 = budget, so header+video ≈ 1080.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1920,
            viewportHeight: 1080,
            chromeHeight: 200,
        });
        expect(style).toEqual({ width: '1564px' });
    });

    it('auto-fits a non-16:9 camera (4:3) to the same chrome budget', () => {
        // Same 1920×1080 + chrome=200 budget (880), but 4:3:
        // heightBound = 880 * 4/3 = 1173.3 → 1173. The sides narrow to the
        // camera's real ratio — "tidak semua 16:9, tetap menyesuaikan & fit".
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 4 / 3,
            viewportWidth: 1920,
            viewportHeight: 1080,
            chromeHeight: 200,
        });
        expect(style).toEqual({ width: '1173px' });
    });

    it('shrinks the modal as the chrome grows so nothing overflows', () => {
        const base = {
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1920,
            viewportHeight: 1080,
        };
        const shortChrome = getPublicPopupModalStyle({ ...base, chromeHeight: 200 });
        const tallChrome = getPublicPopupModalStyle({ ...base, chromeHeight: 500 });
        expect(shortChrome).toEqual({ width: '1564px' });
        expect(tallChrome).toEqual({ width: '1031px' });
    });

    it('clamps to a minimum video height when chrome would eat the whole viewport', () => {
        // 1366×400, chrome=350 → budget = max(240, 50) = 240 (floor wins).
        // The video keeps a usable size and the backdrop scrolls instead.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 400,
            chromeHeight: 350,
        });
        expect(style).toEqual({ width: '426px' });
    });

    it('treats chromeHeight 0 / omitted as the legacy full-viewport budget', () => {
        const base = {
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
        };
        const omitted = getPublicPopupModalStyle(base);
        const zero = getPublicPopupModalStyle({ ...base, chromeHeight: 0 });
        expect(omitted).toEqual({ width: '1365px' });
        expect(zero).toEqual(omitted);
    });

    it('ignores chromeHeight on mobile — w-full owns sizing there', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 390,
            viewportHeight: 844,
            chromeHeight: 200,
        });
        expect(style).toEqual({});
    });
});
