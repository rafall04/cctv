/**
 * Purpose: The billing day-label must follow the PINNED billing timezone, never the mutable display
 *          timezone — so an admin toggling the display tz (WIB↔WITA↔WIT) cannot shift the billing day
 *          boundary and double-charge a subscription across it (#12).
 * Caller: backend test gate.
 * Deps: vitest; timezoneService mocked so display tz and billing tz can be made to DIFFER.
 * SideEffects: none.
 */
import { describe, expect, it, vi } from 'vitest';

// Display tz and billing tz are DIFFERENT here on purpose: the billing day MUST follow the billing tz.
vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jayapura',        // display = WIT (UTC+9) — imagine the admin just set this
    getBillingTimezone: () => 'Asia/Jakarta',  // billing pinned = WIB (UTC+7), unmoved by the toggle
}));

const { localDateString } = await import('../services/billingCalc.js');

describe('billing day is pinned to the billing timezone, not the display timezone (#12)', () => {
    it('localDateString follows the BILLING tz even when the display tz would give another date', () => {
        // 2026-08-29 16:30 UTC = 23:30 WIB (still the 29th) but 01:30 WIT the next day (the 30th).
        // Pinned to WIB → the billing day is the 29th. If it wrongly used the display WIT it'd be the 30th.
        const at = new Date('2026-08-29T16:30:00.000Z');
        expect(localDateString(at)).toBe('2026-08-29');
    });

    it('the same instant would land on a DIFFERENT day under the display tz — proving which one is used', () => {
        // Sanity anchor: 01:30 WIT on 2026-08-30 is the display-tz answer we are deliberately NOT taking.
        const at = new Date('2026-08-29T16:30:00.000Z');
        const wibDay = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        const witDay = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Jayapura' });
        expect(wibDay).toBe('2026-08-29');
        expect(witDay).toBe('2026-08-30');
        expect(localDateString(at)).toBe(wibDay); // billing tz, not display tz
    });
});
