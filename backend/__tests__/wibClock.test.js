import { describe, it, expect } from 'vitest';
import { wibNowMinutes, hhmmToMinutes, isWithinWindow, isAreaQuietNow } from '../utils/wibClock.js';

describe('wibClock', () => {
    it('wibNowMinutes shifts UTC by +7h', () => {
        // 2026-01-01T00:00:00Z -> 07:00 WIB -> 420 min
        expect(wibNowMinutes(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(420);
        // 2026-01-01T18:30:00Z -> 01:30 WIB next day -> 90 min
        expect(wibNowMinutes(Date.UTC(2026, 0, 1, 18, 30, 0))).toBe(90);
    });

    it('hhmmToMinutes parses valid, rejects malformed', () => {
        expect(hhmmToMinutes('07:00')).toBe(420);
        expect(hhmmToMinutes('23:59')).toBe(1439);
        expect(hhmmToMinutes('25:00')).toBeNull();
        expect(hhmmToMinutes('7:5')).toBeNull();
        expect(hhmmToMinutes('')).toBeNull();
        expect(hhmmToMinutes(null)).toBeNull();
    });

    it('isWithinWindow handles same-day windows', () => {
        expect(isWithinWindow(22 * 60 + 30, 22 * 60, 23 * 60)).toBe(true);
        expect(isWithinWindow(21 * 60, 22 * 60, 23 * 60)).toBe(false);
        expect(isWithinWindow(23 * 60, 22 * 60, 23 * 60)).toBe(false); // half-open [start,end)
    });

    it('isWithinWindow handles windows crossing midnight', () => {
        expect(isWithinWindow(2 * 60, 22 * 60, 5 * 60)).toBe(true);   // 02:00 inside 22:00–05:00
        expect(isWithinWindow(23 * 60, 22 * 60, 5 * 60)).toBe(true);  // 23:00 inside
        expect(isWithinWindow(12 * 60, 22 * 60, 5 * 60)).toBe(false); // noon outside
        expect(isWithinWindow(5 * 60, 22 * 60, 5 * 60)).toBe(false);  // exclusive end
    });

    it('empty / null windows are never inside', () => {
        expect(isWithinWindow(300, 300, 300)).toBe(false);
        expect(isWithinWindow(300, null, 300)).toBe(false);
    });

    it('isAreaQuietNow uses the area HH:MM bounds', () => {
        // 2026-01-01T20:00:00Z -> 03:00 WIB, inside 22:00–05:00
        const at0300 = Date.UTC(2026, 0, 1, 20, 0, 0);
        expect(isAreaQuietNow({ quiet_start: '22:00', quiet_end: '05:00' }, at0300)).toBe(true);
        // 2026-01-01T05:00:00Z -> 12:00 WIB, outside
        const at1200 = Date.UTC(2026, 0, 1, 5, 0, 0);
        expect(isAreaQuietNow({ quiet_start: '22:00', quiet_end: '05:00' }, at1200)).toBe(false);
        expect(isAreaQuietNow({ quiet_start: null, quiet_end: null }, at0300)).toBe(false);
    });
});
