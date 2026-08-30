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

const { getBillingTimezone } = await import('../services/timezoneService.js');

beforeEach(() => { ROWS = {}; });

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
