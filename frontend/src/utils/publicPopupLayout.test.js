/*
Purpose: Lock the v3 full-bleed sizing semantics for the public live popup.
Caller: Vitest frontend utility suite.
Deps: vitest, publicPopupLayout module.
MainFuncs: tests for getPublicPopupBodyStyle, getPublicPopupModalStyle, getVideoAspectRatio, normalizePublicPopupAspectRatio.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO,
    NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO,
    PUBLIC_POPUP_BODY_MAX_HEIGHT_VH,
    getPublicPopupBodyStyle,
    getPublicPopupModalStyle,
    getVideoAspectRatio,
    normalizePublicPopupAspectRatio,
} from './publicPopupLayout.js';

describe('publicPopupLayout — body aspect (v3 full-bleed)', () => {
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
        })).toEqual({
            aspectRatio: String(NON_LIVE_PUBLIC_POPUP_ASPECT_RATIO),
            maxHeight: `${PUBLIC_POPUP_BODY_MAX_HEIGHT_VH}vh`,
        });
    });

    it('falls back to the default live ratio when metadata is not yet available', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: null,
        })).toEqual({
            aspectRatio: String(DEFAULT_PUBLIC_POPUP_LIVE_ASPECT_RATIO),
            maxHeight: `${PUBLIC_POPUP_BODY_MAX_HEIGHT_VH}vh`,
        });
    });

    it('forwards a detected aspect ratio (e.g., 4:3 for old CCTVs) to the body', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 4 / 3,
        })).toEqual({
            aspectRatio: String(4 / 3),
            maxHeight: `${PUBLIC_POPUP_BODY_MAX_HEIGHT_VH}vh`,
        });
    });

    it('forwards a detected portrait ratio (e.g., 9:16 phone-mounted CCTV) to the body', () => {
        expect(getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 9 / 16,
        })).toEqual({
            aspectRatio: String(9 / 16),
            maxHeight: `${PUBLIC_POPUP_BODY_MAX_HEIGHT_VH}vh`,
        });
    });

    it('applies the body max-height cap so a 16:9 camera doesn\'t fill an entire 4K monitor', () => {
        // The cap is a viewport-relative vh value, not an absolute px
        // value, so any monitor size gets a sensible upper bound.
        // 92vh on 2160p = ~1987px ceiling — well below the 16:9
        // aspect-ratio-driven height of ~2160px that a full-bleed
        // 3840px-wide body would otherwise demand.
        const style = getPublicPopupBodyStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            videoAspectRatio: 16 / 9,
        });
        expect(style.maxHeight).toBe('92vh');
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

describe('publicPopupLayout — desktop modal sizing (v3 full-bleed)', () => {
    it('returns width:100vw on desktop so the modal spans the full viewport', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            viewportWidth: 1366,
        });
        expect(style.width).toBe('100vw');
        expect(style.maxWidth).toBe('100vw');
        expect(style.maxHeight).toBe('calc(100vh - 16px)');
    });

    it('returns the same 100vw width regardless of aspect ratio — body handles per-camera shape', () => {
        // 4:3 / 16:9 / portrait all return the same modal width.
        // The body element below uses aspect-ratio + max-height to
        // shape the actual video, and the <video> letterboxes inside
        // when those constraints collide.
        for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16]) {
            const style = getPublicPopupModalStyle({
                isFullscreen: false,
                isPlaybackLocked: false,
                videoAspectRatio: aspect,
                viewportWidth: 1366,
                viewportHeight: 768,
            });
            expect(style.width).toBe('100vw');
        }
    });

    it('scales to the actual viewport on ultra-wide displays — no hard cap anymore', () => {
        // v2 capped at 1280px; v3 trusts the body max-height to
        // prevent a 4K monitor from rendering an absurd video. The
        // modal width matches the viewport.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            viewportWidth: 3840,
        });
        expect(style.width).toBe('100vw');
    });

    it('does not impose a JS width on mobile viewports — lets Tailwind w-full take over', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            viewportWidth: 390,
        });
        expect(style).toEqual({ maxHeight: 'calc(100vh - 16px)' });
    });

    it('returns the bare maxHeight only when playback is locked, regardless of viewport', () => {
        // Non-live state: a stable rectangular shell (no full-bleed).
        // Full-bleed implies live/successful playback; a CORS-blocked
        // or codec-incompatible state reads better as a centered
        // card.
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: true,
            viewportWidth: 1366,
        });
        expect(style).toEqual({ maxHeight: 'calc(100vh - 16px)' });
    });

    it('returns an empty style in fullscreen — the CSS w-full h-full takes over', () => {
        expect(getPublicPopupModalStyle({
            isFullscreen: true,
            isPlaybackLocked: false,
            viewportWidth: 1366,
        })).toEqual({});
    });

    it('ignores legacy headerHeight/footerHeight/aspect/maxDesktopWidth args (v1+v2 compat)', () => {
        // Regression suite: even if a caller still threads the v1 or
        // v2 args, the v3 output must not change. Otherwise a stale
        // binding could silently flip the modal back to a narrow
        // centered card.
        const baseArgs = {
            isFullscreen: false,
            isPlaybackLocked: false,
            viewportWidth: 1366,
        };
        const without = getPublicPopupModalStyle(baseArgs);
        const withLegacy = getPublicPopupModalStyle({
            ...baseArgs,
            videoAspectRatio: 16 / 9,
            viewportHeight: 768,
            headerHeight: 240,
            footerHeight: 180,
            topAdHeight: 120,
            bottomAdHeight: 220,
            maxDesktopWidth: 1024,
            minDesktopWidth: 480,
            videoHeightFraction: 0.78,
        });
        expect(withLegacy).toEqual(without);
    });

    it('refuses to invent a width when given a NaN viewport width', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            viewportWidth: NaN,
        });
        expect(style).toEqual({ maxHeight: 'calc(100vh - 16px)' });
    });

    it('honours an explicit caller-supplied viewportVerticalPadding override', () => {
        const style = getPublicPopupModalStyle({
            isFullscreen: false,
            isPlaybackLocked: false,
            viewportWidth: 1366,
            viewportVerticalPadding: 40,
        });
        expect(style.maxHeight).toBe('calc(100vh - 40px)');
    });

    it('exports a sensible body height cap constant', () => {
        // Sanity: keep this value in a public constant so other
        // surfaces (preview pages, admin) can mirror the live popup.
        expect(PUBLIC_POPUP_BODY_MAX_HEIGHT_VH).toBeGreaterThan(80);
        expect(PUBLIC_POPUP_BODY_MAX_HEIGHT_VH).toBeLessThanOrEqual(95);
    });
});
