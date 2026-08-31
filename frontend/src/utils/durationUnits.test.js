import { describe, expect, it } from 'vitest';
import { friendlyToHours, hoursToFriendly, formatHoursHuman, snapTo10Min } from './durationUnits.js';

describe('durationUnits.snapTo10Min', () => {
    it('floors the minute to the nearest 10 (segments are 10-min)', () => {
        expect(snapTo10Min('2026-08-31T08:08')).toBe('2026-08-31T08:00');
        expect(snapTo10Min('2026-08-31T10:15')).toBe('2026-08-31T10:10');
        expect(snapTo10Min('2026-08-31T10:20')).toBe('2026-08-31T10:20');
        expect(snapTo10Min('2026-08-31T23:59')).toBe('2026-08-31T23:50');
    });
    it('passes through empty / non-datetime values', () => {
        expect(snapTo10Min('')).toBe('');
        expect(snapTo10Min(null)).toBe(null);
        expect(snapTo10Min('bukan-tanggal')).toBe('bukan-tanggal');
    });
});

describe('durationUnits.friendlyToHours', () => {
    it('converts value+unit to whole hours', () => {
        expect(friendlyToHours(7, 'day')).toBe(168);
        expect(friendlyToHours(1, 'week')).toBe(168);
        expect(friendlyToHours(1, 'month')).toBe(720);
        expect(friendlyToHours(6, 'hour')).toBe(6);
    });
    it('returns null for empty/invalid/≤0 (= inherit/unlimited)', () => {
        expect(friendlyToHours('', 'day')).toBeNull();
        expect(friendlyToHours(0, 'hour')).toBeNull();
        expect(friendlyToHours(-3, 'day')).toBeNull();
        expect(friendlyToHours('abc', 'day')).toBeNull();
    });
});

describe('durationUnits.hoursToFriendly', () => {
    it('picks the largest unit that divides evenly', () => {
        expect(hoursToFriendly(168)).toEqual({ value: 1, unit: 'week' });
        expect(hoursToFriendly(720)).toEqual({ value: 1, unit: 'month' });
        expect(hoursToFriendly(72)).toEqual({ value: 3, unit: 'day' });
        expect(hoursToFriendly(6)).toEqual({ value: 6, unit: 'hour' });
    });
    it('round-trips through friendlyToHours', () => {
        for (const h of [1, 6, 24, 72, 168, 720]) {
            const { value, unit } = hoursToFriendly(h);
            expect(friendlyToHours(value, unit)).toBe(h);
        }
    });
    it('empty/invalid → blank value defaulting to days', () => {
        expect(hoursToFriendly(null)).toEqual({ value: '', unit: 'day' });
        expect(hoursToFriendly(0)).toEqual({ value: '', unit: 'day' });
    });
});

describe('durationUnits.formatHoursHuman', () => {
    it('renders a friendly label', () => {
        expect(formatHoursHuman(72)).toBe('3 hari');
        expect(formatHoursHuman(168)).toBe('1 minggu');
        expect(formatHoursHuman(720)).toBe('1 bulan');
        expect(formatHoursHuman(5)).toBe('5 jam');
    });
    it('empty for no window', () => {
        expect(formatHoursHuman(null)).toBe('');
        expect(formatHoursHuman(0)).toBe('');
    });
});
