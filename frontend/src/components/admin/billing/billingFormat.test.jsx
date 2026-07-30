/*
 * Purpose: Prove billing dates are rendered in the operator's timezone, not printed as raw UTC.
 * Caller: Frontend test gate.
 * Deps: Vitest, billingFormat.
 * SideEffects: None.
 *
 * The bug: formatDateTime used to be `String(raw).replace('T',' ').slice(0,16)` — pure string
 * surgery, no timezone conversion at all. Backend rows come from SQLite CURRENT_TIMESTAMP, which is
 * UTC with no zone marker, so every payment and registration date in the billing tabs displayed 7
 * hours behind WIB. On a money surface that is not cosmetic: it misattributes a payment to the
 * wrong day whenever it lands between 00:00 and 07:00 WIB.
 */

import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRupiah } from './billingFormat';

describe('billingFormat.formatDateTime', () => {
    it('REGRESSION: converts a bare SQLite UTC timestamp into WIB, not printing it verbatim', () => {
        // 2026-07-29 11:49:32 UTC === 18:49 WIB the same day.
        const out = formatDateTime('2026-07-29 11:49:32');
        expect(out).toMatch(/18[.:]49/);
        expect(out, 'the raw UTC hour must not survive to the screen').not.toMatch(/11[.:]49/);
    });

    it('rolls the DATE forward when UTC and WIB fall on different days', () => {
        // 2026-07-29 20:30 UTC === 2026-07-30 03:30 WIB — the case that silently misfiled a payment.
        const out = formatDateTime('2026-07-29 20:30:00');
        expect(out).toMatch(/30/);
        expect(out).toMatch(/03[.:]30/);
    });

    it('honours an explicit timezone', () => {
        expect(formatDateTime('2026-07-29 11:49:32', 'UTC')).toMatch(/11[.:]49/);
    });

    it('accepts ISO input with an explicit Z', () => {
        expect(formatDateTime('2026-07-29T11:49:32.000Z')).toMatch(/18[.:]49/);
    });

    it('degrades safely on empty or unparseable input', () => {
        expect(formatDateTime(null)).toBe('—');
        expect(formatDateTime('')).toBe('—');
        expect(formatDateTime('bukan-tanggal')).toBe('bukan-tanggal');
    });

    it('leaves money formatting untouched', () => {
        expect(formatRupiah(10000)).toBe('Rp10.000');
    });
});
