/**
 * Purpose: Pin viewer analytics RESULTS against a real SQLite database, so the SQL underneath can be rewritten safely.
 * Caller: Vitest backend suite.
 * Deps: better-sqlite3 (in-memory), services/viewerAnalyticsService with connectionPool + timezone mocked.
 * MainFuncs: getAnalytics.
 * SideEffects: None; every row lives in an in-memory database.
 *
 * WHY BEHAVIOUR AND NOT SQL TEXT
 * ------------------------------
 * This service was flagged for interpolating dates straight into its SQL, and the fix was
 * deferred with the note "these analytics services have no tests to verify a rewrite".
 * A test that asserted the SQL string would be worse than useless here: the rewrite CHANGES
 * the SQL by design, so such a test would fail for the right change and pass for a wrong
 * one. What has to stay identical is the numbers the service returns. So the tests below
 * run real queries against a real database with known rows, and the parameterisation is
 * proven correct by the answers not moving.
 */
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: SQLite } = await import('better-sqlite3');
    return { db: new SQLite(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

// Fixed timezone so "today" is deterministic wherever the suite runs.
vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

const dayOffset = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
};

let service;

beforeAll(async () => {
    db.exec(`
        CREATE TABLE viewer_session_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            camera_name TEXT,
            ip_address TEXT NOT NULL,
            user_agent TEXT,
            device_type TEXT,
            started_at DATETIME NOT NULL,
            ended_at DATETIME NOT NULL,
            duration_seconds INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const insert = db.prepare(`
        INSERT INTO viewer_session_history
            (camera_id, camera_name, ip_address, device_type, started_at, ended_at, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // A deliberately lopsided fixture: the counts per period must be distinguishable, so a
    // filter that silently matched "everything" or "nothing" cannot pass by coincidence.
    const rows = [
        // today: 3 sessions, 2 distinct visitors, 2 cameras
        [1, 'Cam A', '10.0.0.1', 'mobile', `${dayOffset(0)} 08:00:00`, `${dayOffset(0)} 08:05:00`, 300],
        [1, 'Cam A', '10.0.0.2', 'desktop', `${dayOffset(0)} 09:00:00`, `${dayOffset(0)} 09:00:05`, 5],
        [2, 'Cam B', '10.0.0.1', 'mobile', `${dayOffset(0)} 10:00:00`, `${dayOffset(0)} 10:02:00`, 120],
        // yesterday: 2 sessions, 1 visitor
        [1, 'Cam A', '10.0.0.3', 'desktop', `${dayOffset(-1)} 11:00:00`, `${dayOffset(-1)} 11:10:00`, 600],
        [1, 'Cam A', '10.0.0.3', 'desktop', `${dayOffset(-1)} 12:00:00`, `${dayOffset(-1)} 12:01:00`, 60],
        // 5 days ago: inside 7days, outside today/yesterday
        [3, 'Cam C', '10.0.0.4', 'tablet', `${dayOffset(-5)} 13:00:00`, `${dayOffset(-5)} 13:30:00`, 1800],
        // 20 days ago: inside 30days only
        [3, 'Cam C', '10.0.0.5', 'mobile', `${dayOffset(-20)} 14:00:00`, `${dayOffset(-20)} 14:15:00`, 900],
        // 100 days ago: only 'all' reaches it
        [4, 'Cam D', '10.0.0.6', 'desktop', `${dayOffset(-100)} 15:00:00`, `${dayOffset(-100)} 15:00:30`, 30],
    ];
    for (const r of rows) insert.run(...r);

    service = (await import('../services/viewerAnalyticsService.js')).default;
});

describe('viewerAnalyticsService.getAnalytics — period filtering', () => {
    it.each([
        ['today', 3, 2],
        ['yesterday', 2, 1],
        ['7days', 6, 4],
        ['30days', 7, 5],
        ['all', 8, 6],
    ])('period %s returns %i sessions from %i unique visitors', (period, sessions, visitors) => {
        const result = service.getAnalytics(period);
        expect(result.overview.totalSessions).toBe(sessions);
        expect(result.overview.uniqueVisitors).toBe(visitors);
    });

    it('an explicit date: period selects exactly that day', () => {
        const result = service.getAnalytics(`date:${dayOffset(-1)}`);
        expect(result.overview.totalSessions).toBe(2);
        expect(result.overview.uniqueVisitors).toBe(1);
    });

    it('a malformed date: period falls back to the 7-day window', () => {
        const result = service.getAnalytics('date:not-a-date');
        expect(result.overview.totalSessions).toBe(6);
    });

    /*
     * REGRESSION, found by running this service against production data.
     *
     * `2026-13-99` passes the shape check — four digits, two, two — but is not a date.
     * `new Date()` returned Invalid Date and `toISOString()` threw RangeError, which
     * getAnalytics' own catch swallowed: the admin got a completely empty dashboard, with
     * nothing but a stack trace in the log to explain it. A date the calendar does not have
     * must degrade to the same 7-day fallback as any other unusable input.
     */
    it.each(['date:2026-13-99', 'date:2026-02-30', 'date:0000-00-00'])(
        '%s is calendar-invalid and falls back instead of blanking the dashboard',
        (period) => {
            const result = service.getAnalytics(period);
            expect(result.overview.totalSessions).toBe(6);
        }
    );

    it('aggregates watch time and session extremes for the window', () => {
        const result = service.getAnalytics('today');
        expect(result.overview.totalWatchTime).toBe(425);
        expect(result.overview.longestSession).toBe(300);
        expect(result.overview.avgSessionDuration).toBe(142);
    });

    it('compares against the preceding window', () => {
        const result = service.getAnalytics('today');
        expect(result.comparison.previous.totalSessions).toBe(2);
        expect(result.comparison.previous.uniqueVisitors).toBe(1);
    });

    it('breaks down devices over the filtered window only', () => {
        const result = service.getAnalytics('today');
        const byType = Object.fromEntries(result.deviceBreakdown.map((d) => [d.device_type ?? d.deviceType, d.count]));
        expect(byType.mobile).toBe(2);
        expect(byType.desktop).toBe(1);
        expect(byType.tablet).toBeUndefined();
    });

    it('ranks cameras within the window', () => {
        const result = service.getAnalytics('today');
        expect(result.topCameras[0].camera_id ?? result.topCameras[0].cameraId).toBe(1);
        expect(result.topCameras).toHaveLength(2);
    });

    it('counts a sub-10s view as a bounce', () => {
        const result = service.getAnalytics('today');
        expect(result.retention.bouncedVisitors).toBeGreaterThanOrEqual(1);
    });
});

describe('viewerAnalyticsService — dates never reach SQL as literals', () => {
    /*
     * The structural half of the fix. Behaviour tests above prove the rewrite is faithful;
     * this proves it is actually a rewrite — that no date is being pasted into the SQL text
     * any more. Reading the module source is the only way to see that, because a correct
     * result can be produced either way.
     */
    it('the module contains no quoted date interpolation', async () => {
        const { readFileSync } = await import('fs');
        const src = readFileSync(new URL('../services/viewerAnalyticsService.js', import.meta.url), 'utf8');

        // e.g. `date(started_at) = '${x}'` — a value pasted between single quotes.
        expect(src).not.toMatch(/'\$\{/);
        expect(src).toContain('?');
    });
});
