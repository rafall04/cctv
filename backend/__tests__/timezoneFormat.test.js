/**
 * Purpose: Bare SQLite CURRENT_TIMESTAMP values ('YYYY-MM-DD HH:MM:SS') are UTC — formatDateTime
 *          must parse them as UTC, not server-local. On a WIB server the naive new Date() read put
 *          every audit-log line 7 hours early on the admin dashboard.
 * Caller: backend test gate.
 * Deps: vitest; connectionPool mocked.
 * SideEffects: none.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../database/connectionPool.js', () => ({
    queryOne: () => null, // no timezone setting -> getTimezone() falls back to Asia/Jakarta
    execute: vi.fn(),
}));

const { formatDateTime, parseStoredTimestamp } = await import('../services/timezoneService.js');

describe('parseStoredTimestamp', () => {
    it('reads bare SQLite datetimes as UTC, regardless of the server OS zone', () => {
        // The prod incident: stored 06:01:05 UTC was displayed as "06:01 WIB" — the real login
        // happened at 13:01 WIB.
        expect(parseStoredTimestamp('2026-09-21 06:01:05').toISOString()).toBe('2026-09-21T06:01:05.000Z');
    });

    it('passes ISO strings with a zone through unchanged', () => {
        expect(parseStoredTimestamp('2026-09-21T06:01:05.000Z').toISOString()).toBe('2026-09-21T06:01:05.000Z');
        expect(parseStoredTimestamp('2026-09-21T06:01:05+00:00').toISOString()).toBe('2026-09-21T06:01:05.000Z');
    });

    it('passes Date objects through unchanged', () => {
        const d = new Date('2026-09-21T06:01:05.000Z');
        expect(parseStoredTimestamp(d).getTime()).toBe(d.getTime());
    });
});

describe('formatDateTime', () => {
    it('renders a bare UTC timestamp in the configured zone — not the raw UTC digits', () => {
        const out = formatDateTime('2026-09-21 06:01:05', 'Asia/Jakarta');
        expect(out).toMatch(/13[:.]01/); // 06:01 UTC -> 13:01 WIB
        expect(out).not.toMatch(/06[:.]01/);
    });

    it('renders the same instant identically whether the input is bare-UTC or ISO-Z', () => {
        const bare = formatDateTime('2026-09-21 06:01:05', 'Asia/Jakarta');
        const iso = formatDateTime('2026-09-21T06:01:05.000Z', 'Asia/Jakarta');
        expect(bare).toBe(iso);
    });

    it('honours non-default configured zones', () => {
        const out = formatDateTime('2026-09-21 06:01:05', 'Asia/Jayapura');
        expect(out).toMatch(/15[:.]01/); // WIT = UTC+9
    });
});
