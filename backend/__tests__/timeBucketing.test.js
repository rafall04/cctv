/**
 * Purpose: Prove the SQLite-level semantics the analytics rely on after the UTC-storage switch — a
 *          UTC-stored timestamp, shifted by the tz-offset modifier, buckets into the operator's
 *          configured-tz day/hour (not the raw UTC one). This is the guarantee behind
 *          `date(started_at, ?)` / `strftime('%H', started_at, ?)` in viewer/playback analytics.
 * Caller: Backend Vitest suite.
 * Deps: better-sqlite3 (in-memory), timeService.getSqliteTzOffsetModifier.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

import { getSqliteTzOffsetModifier } from '../services/timeService.js';

let db;
beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE viewer_session_history (started_at TEXT)');
});
afterEach(() => db.close());

describe('UTC storage + tz-offset bucketing', () => {
    it('buckets a late-evening UTC row into the NEXT configured-tz day (the 00:00–07:00 WIB trap)', () => {
        // 2026-05-05 20:00:00 UTC == 2026-05-06 03:00:00 in Asia/Jakarta (+7).
        db.prepare('INSERT INTO viewer_session_history VALUES (?)').run('2026-05-05 20:00:00');
        const mod = getSqliteTzOffsetModifier(); // '+420 minutes'
        expect(mod).toBe('+420 minutes');

        const shifted = db.prepare(
            "SELECT date(started_at, ?) AS d, strftime('%H', started_at, ?) AS h, strftime('%w', started_at, ?) AS w FROM viewer_session_history"
        ).get(mod, mod, mod);
        expect(shifted.d).toBe('2026-05-06'); // Wednesday in WIB, not Tuesday
        expect(shifted.h).toBe('03');
        expect(shifted.w).toBe('3');

        // Proof the shift is load-bearing: unshifted, it would fall in the UTC day/hour.
        const raw = db.prepare(
            "SELECT date(started_at) AS d, strftime('%H', started_at) AS h FROM viewer_session_history"
        ).get();
        expect(raw.d).toBe('2026-05-05');
        expect(raw.h).toBe('20');
    });

    it('a "today = 2026-05-06 (WIB)" filter matches that same UTC row', () => {
        db.prepare('INSERT INTO viewer_session_history VALUES (?)').run('2026-05-05 20:00:00');
        const mod = getSqliteTzOffsetModifier();
        const hit = db.prepare(
            'SELECT COUNT(*) AS n FROM viewer_session_history WHERE date(started_at, ?) = ?'
        ).get(mod, '2026-05-06');
        expect(hit.n).toBe(1);
        // And it does NOT leak into the UTC day.
        const miss = db.prepare(
            'SELECT COUNT(*) AS n FROM viewer_session_history WHERE date(started_at, ?) = ?'
        ).get(mod, '2026-05-05');
        expect(miss.n).toBe(0);
    });

    it('migration shift (-420m) then UTC display in tz reproduces the ORIGINAL WIB wall-clock', () => {
        // A legacy row was stored in WIB wall-clock; the migration shifts it to UTC.
        const legacyWib = '2026-05-06 03:00:00';
        db.prepare('INSERT INTO viewer_session_history VALUES (?)').run(legacyWib);
        const shifted = db.prepare(
            "UPDATE viewer_session_history SET started_at = datetime(started_at, '-420 minutes')"
        );
        shifted.run();
        const utc = db.prepare('SELECT started_at FROM viewer_session_history').get().started_at;
        expect(utc).toBe('2026-05-05 20:00:00'); // now canonical UTC

        // Display path: parse the bare value as UTC, render it back in the configured tz.
        const rendered = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).format(new Date(`${utc.replace(' ', 'T')}Z`));
        // en-CA renders "2026-05-06, 03:00:00" — the original wall-clock, intact.
        expect(rendered.replace(',', '')).toBe('2026-05-06 03:00:00');
    });
});
