/**
 * Purpose: Pin the rules that decide how deep the archive really goes, and what the catalogue is
 *          therefore allowed to claim.
 * Caller: Backend test gate.
 * Deps: vitest, real better-sqlite3 on a temp file.
 * MainFuncs: getCoverage cases + the product annotation that depends on it.
 * SideEffects: Creates and removes a throwaway SQLite file. Never touches the app database.
 *
 * Real SQLite rather than a mocked query layer: the per-camera `MAX(MIN(recorded_at))` grouping IS
 * the rule under test, and a stubbed return value would assert only that the stub was returned.
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

vi.mock('../services/playbackTokenService.js', () => ({ default: { createToken: vi.fn() } }));

const { default: coverageService } = await import('../services/playbackCoverageService.js');
const { default: productService } = await import('../services/playbackProductService.js');

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const at = (iso) => `${iso}.000Z`;

function createCameras() {
    db.exec(`
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_class TEXT NOT NULL DEFAULT 'community',
            enabled INTEGER NOT NULL DEFAULT 1,
            enable_recording INTEGER NOT NULL DEFAULT 0,
            recording_duration_hours INTEGER
        );
    `);
}

function createArchive() {
    db.exec(`
        CREATE TABLE telegram_archive_uploads (
            segment_id INTEGER PRIMARY KEY,
            camera_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            file_id TEXT,
            recorded_at TEXT
        );
    `);
}

function addCamera({ id, klass = 'community', enabled = 1, recording = 1, hours = 4 }) {
    db.prepare(
        `INSERT INTO cameras (id, camera_class, enabled, enable_recording, recording_duration_hours)
         VALUES (?, ?, ?, ?, ?)`
    ).run(id, klass, enabled, recording, hours);
}

function addUpload({ id, cameraId, recordedAt, status = 'ok', fileId = 'BQAC-file' }) {
    db.prepare(
        `INSERT INTO telegram_archive_uploads (segment_id, camera_id, status, file_id, recorded_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(id, cameraId, status, fileId, recordedAt);
}

beforeEach(() => {
    dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pbcov-')), 'test.db');
    db = new Database(dbFile);
    coverageService.clearCache();
});

afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

describe('coverage — the local rolling window', () => {
    it('takes the SHALLOWEST camera, because a package covers all of them', () => {
        createCameras();
        addCamera({ id: 1, hours: 4 });
        addCamera({ id: 2, hours: 720 });

        const coverage = coverageService.getCoverage({ now: NOW });

        expect(coverage.localHours).toBe(4);
        expect(coverage.camerasRecording).toBe(2);
    });

    it('counts only community cameras that are enabled AND recording', () => {
        createCameras();
        addCamera({ id: 1, hours: 6 });
        addCamera({ id: 2, klass: 'subscriber', hours: 1 });
        addCamera({ id: 3, enabled: 0, hours: 1 });
        addCamera({ id: 4, recording: 0, hours: 1 });

        expect(coverageService.getCoverage({ now: NOW }).localHours).toBe(6);
    });

    it('falls back to the default retention when a camera stores none', () => {
        createCameras();
        addCamera({ id: 1, hours: null });

        expect(coverageService.getCoverage({ now: NOW }).localHours).toBe(5);
    });

    /*
     * The distinction that matters: nothing to measure is UNKNOWN, not zero. A fresh install would
     * otherwise flag every package in the catalogue as over-promising before a camera exists.
     */
    it('reports "not measurable" rather than zero when nothing records', () => {
        createCameras();

        const coverage = coverageService.getCoverage({ now: NOW });

        expect(coverage.measurable).toBe(false);
        expect(coverage.camerasRecording).toBe(0);
    });
});

