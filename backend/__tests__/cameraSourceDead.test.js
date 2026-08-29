/**
 * Purpose: Pin the line between "offline right now" and "gone, only the provider can fix it".
 * Caller: Backend test gate.
 * Deps: vitest, real better-sqlite3 on a temp file.
 * MainFuncs: cameraSourceDeadPolicy streak rules + cameraSourceHealthService read model.
 * SideEffects: Creates and removes a throwaway SQLite file. Never touches the app database.
 *
 * The cases that matter most are the NEGATIVE ones. A guard that flags every blip is worse than no
 * guard: the panel becomes noise, people stop reading it, and the six genuinely dead feeds stay
 * invisible for exactly the same reason they were invisible before.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

let db;
let dbFile;

vi.mock('../database/connectionPool.js', () => ({
    execute: (sql, params = []) => db.prepare(sql).run(...params),
    queryOne: (sql, params = []) => db.prepare(sql).get(...params),
    query: (sql, params = []) => db.prepare(sql).all(...params),
}));

const policy = await import('../services/cameraSourceDeadPolicy.js');
const { default: sourceHealth } = await import('../services/cameraSourceHealthService.js');
const { default: settingsService } = await import('../services/settingsService.js');

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

describe('dead-at-source policy — which symptoms count', () => {
    it('counts a closed playlist and a vanished path', () => {
        expect(policy.isDeadAtSourceReason('stream_ended')).toBe(true);
        expect(policy.isDeadAtSourceReason('http_404')).toBe(true);
        expect(policy.isDeadAtSourceReason('http_410')).toBe(true);
    });

    /* A flapping link is loud but recoverable; calling it death would cry wolf on every blip. */
    it('ignores transient network faults', () => {
        for (const reason of ['ECONNREFUSED', 'ETIMEDOUT', 'http_500', 'http_502', 'request_error']) {
            expect(policy.isDeadAtSourceReason(reason)).toBe(false);
        }
    });

    /*
     * 403 is excluded deliberately: data.bojonegorokab.go.id answers 403 to any client without a
     * browser User-Agent, so on this fleet it means "we asked wrongly" far more often than "gone".
     */
    it('does NOT count 403, which on this fleet means a User-Agent problem', () => {
        expect(policy.isDeadAtSourceReason('http_403')).toBe(false);
    });
});

describe('dead-at-source policy — the streak', () => {
    const streak = (input) => policy.nextDeadStreak({ timestamp: '2026-08-02T12:00:00.000Z', ...input });

    it('starts the clock the first time the source is seen gone', () => {
        expect(streak({ isOnline: 0, reason: 'stream_ended', currentSince: null, currentReason: null }))
            .toEqual({ since: '2026-08-02T12:00:00.000Z', reason: 'stream_ended' });
    });

    /* Restarting the clock each tick would leave every camera permanently "dead for 30 seconds". */
    it('keeps the ORIGINAL start time while the same symptom holds', () => {
        const result = streak({
            isOnline: 0, reason: 'http_404',
            currentSince: hoursAgo(40), currentReason: 'http_404',
        });

        expect(result.since).toBe(hoursAgo(40));
    });

    it('restarts when the symptom changes, because that is a different story', () => {
        const result = streak({
            isOnline: 0, reason: 'stream_ended',
            currentSince: hoursAgo(40), currentReason: 'http_404',
        });

        expect(result).toEqual({ since: '2026-08-02T12:00:00.000Z', reason: 'stream_ended' });
    });

    it('clears the moment the camera is online again', () => {
        expect(streak({ isOnline: 1, reason: null, currentSince: hoursAgo(40), currentReason: 'http_404' }))
            .toEqual({ since: null, reason: null });
    });

    /* Flapping between two faults is not a source that cleanly went away. */
    it('clears when a transient fault interrupts the streak', () => {
        expect(streak({ isOnline: 0, reason: 'ETIMEDOUT', currentSince: hoursAgo(40), currentReason: 'http_404' }))
            .toEqual({ since: null, reason: null });
    });
});

