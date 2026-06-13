import { describe, it, expect } from 'vitest';
import { formatCompactCount, getCameraViewerStats } from './CameraViewerStatsBadges.jsx';

describe('formatCompactCount', () => {
    it('truncates instead of rounding up so it never overstates view counts', () => {
        // The reported bug: 1170 real views must not read as "1.2k" (implies 1200+).
        expect(formatCompactCount(1170)).toBe('1.1k');
        expect(formatCompactCount(1199)).toBe('1.1k');
        expect(formatCompactCount(1990)).toBe('1.9k');
    });

    it('keeps exact tenth boundaries correct (no float drift)', () => {
        expect(formatCompactCount(1200)).toBe('1.2k');
        expect(formatCompactCount(1000)).toBe('1k');
        expect(formatCompactCount(21500)).toBe('21.5k');
    });

    it('shows raw integers below 1000', () => {
        expect(formatCompactCount(0)).toBe('0');
        expect(formatCompactCount(1)).toBe('1');
        expect(formatCompactCount(999)).toBe('999');
    });

    it('drops the decimal once the value is >= 100 of a scale and truncates', () => {
        // Old Math.round code rounded 156789 up to "157k".
        expect(formatCompactCount(156789)).toBe('156k');
        // Old code produced the malformed "1000k"; truncation keeps it as "999k".
        expect(formatCompactCount(999999)).toBe('999k');
    });

    it('handles millions with the same truncation rule', () => {
        expect(formatCompactCount(1170000)).toBe('1.1m');
        expect(formatCompactCount(1500000)).toBe('1.5m');
        expect(formatCompactCount(15000000)).toBe('15m');
    });

    it('coerces invalid input to "0"', () => {
        expect(formatCompactCount(undefined)).toBe('0');
        expect(formatCompactCount(null)).toBe('0');
        expect(formatCompactCount(-5)).toBe('0');
        expect(formatCompactCount('abc')).toBe('0');
    });

    it('parses numeric strings', () => {
        expect(formatCompactCount('1170')).toBe('1.1k');
    });
});

describe('getCameraViewerStats', () => {
    it('reads viewer_stats safely with fallbacks', () => {
        expect(getCameraViewerStats({ viewer_stats: { live_viewers: 4, total_views: 1170 } }))
            .toEqual({ liveViewers: 4, totalViews: 1170 });
        expect(getCameraViewerStats({})).toEqual({ liveViewers: 0, totalViews: 0 });
        expect(getCameraViewerStats(null)).toEqual({ liveViewers: 0, totalViews: 0 });
    });
});
