/**
 * Purpose: Lock the Audio Broadcast scheduler's firing rules — WIB time match, once-per-minute guard,
 *   weekday mask, and enabled flag — plus schedule CRUD validation.
 * Caller: Backend test gate (vitest, node env).
 * Deps: better-sqlite3 in-memory with the real audio_schedules schema; audioCastService mocked so no
 *   python is spawned; nowMs is injected so "now" is deterministic (prod Node is UTC, times are WIB).
 *
 * WHY: the scheduler is the headline of the feature and its correctness is pure time arithmetic
 * (WIB = UTC+7, weekday bitmask, a minute-key guard against double-firing). A regression here would
 * play audio at the wrong time or twice — invisible in a quick manual check, obvious to a village.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => {
    const Db = require('better-sqlite3');
    return { db: new Db(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (fn) => db.transaction(fn),
}));

// Mock the pusher so runDueSchedules never spawns python; capture its calls instead.
const { playToCameras } = vi.hoisted(() => ({ playToCameras: vi.fn(() => Promise.resolve({ results: [{ ok: true }] })) }));
vi.mock('../services/audioCastService.js', () => ({ playToCameras }));

const {
    createSchedule, updateSchedule, deleteSchedule, setEnabled, listSchedules, runDueSchedules,
} = await import('../services/audioScheduleService.js');

// 2026-09-08 10:30:00 UTC -> 17:30 WIB, a Tuesday (weekday bit 1<<2 = 4).
const TUE_1730_WIB = Date.parse('2026-09-08T10:30:00Z');

function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS audio_schedules;
        DROP TABLE IF EXISTS audio_playlists;
        DROP TABLE IF EXISTS audio_clips;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS areas;
        CREATE TABLE audio_clips (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_filename TEXT UNIQUE, duration_sec REAL DEFAULT 0, source_bytes INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE audio_playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE audio_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, camera_ids TEXT NOT NULL DEFAULT '[]',
            source_type TEXT NOT NULL, source_id INTEGER NOT NULL, time_hhmm TEXT NOT NULL,
            days_mask INTEGER NOT NULL DEFAULT 127, loop_count INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, created_at TEXT DEFAULT (datetime('now')),
            schedule_kind TEXT NOT NULL DEFAULT 'recurring', run_date TEXT, start_date TEXT, end_date TEXT,
            gain_db INTEGER NOT NULL DEFAULT 0);
        -- cameras + areas exist so quietTargets (the scheduler's quiet-hours gate) can run; empty by default
        -- so the existing firing tests see no quiet cameras and fire the full [1,2] set.
        CREATE TABLE areas (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, audio_broadcast_enabled INTEGER DEFAULT 0, quiet_start TEXT, quiet_end TEXT, max_loop INTEGER);
        CREATE TABLE cameras (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, area_id INTEGER);
    `);
    db.prepare("INSERT INTO audio_clips (name, base_filename) VALUES ('Clip', 'clip-aaaaaaaa')").run();
}

const baseFields = {
    name: 'Pengumuman', sourceType: 'clip', sourceId: 1, cameraIds: [1, 2],
    timeHHmm: '17:30', daysMask: 127, loopCount: 1,
};

beforeEach(() => {
    resetSchema();
    playToCameras.mockClear();
});

describe('audioScheduleService — CRUD validation', () => {
    it('rejects a bad time', () => {
        expect(() => createSchedule({ ...baseFields, timeHHmm: '25:00' })).toThrow(/jam/i);
    });
    it('rejects empty cameras', () => {
        expect(() => createSchedule({ ...baseFields, cameraIds: [] })).toThrow(/kamera/i);
    });
    it('rejects a bad source type', () => {
        expect(() => createSchedule({ ...baseFields, sourceType: 'song' })).toThrow(/clip|playlist/i);
    });
    it('stores camera_ids as JSON and lists them back as an array', () => {
        createSchedule(baseFields);
        const list = listSchedules();
        expect(list).toHaveLength(1);
        expect(list[0].camera_ids).toEqual([1, 2]);
        expect(list[0].source_name).toBe('Clip'); // joined from audio_clips
    });
    it('clamps loop_count into 1..20', () => {
        const a = createSchedule({ ...baseFields, loopCount: 999 });
        expect(a.loop_count).toBe(20);
        const b = createSchedule({ ...baseFields, loopCount: 0 });
        expect(b.loop_count).toBe(1);
    });
});

describe('audioScheduleService — runDueSchedules firing rules', () => {
    it('fires a schedule due this WIB minute with the right args', () => {
        createSchedule(baseFields);
        const fired = runDueSchedules(TUE_1730_WIB);
        expect(fired).toBe(1);
        expect(playToCameras).toHaveBeenCalledTimes(1);
        expect(playToCameras).toHaveBeenCalledWith([1, 2], 'clip', 1, 1, { gainDb: 0 });
    });

    it('does NOT fire twice in the same minute (last_run guard)', () => {
        createSchedule(baseFields);
        runDueSchedules(TUE_1730_WIB);
        runDueSchedules(TUE_1730_WIB + 15000); // 15s later, same WIB minute
        expect(playToCameras).toHaveBeenCalledTimes(1);
    });

    it('fires again the next day at the same time', () => {
        createSchedule(baseFields);
        runDueSchedules(TUE_1730_WIB);
        runDueSchedules(TUE_1730_WIB + 24 * 3600 * 1000); // +24h -> next day, same HH:MM
        expect(playToCameras).toHaveBeenCalledTimes(2);
    });

    it('skips a schedule whose weekday bit is off today', () => {
        createSchedule({ ...baseFields, daysMask: 127 & ~4 }); // exclude Tuesday
        expect(runDueSchedules(TUE_1730_WIB)).toBe(0);
        expect(playToCameras).not.toHaveBeenCalled();
    });

    it('skips a schedule at a different minute', () => {
        createSchedule({ ...baseFields, timeHHmm: '17:31' });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(0);
    });

    it('skips a disabled schedule, and fires once re-enabled', () => {
        const s = createSchedule(baseFields);
        setEnabled(s.id, false);
        expect(runDueSchedules(TUE_1730_WIB)).toBe(0);
        setEnabled(s.id, true);
        expect(runDueSchedules(TUE_1730_WIB)).toBe(1);
    });

    it('updateSchedule can move the time so it stops matching', () => {
        const s = createSchedule(baseFields);
        updateSchedule(s.id, { timeHHmm: '08:00' });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(0);
    });

    it('deleteSchedule removes it from firing', () => {
        const s = createSchedule(baseFields);
        deleteSchedule(s.id);
        expect(runDueSchedules(TUE_1730_WIB)).toBe(0);
    });
});

describe('audioScheduleService — area quiet-hours gate (B3)', () => {
    // TUE_1730_WIB is 17:30 WIB. An area whose quiet window covers 17:00–18:00 is quiet now.
    it('skips cameras whose area is in quiet hours, firing only the rest', () => {
        db.prepare("INSERT INTO areas (id, name, quiet_start, quiet_end) VALUES (1, 'Malam', '17:00', '18:00')").run();
        db.prepare("INSERT INTO areas (id, name, quiet_start, quiet_end) VALUES (2, 'Siang', NULL, NULL)").run();
        db.prepare("INSERT INTO cameras (id, name, area_id) VALUES (1, 'Cam Malam', 1)").run();
        db.prepare("INSERT INTO cameras (id, name, area_id) VALUES (2, 'Cam Siang', 2)").run();
        createSchedule({ ...baseFields, cameraIds: [1, 2] });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(1);
        // camera 1 (quiet) dropped; only camera 2 is broadcast.
        expect(playToCameras).toHaveBeenCalledWith([2], 'clip', 1, 1, { gainDb: 0 });
    });

    it('does not play at all when every target camera is in quiet hours', () => {
        db.prepare("INSERT INTO areas (id, name, quiet_start, quiet_end) VALUES (1, 'Malam', '17:00', '18:00')").run();
        db.prepare("INSERT INTO cameras (id, name, area_id) VALUES (1, 'Cam Malam', 1)").run();
        createSchedule({ ...baseFields, cameraIds: [1] });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(1); // still counted as due...
        expect(playToCameras).not.toHaveBeenCalled();   // ...but nothing is broadcast
    });

    it('fires normally when the area has no quiet window set', () => {
        db.prepare("INSERT INTO areas (id, name) VALUES (1, 'Siang')").run();
        db.prepare("INSERT INTO cameras (id, name, area_id) VALUES (1, 'Cam', 1)").run();
        db.prepare("INSERT INTO cameras (id, name, area_id) VALUES (2, 'Cam2', 1)").run();
        createSchedule({ ...baseFields, cameraIds: [1, 2] });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(1);
        expect(playToCameras).toHaveBeenCalledWith([1, 2], 'clip', 1, 1, { gainDb: 0 });
    });
});

describe('audioScheduleService — flexible kinds (once / range)', () => {
    // TUE_1730_WIB is WIB date 2026-09-08 (a Tuesday).
    it('once fires only on its run_date, then auto-disables', () => {
        createSchedule({ ...baseFields, scheduleKind: 'once', runDate: '2026-09-08' });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(1);
        expect(playToCameras).toHaveBeenCalledTimes(1);
        expect(runDueSchedules(TUE_1730_WIB + 24 * 3600 * 1000)).toBe(0); // next day: disabled, never re-fires
        expect(playToCameras).toHaveBeenCalledTimes(1);
    });

    it('once with a different run_date does not fire (missed once is dropped, not deferred)', () => {
        createSchedule({ ...baseFields, scheduleKind: 'once', runDate: '2026-09-09' });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(0);
    });

    it('once requires a run_date', () => {
        expect(() => createSchedule({ ...baseFields, scheduleKind: 'once' })).toThrow(/tanggal/i);
    });

    it('range fires inside [start,end] when the mask matches', () => {
        createSchedule({ ...baseFields, scheduleKind: 'range', startDate: '2026-09-01', endDate: '2026-09-30' });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(1);
    });

    it('range does not fire before start or after end', () => {
        createSchedule({ ...baseFields, scheduleKind: 'range', startDate: '2026-09-09' }); // starts tomorrow
        createSchedule({ ...baseFields, scheduleKind: 'range', endDate: '2026-09-07' });   // ended yesterday
        expect(runDueSchedules(TUE_1730_WIB)).toBe(0);
    });

    it('range still respects the weekday mask inside the window', () => {
        createSchedule({ ...baseFields, scheduleKind: 'range', startDate: '2026-09-01', endDate: '2026-09-30', daysMask: 127 & ~4 });
        expect(runDueSchedules(TUE_1730_WIB)).toBe(0); // Tuesday excluded
    });

    it('range rejects start after end', () => {
        expect(() => createSchedule({ ...baseFields, scheduleKind: 'range', startDate: '2026-09-30', endDate: '2026-09-01' })).toThrow(/mulai/i);
    });

    it('a bad date format is rejected', () => {
        expect(() => createSchedule({ ...baseFields, scheduleKind: 'once', runDate: '08-09-2026' })).toThrow(/YYYY-MM-DD/);
    });
});
