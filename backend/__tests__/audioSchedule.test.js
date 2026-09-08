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
        CREATE TABLE audio_clips (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_filename TEXT UNIQUE, duration_sec REAL DEFAULT 0, source_bytes INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE audio_playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE audio_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, camera_ids TEXT NOT NULL DEFAULT '[]',
            source_type TEXT NOT NULL, source_id INTEGER NOT NULL, time_hhmm TEXT NOT NULL,
            days_mask INTEGER NOT NULL DEFAULT 127, loop_count INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, created_at TEXT DEFAULT (datetime('now')));
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
        expect(playToCameras).toHaveBeenCalledWith([1, 2], 'clip', 1, 1);
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
