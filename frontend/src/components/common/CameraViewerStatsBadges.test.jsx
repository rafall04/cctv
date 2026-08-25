import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CameraViewerStatsBadges, { formatCompactCount, getCameraViewerStats } from './CameraViewerStatsBadges.jsx';

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

/*
 * The counters are sold from a public page, so their meaning has to be retrievable without
 * guessing. "views" was read as "orang yang melihat kamera ini"; it really means "pemutar dibuka
 * dan ditonton >= 5 detik", counted at session end — thumbnails never count. The screen text is
 * kept tiny for phones, so the full explanation lives in the accessible name — but the visible
 * word still has to say "tontonan" (a player ran), because `title` never opens on a touch screen
 * and this audience is ~70% phones. If these names are dropped or reworded away from the
 * 5-second rule, the misreading is back.
 */
describe('CameraViewerStatsBadges accessible names', () => {
    const camera = { viewer_stats: { live_viewers: 3, total_views: 12450 } };

    it('says what the lifetime counter counts, with the exact figure', () => {
        render(<CameraViewerStatsBadges camera={camera} />);
        const total = screen.getByRole('img', { name: /^Sudah ditonton 12\.450 kali\./ });

        // Compacted on screen, exact and explained in the name. The visible word is "tontonan",
        // not "views": `title` never opens on a phone, so the meaning must survive without it.
        expect(total.textContent).toBe('12.4k tontonan');
        expect(total.getAttribute('aria-label')).toContain('pemutar dibuka minimal 5 detik');
        expect(total.getAttribute('aria-label')).toContain('gambar pratinjau tidak dihitung');
        // Sighted mouse users get the same sentence, not a shorter one.
        expect(total.getAttribute('title')).toBe(total.getAttribute('aria-label'));
    });

    it('names the live counter as watching happening right now', () => {
        render(<CameraViewerStatsBadges camera={camera} />);
        const live = screen.getByRole('img', { name: '3 tontonan sedang berlangsung sekarang' });

        expect(live.textContent).toBe('3 live');
        expect(live.getAttribute('title')).toBe('3 tontonan sedang berlangsung sekarang');
    });

    it('still names both counters when a camera has no stats at all', () => {
        render(<CameraViewerStatsBadges camera={null} />);

        expect(screen.getByRole('img', { name: '0 tontonan sedang berlangsung sekarang' })).toBeTruthy();
        expect(screen.getByRole('img', { name: /^Sudah ditonton 0 kali\./ })).toBeTruthy();
    });

    it('keeps the name on the overlay tone used inside the video popup', () => {
        render(<CameraViewerStatsBadges camera={camera} tone="overlay" />);

        expect(screen.getByRole('img', { name: /^Sudah ditonton 12\.450 kali\./ })).toBeTruthy();
    });
});
