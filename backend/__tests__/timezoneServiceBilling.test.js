/**
 * Purpose: getBillingTimezone reads the PINNED 'billing_timezone' setting and ignores changes to the
 *          display 'timezone' — the mechanism that keeps billing days stable across a display-tz toggle (#12).
 * Caller: backend test gate.
 * Deps: vitest; connectionPool mocked.
 * SideEffects: none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let ROWS = {};
vi.mock('../database/connectionPool.js', () => ({
    queryOne: (sql, params = []) => ROWS[params[0]],
    execute: vi.fn(),
}));

const { getBillingTimezone, isValidTimezone } = await import('../services/timezoneService.js');

beforeEach(() => { ROWS = {}; });

describe('isValidTimezone (any IANA zone — not locked to Indonesia)', () => {
    it('accepts the WIB/WITA/WIT aliases', () => {
        expect(isValidTimezone('WIB')).toBe(true);
        expect(isValidTimezone('WITA')).toBe(true);
        expect(isValidTimezone('WIT')).toBe(true);
    });

    it('accepts a real IANA zone from ANY region', () => {
        for (const tz of ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'America/New_York', 'Europe/London', 'Australia/Sydney', 'UTC']) {
            expect(isValidTimezone(tz)).toBe(true);
        }
    });

    it('rejects empty / garbage / non-zones', () => {
        for (const bad of ['', null, undefined, 'Not/AZone', 'WIByes', 123, 'Asia/Nowhere']) {
            expect(isValidTimezone(bad)).toBe(false);
        }
    });
});

describe('getBillingTimezone (#12 billing-tz pin)', () => {
    it('returns the pinned billing_timezone even when the display timezone differs', () => {
        ROWS = {
            billing_timezone: { setting_value: 'Asia/Makassar' }, // pinned WITA
            timezone: { setting_value: 'Asia/Jayapura' },         // display flipped to WIT
        };
        expect(getBillingTimezone()).toBe('Asia/Makassar'); // pin wins, NOT the display tz
    });

    it('falls back to the display timezone until the pin is seeded', () => {
        ROWS = { timezone: { setting_value: 'Asia/Jayapura' } }; // no billing_timezone yet
        expect(getBillingTimezone()).toBe('Asia/Jayapura');
    });

    it('falls back to Asia/Jakarta when neither setting exists', () => {
        ROWS = {};
        expect(getBillingTimezone()).toBe('Asia/Jakarta');
    });
});
