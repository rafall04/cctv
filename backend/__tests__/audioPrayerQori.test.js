/*
 * Purpose: Lock the qori (pre-adzan murottal) lead-time math — the pure "HH:MM minus N minutes" used to
 *   schedule the recitation before each adzan. A regression here would start the qori at the wrong minute.
 * Caller: Backend Vitest suite (node env).
 * Deps: connectionPool mocked so importing audioPrayerService never opens the real DB.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../database/connectionPool.js', () => ({
    query: vi.fn(() => []), queryOne: vi.fn(() => null), execute: vi.fn(() => ({ lastInsertRowid: 1 })),
}));

const { minutesBefore } = await import('../services/audioPrayerService.js');

describe('minutesBefore — qori lead-time math', () => {
    it('subtracts minutes within the hour', () => {
        expect(minutesBefore('17:32', 15)).toBe('17:17');
        expect(minutesBefore('04:13', 20)).toBe('03:53');
    });
    it('crosses an hour boundary', () => {
        expect(minutesBefore('05:05', 10)).toBe('04:55');
        expect(minutesBefore('11:32', 45)).toBe('10:47');
    });
    it('wraps around midnight (defensive; leads are small in practice)', () => {
        expect(minutesBefore('00:05', 10)).toBe('23:55');
    });
    it('lead 0 returns the same time', () => {
        expect(minutesBefore('11:32', 0)).toBe('11:32');
    });
    it('returns null for a malformed time', () => {
        expect(minutesBefore('', 10)).toBeNull();
        expect(minutesBefore('7:5', 10)).toBeNull();
        expect(minutesBefore(null, 10)).toBeNull();
    });
});
