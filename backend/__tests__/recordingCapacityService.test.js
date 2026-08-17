/**
 * Purpose: Pin the storage projection — the measured rate, the grace nobody budgets for, and the
 *          reserve that must not be counted as free room.
 * Caller: Backend test gate.
 * Deps: vitest, real better-sqlite3 on a temp file, mocked disk-space reader.
 * MainFuncs: measured vs default rate, effectiveHours, projection fit.
 * SideEffects: Creates and removes a throwaway SQLite file. Never touches the app database.
 *
 * Real SQLite because the rate is computed with `julianday()` — the whole reason the span is done
 * in SQL is that JS date parsing would read a bare 'YYYY-MM-DD HH:MM:SS' as local time and skew it
 * by the timezone offset. A mocked query layer would assert nothing about that.
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

const getFreeBytes = vi.fn();
vi.mock('../services/recordingDiskSpaceService.js', () => ({ default: { getFreeBytes: (...a) => getFreeBytes(...a) } }));

const { default: capacityService, effectiveHours } = await import('../services/recordingCapacityService.js');
const { RECORDING_EMERGENCY_DISK_THRESHOLD_BYTES } = await import('../services/recordingIntervalsPolicy.js');

const GB = 1024 * 1024 * 1024;

beforeEach(() => {
    vi.clearAllMocks();
    dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reccap-')), 'test.db');
    db = new Database(dbFile);
    db.exec(`
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 1,
            enable_recording INTEGER NOT NULL DEFAULT 0,
            recording_duration_hours INTEGER
        );
        CREATE TABLE recording_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            file_size INTEGER NOT NULL,
            start_time TEXT NOT NULL
        );
    `);
    getFreeBytes.mockResolvedValue(100 * GB);
});

afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

const addCamera = (id, hours, { recording = 1, enabled = 1 } = {}) =>
    db.prepare(
        'INSERT INTO cameras (id, enabled, enable_recording, recording_duration_hours) VALUES (?, ?, ?, ?)'
    ).run(id, enabled, recording, hours);

const addSegment = (cameraId, bytes, startTime) =>
    db.prepare('INSERT INTO recording_segments (camera_id, file_size, start_time) VALUES (?, ?, ?)')
        .run(cameraId, bytes, startTime);

describe('retention grace', () => {
    /* Files die at retention + grace. Budgeting for the bare retention is how a disk fills to 96%. */
    it('adds max(10 minutes, 10% of retention) on top of the setting', () => {
        expect(effectiveHours(4)).toBeCloseTo(4.4, 5);
        expect(effectiveHours(72)).toBeCloseTo(79.2, 5);
        // Under 100 minutes the 10-minute floor wins over the percentage.
        expect(effectiveHours(1)).toBeCloseTo(1 + 10 / 60, 5);
    });
});

describe('measured rate', () => {
    it('derives bytes per camera-hour from this fleet, not from an assumption', async () => {
        addCamera(1, 4);
        // 4 hours of span carrying 4 GB → 1 GB per camera-hour.
        addSegment(1, 2 * GB, '2026-08-02T04:00:00.000Z');
        addSegment(1, 2 * GB, '2026-08-02T08:00:00.000Z');

        const result = await capacityService.getCapacity();

        expect(result.rate.source).toBe('measured');
        expect(result.rate.bytesPerCameraHour).toBeCloseTo(GB, -6);
        expect(result.rate.sampleCameras).toBe(1);
    });

    /** A bare 'YYYY-MM-DD HH:MM:SS' must measure the same span as the ISO form, not offset by zone. */
    it('reads plain SQL timestamps as UTC, the way they were written', async () => {
        addCamera(1, 4);
        addSegment(1, 2 * GB, '2026-08-02 04:00:00');
        addSegment(1, 2 * GB, '2026-08-02 08:00:00');

        const result = await capacityService.getCapacity();

        expect(result.rate.bytesPerCameraHour).toBeCloseTo(GB, -6);
    });

    it('falls back to the production-measured default until there is enough of its own data', async () => {
        addCamera(1, 4);
        // Ten minutes of footage is noise, not a measurement.
        addSegment(1, 30 * 1024 * 1024, '2026-08-02T04:00:00.000Z');
        addSegment(1, 30 * 1024 * 1024, '2026-08-02T04:10:00.000Z');

        const result = await capacityService.getCapacity();

        expect(result.rate.source).toBe('default');
        // 0.43 GB of video measured on production + 0.0141 GB for the AAC track the recorder
        // now maps when the camera has a microphone. See recordingCapacityService.
        expect(result.rate.bytesPerCameraHour).toBeCloseTo(0.4441 * GB, -6);
    });
});

describe('projection', () => {
    beforeEach(() => {
        // Two recording cameras at 1 GB/camera-hour, plus one that does not record at all.
        addCamera(1, 4);
        addCamera(2, 4);
        addCamera(3, 4, { recording: 0 });
        addSegment(1, 2 * GB, '2026-08-02T04:00:00.000Z');
        addSegment(1, 2 * GB, '2026-08-02T08:00:00.000Z');
        addSegment(2, 2 * GB, '2026-08-02T04:00:00.000Z');
        addSegment(2, 2 * GB, '2026-08-02T08:00:00.000Z');
    });

    it('counts only cameras that actually record', async () => {
        expect((await capacityService.getCapacity()).cameras).toBe(2);
    });

    it('costs a retention at rate x cameras x (retention + grace)', async () => {
        const result = await capacityService.getCapacity();
        const daily = result.projections.find((p) => p.hours === 24);

        // 1 GB/camera-hour x 2 cameras x 26.4 effective hours.
        expect(daily.bytes / GB).toBeCloseTo(52.8, 1);
        expect(daily.effectiveHours).toBeCloseTo(26.4, 2);
    });

    it('marks the retention the fleet is actually set to', async () => {
        const result = await capacityService.getCapacity();

        expect(result.retention.currentHours).toBe(4);
        expect(result.retention.mixed).toBe(false);
        expect(result.projections.find((p) => p.isCurrent).hours).toBe(4);
    });

    /*
     * The emergency reserve is not spare room: crossing it triggers bulk deletion of footage, so a
     * retention that only "fits" by eating into it has not fitted.
     */
    it('refuses to count the emergency reserve as available space', async () => {
        // Exactly enough for 72 h (79.2 effective x 2 cameras = 158.4 GB) before the reserve.
        getFreeBytes.mockResolvedValue(158.4 * GB - 8 * GB + RECORDING_EMERGENCY_DISK_THRESHOLD_BYTES);

        const result = await capacityService.getCapacity();

        expect(result.disk.reservedBytes).toBe(RECORDING_EMERGENCY_DISK_THRESHOLD_BYTES);
        // 8 GB of it is already held by recordings, which the projection may reuse.
        expect(result.disk.safeBytes / GB).toBeCloseTo(158.4, 1);
        expect(result.projections.find((p) => p.hours === 72).fits).toBe(true);
        expect(result.projections.find((p) => p.hours === 168).fits).toBe(false);
    });

    /** An unreadable disk is "we do not know", never "it fits". */
    it('reports fit as unknown when free space cannot be read', async () => {
        getFreeBytes.mockResolvedValue(null);

        const result = await capacityService.getCapacity();

        expect(result.disk.safeBytes).toBeNull();
        expect(result.projections.every((p) => p.fits === null)).toBe(true);
    });
});