describe('dead-at-source policy — confirmation window', () => {
    it('waits out the window before calling anything dead', () => {
        // Resolve the window once and use it for both the fixture and the assertion, so the test
        // holds whatever the effective confirm-hours is (setting / env / default).
        const confirmHours = policy.getConfirmAfterHours();
        expect(policy.isConfirmed(hoursAgo(1), NOW, confirmHours)).toBe(false);
        expect(policy.isConfirmed(hoursAgo(confirmHours), NOW, confirmHours)).toBe(true);
    });

    it('reports whole hours, and nothing at all without a streak', () => {
        expect(policy.deadHours(hoursAgo(49), NOW)).toBe(49);
        expect(policy.deadHours(null, NOW)).toBeNull();
    });

    it('confirm window follows the admin setting, then env, then the 6h default', () => {
        const spy = vi.spyOn(settingsService, 'getSettingValue');
        const previous = process.env.CAMERA_SOURCE_DEAD_CONFIRM_HOURS;
        try {
            // Setting present -> it wins (even over env).
            process.env.CAMERA_SOURCE_DEAD_CONFIRM_HOURS = '10';
            spy.mockReturnValue(3);
            expect(policy.getConfirmAfterHours()).toBe(3);

            // Setting absent -> env.
            spy.mockReturnValue(undefined);
            expect(policy.getConfirmAfterHours()).toBe(10);

            // Neither -> default 6. A zero/negative setting is ignored, not obeyed.
            delete process.env.CAMERA_SOURCE_DEAD_CONFIRM_HOURS;
            spy.mockReturnValue(0);
            expect(policy.getConfirmAfterHours()).toBe(6);
        } finally {
            spy.mockRestore();
            if (previous === undefined) delete process.env.CAMERA_SOURCE_DEAD_CONFIRM_HOURS;
            else process.env.CAMERA_SOURCE_DEAD_CONFIRM_HOURS = previous;
        }
    });
});

describe('dead-source read model', () => {
    beforeEach(() => {
        dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'srcdead-')), 'test.db');
        db = new Database(dbFile);
        db.exec(`
            CREATE TABLE areas (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE cameras (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                camera_class TEXT NOT NULL DEFAULT 'community',
                area_id INTEGER
            );
            CREATE TABLE camera_runtime_state (
                camera_id INTEGER PRIMARY KEY,
                monitoring_reason TEXT,
                source_dead_since TEXT,
                source_dead_reason TEXT
            );
        `);
        db.prepare('INSERT INTO areas (id, name) VALUES (3, ?)').run('KEC BOJONEGORO');
    });

    afterEach(() => {
        db.close();
        fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
    });

    const addCamera = (id, name, { enabled = 1 } = {}) =>
        db.prepare('INSERT INTO cameras (id, name, enabled, area_id) VALUES (?, ?, ?, 3)').run(id, name, enabled);
    const addStreak = (cameraId, since, reason) =>
        db.prepare(
            'INSERT INTO camera_runtime_state (camera_id, source_dead_since, source_dead_reason) VALUES (?, ?, ?)'
        ).run(cameraId, since, reason);

    it('lists only streaks that have outlasted the confirmation window', () => {
        addCamera(25, 'JEMBATAN A');
        addCamera(37, 'ALUN-ALUN');
        addStreak(25, hoursAgo(49), 'http_404');
        addStreak(37, hoursAgo(1), 'stream_ended');

        const result = sourceHealth.getDeadSources({ now: NOW });

        expect(result.cameras.map((c) => c.id)).toEqual([25]);
        expect(result.cameras[0].hours).toBe(49);
        expect(result.cameras[0].areaName).toBe('KEC BOJONEGORO');
        expect(result.cameras[0].explanation).toMatch(/404/);
    });

    /*
     * A dead camera the operator already disabled is RESOLVED. Counting it forever would keep the
     * badge lit and teach people to ignore it — the exact failure this panel is meant to fix.
     */
    it('counts only the still-enabled ones as needing action', () => {
        addCamera(25, 'JEMBATAN A');
        addCamera(27, 'SUDAH DIMATIKAN', { enabled: 0 });
        addStreak(25, hoursAgo(49), 'http_404');
        addStreak(27, hoursAgo(49), 'http_404');

        const result = sourceHealth.getDeadSources({ now: NOW });

        expect(result.total).toBe(2);
        expect(result.stillPublic).toBe(1);
    });

    it('reports nothing rather than failing when the migration has not run', () => {
        db.exec('DROP TABLE camera_runtime_state');

        expect(sourceHealth.getDeadSources({ now: NOW })).toMatchObject({ cameras: [], total: 0 });
    });
});
