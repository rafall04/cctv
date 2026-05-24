/*
Purpose: Lock the v2 video-priority sizing semantics for the public live popup.
Caller: Vitest frontend utility suite.
Deps: vitest, publicPopupLayout module.
MainFuncs: tests for getPublicPopupBodyStyle, getPublicPopupModalStyle, getVideoAspectRatio, normalizePublicPopupAspectRatio.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO,
    NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO,
    DEFAULT_PUBLIC_POPUP_MAX_DESKTOP_WIDTH,
    PUBLIC_POPUP_MIN_DESKTOP_WIDTH,
    PUBLIC_POPUP_VIDEO_HEIGHT_FRACTION,
    getPublicPopupBodyStyle,
    getPublicPopupModalStyle,
    getVideoAspectRatio,
    normalizePublicPopupAspectRatio,
} from './publicPopupLayout.js';

describe('publicPopupLayout — body aspect', () => {
    it('keeps fullscreen body ratio as auto so the video fills the container natively', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: true,
            isPlaybackLocked: false,
            videoAspectRatio: 4 / 3,
        })).toEqual({ aspectRatio: 'auto' });
    });

    it('uses the stable non-live ratio while playback is locked (CORS / codec / offline)', () => {
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

describe('publicPopupLayout — desktop modal sizing (v2 video-priority)', () => {
    it('sizes the modal so a 16:9 video gets a deliberate fraction of viewport height', () => {
        // 1366×768 viewport, 16:9 video, default fraction 0.78.
        // Target video height = floor(768 * 0.78) = 599
        // Target video width  = floor(599 * 16/9) = 1064
        // Cap                 = 1280 (DEFAULT_PUBLIC_POPUP_MAX_DESKTOP_WIDTH)
        // Available width     = 1366 - 32 = 1334
        // Modal width         = min(1280, 1334, 1064) = 1064
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(style.width).toBe('1064px');
        expect(style.maxHeight).toBe('calc(100vh - 16px)');
    });

    it('shrinks the modal for a 4:3 camera so the video keeps its native ratio without letterboxing', () => {
        // 1366×768, 4:3 camera. Target video height 599, width 798.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 4 / 3,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        // floor(599 * 4/3) = floor(798.66) = 798
        expect(style.width).toBe('798px');
    });

    it('applies the portrait-camera minimum width so chrome stays readable on a 9:16 source', () => {
        // 1366×768, 9:16 camera. Target video width = floor(599 * 9/16) = 336.
        // 336 < 480 floor, so the modal expands to 480px and the body
        // (via aspect-ratio CSS) ends up letterboxed inside that width.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(style.width).toBe(`${PUBLIC_POPUP_MIN_DESKTOP_WIDTH}px`);
    });

    it('caps the modal width on ultra-wide displays instead of growing edge-to-edge', () => {
        // 4K viewport, 16:9 video. Target width = floor(2160 * 0.78 * 16/9) = 2995
        // Cap kicks in at 1280.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 3840,
            viewportHeight: 2160,
        });
        expect(style.width).toBe(`${DEFAULT_PUBLIC_POPUP_MAX_DESKTOP_WIDTH}px`);
    });

    it('honours an explicit caller-supplied maxDesktopWidth override', () => {
        // Caller passes a tighter cap (admin pages may want a smaller popup).
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1920,
            viewportHeight: 1080,
            maxDesktopWidth: 900,
        });
        expect(style.width).toBe('900px');
    });

    it('does not impose a JS width on mobile viewports — lets Tailwind w-full take over', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 390,
            viewportHeight: 844,
        });
        expect(style).toEqual({ maxHeight: 'calc(100vh - 16px)' });
    });

    it('returns the bare maxHeight only when playback is locked, regardless of viewport', () => {
        // Non-live state: a stable rectangular shell, no JS-computed width.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: true,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
        });
        expect(style).toEqual({ maxHeight: 'calc(100vh - 16px)' });
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

    it('ignores legacy headerHeight/footerHeight/ad-height args (v1 compat) — video size is independent', () => {
        // Regression: before v2, header/footer/ad heights were subtracted
        // from the viewport so the video shrank every time an ad creative
        // reloaded. v2 sizes the video against viewport height directly;
        // overflow scrolls. These args MUST be silently ignored.
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
        });
        expect(withLegacy).toEqual(without);
    });

    it('clamps an out-of-range videoHeightFraction so it can never starve or overflow the modal', () => {
        // Pathological caller passes 0.01 → clamps to 0.4 floor.
        const tooSmall = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
            videoHeightFraction: 0.01,
        });
        // floor(floor(768 * 0.4) * 16/9) = floor(307 * 16/9) = 545
        expect(tooSmall.width).toBe('545px');

        // Pathological caller passes 5 → clamps to 0.95 ceiling.
        const tooLarge = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: 1366,
            viewportHeight: 768,
            videoHeightFraction: 5,
        });
        // floor(768 * 0.95 * 16/9) = 1296 → capped by viewport width 1334 → capped by cap 1280
        expect(tooLarge.width).toBe(`${DEFAULT_PUBLIC_POPUP_MAX_DESKTOP_WIDTH}px`);
    });

    it('refuses to invent a width when given garbage viewport metrics', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
            viewportWidth: NaN,
            viewportHeight: 0,
        });
        expect(style).toEqual({ maxHeight: 'calc(100vh - 16px)' });
    });

    it('exports a sensible default video-height fraction', () => {
        // Sanity: keep this value in a public constant so admin / preview
        // pages that want to mirror the live popup's sizing can import it.
        expect(PUBLIC_POPUP_VIDEO_HEIGHT_FRACTION).toBeGreaterThan(0.5);
        expect(PUBLIC_POPUP_VIDEO_HEIGHT_FRACTION).toBeLessThan(0.9);
    });
});
