/**
 * Purpose: Verify the customer-facing share-text formatting — local timezone, an absolute range shown
 *          WITH its time, and rolling windows in friendly units.
 * Caller: Backend focused test gate for playback token sharing.
 * Deps: vitest, mocked timezoneService (fixed Asia/Jakarta).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/timezoneService.js', () => ({ getTimezone: () => 'Asia/Jakarta' }));

import { formatHoursHuman, formatLocalDateTime, formatShareDepth } from '../services/playbackShareFormat.js';

describe('playbackShareFormat', () => {
    it('formatHoursHuman renders the largest whole unit', () => {
        expect(formatHoursHuman(720)).toBe('1 bulan');
        expect(formatHoursHuman(168)).toBe('1 minggu');
        expect(formatHoursHuman(72)).toBe('3 hari');
        expect(formatHoursHuman(6)).toBe('6 jam');
        expect(formatHoursHuman(0)).toBe('');
    });

    it('formatLocalDateTime shows the stored UTC in local time, WITH the time', () => {
        // 16:05 UTC → 23:05 WIB
        const text = formatLocalDateTime('2026-09-05 16:05:00');
        expect(text).toMatch(/2026/);
        expect(text).toMatch(/23[.:]05/);
    });

    it('formatShareDepth: absolute range (with time) wins over window wins over all', () => {
        expect(formatShareDepth({ playback_from: '2026-08-26 02:10:00', playback_to: '2026-08-31 03:20:00' })).toMatch(/–/);
        expect(formatShareDepth({ playback_window_hours: 168 })).toBe('1 minggu terakhir');
        expect(formatShareDepth({})).toBe('Semua rekaman tersedia');
    });
});
