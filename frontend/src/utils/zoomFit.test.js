/*
Purpose: Lock the fullscreen fill-on-zoom geometry — a differently-shaped camera fills the viewport
         the moment you zoom in (no pillarbox bars) AND every edge stays reachable by pan (nothing is
         cropped away, unlike object-cover).
Caller: Vitest frontend suite.
Deps: none (pure math).
*/
import { describe, expect, it } from 'vitest';
import { computeFitFractions, fillScaleFrom, appliedScale, maxPanPercent } from './zoomFit.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('zoomFit.computeFitFractions', () => {
    it('a narrower video (16:9 on an ultrawide phone) letterboxes left/right (fw < 1, fh = 1)', () => {
        const { fw, fh } = computeFitFractions(16 / 9, 2000 / 960);
        expect(fh).toBe(1);
        expect(fw).toBeLessThan(1);
        expect(close(fw, (16 / 9) / (2000 / 960))).toBe(true);
    });

    it('a 4:3 camera on a 16:9 screen letterboxes left/right (fw = 0.75)', () => {
        const { fw, fh } = computeFitFractions(4 / 3, 16 / 9);
        expect(fh).toBe(1);
        expect(close(fw, 0.75)).toBe(true);
    });

    it('a wider video (21:9 on a 16:9 screen) letterboxes top/bottom (fh < 1, fw = 1)', () => {
        const { fw, fh } = computeFitFractions(21 / 9, 16 / 9);
        expect(fw).toBe(1);
        expect(fh).toBeLessThan(1);
    });

    it('matched aspect ratios have no bars (fw = fh = 1)', () => {
        expect(computeFitFractions(16 / 9, 16 / 9)).toEqual({ fw: 1, fh: 1 });
    });

    it('invalid inputs fall back to neutral {1,1}', () => {
        expect(computeFitFractions(0, 1.5)).toEqual({ fw: 1, fh: 1 });
        expect(computeFitFractions(1.5, NaN)).toEqual({ fw: 1, fh: 1 });
    });
});

describe('zoomFit.fillScaleFrom', () => {
    it('is the reciprocal of the short (bar) axis', () => {
        expect(close(fillScaleFrom({ fw: 0.75, fh: 1 }), 4 / 3)).toBe(true);
        expect(close(fillScaleFrom({ fw: 1, fh: 0.5 }), 2)).toBe(true);
    });
    it('is 1 when there are no bars', () => {
        expect(fillScaleFrom({ fw: 1, fh: 1 })).toBe(1);
    });
});

describe('zoomFit.appliedScale', () => {
    it('windowed always applies the raw zoom (no boost)', () => {
        expect(appliedScale(1.5, 1.333, false)).toBe(1.5);
    });
    it('fullscreen at 1x applies raw zoom (overview keeps its honest letterbox)', () => {
        expect(appliedScale(1, 1.333, true)).toBe(1);
    });
    it('fullscreen + zoomed boosts by fillScale so the first zoom fills the width', () => {
        expect(close(appliedScale(1.5, 4 / 3, true), 2)).toBe(true);
    });
});

describe('zoomFit.maxPanPercent — pan reaches every edge in fullscreen', () => {
    // 4:3 camera on a 16:9 screen: fw=0.75, fh=1, fillScale=4/3.
    const { fw, fh } = computeFitFractions(4 / 3, 16 / 9);
    const fillScale = fillScaleFrom({ fw, fh });

    it('the moment you zoom in, the fill axis is filled and pannable (no residual bar)', () => {
        // zoom=1.5 → appliedScale=2. Width frac = 0.75*2 = 1.5 (>1 → fills, no L/R bar).
        const panX = maxPanPercent(1.5, fw, fillScale, true);
        expect(panX).toBeGreaterThan(0);
        expect(close(panX, ((0.75 * 2 - 1) / (2 * 2)) * 100)).toBe(true); // 12.5%
    });

    it('the axis the fill pushes off-screen (top/bottom) is reachable by pan — NOT cropped away', () => {
        // Height frac = 1*2 = 2 → 25% pan each way covers the overflow the fill created.
        const panY = maxPanPercent(1.5, fh, fillScale, true);
        expect(close(panY, 25)).toBe(true);
        expect(panY).toBeGreaterThan(0);
    });

    it('at 1x (overview) there is nothing to pan', () => {
        expect(maxPanPercent(1, fw, fillScale, true)).toBe(0);
        expect(maxPanPercent(1, fh, fillScale, true)).toBe(0);
    });

    it('16:9 camera on an ultrawide phone: zooming fills the width, top/bottom stays pannable', () => {
        const f2 = computeFitFractions(16 / 9, 2000 / 960);
        const fs2 = fillScaleFrom(f2);
        // zoom 1.34 (the level in the user report)
        expect(maxPanPercent(1.34, f2.fw, fs2, true)).toBeGreaterThan(0); // width overflow → filled
        expect(maxPanPercent(1.34, f2.fh, fs2, true)).toBeGreaterThan(0); // top/bottom reachable
    });
});