describe('coverage — the Telegram archive', () => {
    beforeEach(() => {
        createCameras();
        addCamera({ id: 1, hours: 4 });
        addCamera({ id: 2, hours: 4 });
        createArchive();
    });

    it('reaches only as far as its SHALLOWEST camera, not its oldest row', () => {
        // Camera 1 has been archiving for days; camera 2 joined 36 hours ago.
        addUpload({ id: 1, cameraId: 1, recordedAt: at('2026-07-20T00:00:00') });
        addUpload({ id: 2, cameraId: 1, recordedAt: at('2026-08-02T11:00:00') });
        addUpload({ id: 3, cameraId: 2, recordedAt: at('2026-08-01T00:00:00') });
        addUpload({ id: 4, cameraId: 2, recordedAt: at('2026-08-02T11:00:00') });

        const coverage = coverageService.getCoverage({ now: NOW });

        expect(coverage.archiveHours).toBe(36);
        expect(coverage.coverageHours).toBe(36);
        expect(coverage.archiveContinuous).toBe(true);
    });

    it('ignores cameras with no archive at all instead of scoring them zero', () => {
        addCamera({ id: 3, hours: 4 });
        addUpload({ id: 1, cameraId: 1, recordedAt: at('2026-08-01T00:00:00') });
        addUpload({ id: 2, cameraId: 2, recordedAt: at('2026-08-01T00:00:00') });
        addUpload({ id: 3, cameraId: 1, recordedAt: at('2026-08-02T11:00:00') });

        const coverage = coverageService.getCoverage({ now: NOW });

        expect(coverage.archiveHours).toBe(36);
        expect(coverage.camerasArchived).toBe(2);
        expect(coverage.camerasRecording).toBe(3);
    });

    it('skips uploads that failed or carry no file_id — they cannot be played back', () => {
        addUpload({ id: 1, cameraId: 1, recordedAt: at('2026-07-01T00:00:00'), status: 'failed' });
        addUpload({ id: 2, cameraId: 1, recordedAt: at('2026-07-02T00:00:00'), fileId: null });
        addUpload({ id: 3, cameraId: 1, recordedAt: at('2026-08-01T00:00:00') });
        addUpload({ id: 4, cameraId: 1, recordedAt: at('2026-08-02T11:00:00') });

        expect(coverageService.getCoverage({ now: NOW }).archiveHours).toBe(36);
    });

    /*
     * A stopped archive is not a shorter archive — it is an archive with a hole in the middle, and
     * the hole is exactly the stretch local retention has since rolled past.
     */
    it('contributes NOTHING once it has been silent longer than local retention', () => {
        addUpload({ id: 1, cameraId: 1, recordedAt: at('2026-07-20T00:00:00') });
        addUpload({ id: 2, cameraId: 1, recordedAt: at('2026-08-01T00:00:00') });

        const coverage = coverageService.getCoverage({ now: NOW });

        expect(coverage.archiveHours).toBe(0);
        expect(coverage.archiveContinuous).toBe(false);
        expect(coverage.archiveStaleHours).toBe(36);
        expect(coverage.coverageHours).toBe(4);
    });

    /** Still inside retention means the disk is covering the tail; there is no hole yet. */
    it('keeps its depth while the gap is still shorter than local retention', () => {
        addUpload({ id: 1, cameraId: 1, recordedAt: at('2026-07-31T00:00:00') });
        // Last upload 3 hours ago against 4 hours of retention — a gap, but not yet a hole.
        addUpload({ id: 2, cameraId: 1, recordedAt: at('2026-08-02T09:00:00') });

        const coverage = coverageService.getCoverage({ now: NOW });

        expect(coverage.archiveContinuous).toBe(true);
        expect(coverage.archiveHours).toBe(60);
    });

    it('survives a database with no archive table at all', () => {
        db.exec('DROP TABLE telegram_archive_uploads');

        const coverage = coverageService.getCoverage({ now: NOW });

        expect(coverage.archiveHours).toBe(0);
        expect(coverage.coverageHours).toBe(4);
        expect(coverage.measurable).toBe(true);
    });
});

describe('catalogue — packages judged against real footage', () => {
    /*
     * The catalogue reads coverage for itself, so `now` cannot be injected the way the cases above
     * do it — the clock has to be frozen instead, or "36 hours ago" drifts by one every hour and
     * the assertions rot overnight.
     */
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        createCameras();
        addCamera({ id: 1, hours: 4 });
        createArchive();
        // Archive reaches 36 hours back and is still running.
        addUpload({ id: 1, cameraId: 1, recordedAt: at('2026-08-01T00:00:00') });
        addUpload({ id: 2, cameraId: 1, recordedAt: at('2026-08-02T11:00:00') });

        db.exec(`
            CREATE TABLE playback_products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                description TEXT,
                price_rupiah INTEGER NOT NULL DEFAULT 0,
                window_hours INTEGER NOT NULL,
                validity_days INTEGER NOT NULL,
                is_trial INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);
        db.prepare(
            `INSERT INTO playback_products (key, label, price_rupiah, window_hours, validity_days, is_trial, enabled, sort_order)
             VALUES ('trial','Coba Gratis',0,1,3,1,1,0),
                    ('daily','Harian',5000,24,1,0,1,1),
                    ('monthly','Bulanan',75000,720,30,0,1,3)`
        ).run();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('flags only the packages that promise deeper than the footage goes', () => {
        const byKey = Object.fromEntries(productService.listAll().map((p) => [p.key, p]));

        expect(byKey.trial.exceeds_coverage).toBe(false);
        expect(byKey.daily.exceeds_coverage).toBe(false);
        expect(byKey.monthly.exceeds_coverage).toBe(true);
        expect(byKey.monthly.coverage_hours).toBe(36);
    });

    it('tells the buyer the real depth alongside the promise', () => {
        const monthly = productService.listPublic().find((p) => p.key === 'monthly');

        expect(monthly.windowHours).toBe(720);
        expect(monthly.coverageHours).toBe(36);
        expect(monthly.exceedsCoverage).toBe(true);
    });

    /** Over-promising is a warning, never a refusal — the archive deepens on its own. */
    it('still saves and still sells a package that exceeds coverage', () => {
        const saved = productService.updateProduct(3, { window_hours: 8760 });

        expect(saved.window_hours).toBe(8760);
        expect(productService.listPublic().map((p) => p.key)).toContain('monthly');
    });

    it('never accuses a package when coverage cannot be measured', () => {
        db.prepare('UPDATE cameras SET enable_recording = 0').run();
        coverageService.clearCache();

        const monthly = productService.listAll().find((p) => p.key === 'monthly');

        expect(monthly.exceeds_coverage).toBe(false);
        expect(monthly.coverage_hours).toBeNull();
    });
});
