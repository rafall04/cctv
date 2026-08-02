/**
 * Purpose: Pin what makes free text from anonymous devices safe here — it never reaches another
 *          visitor, it must name a real problem, and one device cannot flood the queue.
 * Caller: Backend test gate.
 * Deps: vitest, real better-sqlite3 on a temp file, mocked telegramService.
 * MainFuncs: submitReport / listReports / updateReportStatus.
 * SideEffects: Creates and removes a throwaway SQLite file. Never touches the app database.
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

const sendFeedbackMessage = vi.fn().mockResolvedValue(undefined);
const isFeedbackConfigured = vi.fn().mockReturnValue(true);
vi.mock('../services/telegramService.js', () => ({
    sendFeedbackMessage: (...a) => sendFeedbackMessage(...a),
    isFeedbackConfigured: (...a) => isFeedbackConfigured(...a),
}));

const { default: reports } = await import('../services/cameraReportService.js');

const DEVICE = 'device-aaa';

beforeEach(() => {
    vi.clearAllMocks();
    isFeedbackConfigured.mockReturnValue(true);
    sendFeedbackMessage.mockResolvedValue(undefined);

    dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'camrep-')), 'test.db');
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
        CREATE TABLE camera_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            device_hash TEXT,
            category TEXT NOT NULL,
            message TEXT,
            occurred_at TEXT,
            ip_address TEXT,
            status TEXT NOT NULL DEFAULT 'baru',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    db.prepare('INSERT INTO areas (id, name) VALUES (3, ?)').run('KEC BOJONEGORO');
    db.prepare("INSERT INTO cameras (id, name, area_id) VALUES (16, 'PEREMPATAN', 3)").run();
});

afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

describe('submitting a report', () => {
    it('stores a categorised report and acknowledges with an id only', () => {
        const result = reports.submitReport(16, { category: 'buram', deviceHash: DEVICE });

        expect(result).toEqual({ id: expect.any(Number) });
        // Nothing readable comes back: the reporter gets an acknowledgement, not the queue.
        expect(Object.keys(result)).toEqual(['id']);
        expect(db.prepare('SELECT category, status FROM camera_reports').get())
            .toEqual({ category: 'buram', status: 'baru' });
    });

    /* The column that makes this more than a complaint box: a coordinate into the archive. */
    it('keeps when the incident happened, separate from when it was reported', () => {
        reports.submitReport(16, {
            category: 'kejadian', message: 'Serempetan', occurredAt: '2026-08-02T14:30', deviceHash: DEVICE,
        });

        expect(db.prepare('SELECT occurred_at FROM camera_reports').get().occurred_at).toBe('2026-08-02T14:30');
    });

    it('rejects a category it does not know how to act on', () => {
        expect(() => reports.submitReport(16, { category: 'spam', deviceHash: DEVICE }))
            .toThrow(/tidak dikenali/);
    });

    /* "Lainnya" with no words names no problem — it is an empty ticket for the operator. */
    it('requires a description when the category is "lainnya"', () => {
        expect(() => reports.submitReport(16, { category: 'lainnya', deviceHash: DEVICE }))
            .toThrow(/menuliskan keterangannya/);
        expect(() => reports.submitReport(16, { category: 'lainnya', message: 'Suara aneh', deviceHash: DEVICE }))
            .not.toThrow();
    });

    it('caps the description instead of storing an essay', () => {
        expect(() => reports.submitReport(16, {
            category: 'buram', message: 'x'.repeat(501), deviceHash: DEVICE,
        })).toThrow(/maksimal 500/);
    });

    /* Public surface is community-only; a rented camera is not reportable by strangers. */
    it('refuses cameras that are not public', () => {
        db.prepare("INSERT INTO cameras (id, name, camera_class) VALUES (2, 'SEWA', 'subscriber')").run();

        expect(() => reports.submitReport(2, { category: 'buram', deviceHash: DEVICE }))
            .toThrow(/tidak ditemukan/);
    });

    /** Not a security boundary — a stuck finger or a retry loop is the realistic failure. */
    it('stops one device from flooding the queue', () => {
        for (let i = 0; i < 5; i += 1) {
            reports.submitReport(16, { category: 'buram', deviceHash: DEVICE });
        }

        expect(() => reports.submitReport(16, { category: 'buram', deviceHash: DEVICE }))
            .toThrow(/Terlalu banyak laporan/);
    });
});

describe('telegram hand-off', () => {
    it('sends the operator what they need to act, including the incident time', () => {
        reports.submitReport(16, {
            category: 'kejadian', message: 'Serempetan', occurredAt: '2026-08-02T14:30', deviceHash: DEVICE,
        });

        const text = sendFeedbackMessage.mock.calls[0][0];
        expect(text).toContain('PEREMPATAN');
        expect(text).toContain('Ada kejadian di rekaman');
        expect(text).toContain('2026-08-02T14:30');
    });

    it('stays quiet when no feedback bot is configured', () => {
        isFeedbackConfigured.mockReturnValue(false);

        reports.submitReport(16, { category: 'buram', deviceHash: DEVICE });

        expect(sendFeedbackMessage).not.toHaveBeenCalled();
    });

    /* The row is already committed; a Telegram outage must not become a failed report. */
    it('still accepts the report when the notification fails', () => {
        sendFeedbackMessage.mockRejectedValue(new Error('telegram down'));

        expect(() => reports.submitReport(16, { category: 'buram', deviceHash: DEVICE })).not.toThrow();
        expect(db.prepare('SELECT COUNT(*) AS n FROM camera_reports').get().n).toBe(1);
    });
});

describe('operator queue', () => {
    beforeEach(() => {
        reports.submitReport(16, { category: 'buram', deviceHash: DEVICE });
        reports.submitReport(16, { category: 'mati', deviceHash: 'device-bbb' });
    });

    it('carries the camera and a human label for the category', () => {
        const { reports: list, openCount } = reports.listReports();

        expect(openCount).toBe(2);
        expect(list[0].cameraName).toBe('PEREMPATAN');
        expect(list[0].areaName).toBe('KEC BOJONEGORO');
        expect(list.map((r) => r.categoryLabel)).toContain('Tidak tampil / mati');
    });

    it('sinks resolved reports below the open ones', () => {
        const first = reports.listReports().reports[0];
        reports.updateReportStatus(first.id, 'selesai');

        const { reports: list, openCount } = reports.listReports();

        expect(openCount).toBe(1);
        expect(list[list.length - 1].id).toBe(first.id);
    });

    it('rejects a status that is not part of the workflow', () => {
        expect(() => reports.updateReportStatus(1, 'dibuang')).toThrow(/Status tidak valid/);
    });

    it('reports a missing report as 404 rather than failing silently', () => {
        expect(() => reports.updateReportStatus(999, 'selesai')).toThrow(/tidak ditemukan/);
    });
});
