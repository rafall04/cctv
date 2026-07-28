/*
 * Purpose: Prove pruneAbsentActiveDiagnostics survives the UNIQUE(camera_id, filename, active)
 *          collision that silently disabled it in production.
 * Caller:  Backend Vitest suite.
 * Deps:    better-sqlite3 (real in-memory DB with the REAL index), the repository.
 * MainFuncs: pruneAbsentActiveDiagnostics tests.
 * SideEffects: None — throwaway :memory: database per test.
 *
 * Why a real database instead of the mocks the sibling test file uses: the bug IS the unique
 * index. A mocked `execute` can never raise "UNIQUE constraint failed", so a mock-based test
 * would have passed against the broken code. Observed in production: 873 orphan rows still
 * active while every cycle logged
 *   [Cleanup] Error pruning recovery diagnostics: UNIQUE constraint failed
 * because ONE collision rolled back the whole batch — forever, since the duplicates persist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

const h = vi.hoisted(() => ({ db: null }));

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => h.db.prepare(sql).all(params),
    queryOne: (sql, params = []) => h.db.prepare(sql).get(params),
    execute: (sql, params = []) => h.db.prepare(sql).run(params),
    transaction: (callback) => h.db.transaction(callback),
}));

const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

// Mirrors database/migrations/zz_20260511_add_recording_recovery_diagnostics.js exactly.
const SCHEMA = `
    CREATE TABLE recording_recovery_diagnostics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        state TEXT NOT NULL,
        reason TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        detected_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL,
        resolved_at DATETIME,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        -- added by zz_20260517_add_recording_recovery_attempt_fields.js
        attempt_count INTEGER DEFAULT 0,
        terminal_state TEXT,
        quarantined_path TEXT
    );
    CREATE UNIQUE INDEX idx_recording_recovery_active_file
    ON recording_recovery_diagnostics(camera_id, filename, active);
`;

function insert({ cameraId, filename, filePath, active }) {
    h.db.prepare(
        `INSERT INTO recording_recovery_diagnostics
         (camera_id, filename, file_path, state, reason, detected_at, last_seen_at, active)
         VALUES (?, ?, ?, 'retryable_failed', 'moov atom not found', '2026-07-27 12:00:00', '2026-07-27 12:00:00', ?)`
    ).run(cameraId, filename, filePath, active);
}

const activeRows = () =>
    h.db.prepare('SELECT camera_id, filename FROM recording_recovery_diagnostics WHERE active = 1').all();

// No file on disk has these paths, so every row counts as "absent".
const GONE = '/gone/camera9/pending/20260727_195333.mp4.partial';

beforeEach(() => {
    h.db = new Database(':memory:');
    h.db.exec(SCHEMA);
});

afterEach(() => {
    h.db?.close();
    h.db = null;
});

describe('pruneAbsentActiveDiagnostics', () => {
    it('REGRESSION: a row whose resolved twin already exists must not abort the batch', () => {
        // The production shape: same (camera_id, filename) present twice — one active, one resolved.
        insert({ cameraId: 9, filename: '20260727_195333.mp4', filePath: GONE, active: 0 });
        insert({ cameraId: 9, filename: '20260727_195333.mp4', filePath: GONE, active: 1 });
        // ...plus an unrelated orphan that MUST still get cleared despite the collision above.
        insert({ cameraId: 5, filename: '20260728_022018.mp4', filePath: `${GONE}.other`, active: 1 });

        const cleared = repository.pruneAbsentActiveDiagnostics();

        expect(cleared).toBe(2);
        expect(activeRows(), 'orphan rows survived the prune').toEqual([]);
    });

    it('resolves a lone orphan in place, keeping the row for history', () => {
        insert({ cameraId: 7, filename: '20260727_210005.mp4', filePath: GONE, active: 1 });

        expect(repository.pruneAbsentActiveDiagnostics()).toBe(1);

        const row = h.db.prepare('SELECT active, resolved_at FROM recording_recovery_diagnostics').get();
        expect(row.active).toBe(0);
        expect(row.resolved_at).toBeTruthy();
    });

    it('deletes the redundant duplicate rather than leaving two resolved rows behind', () => {
        insert({ cameraId: 9, filename: '20260727_195333.mp4', filePath: GONE, active: 0 });
        insert({ cameraId: 9, filename: '20260727_195333.mp4', filePath: GONE, active: 1 });

        repository.pruneAbsentActiveDiagnostics();

        // Exactly one row remains: the twin that was already resolved.
        expect(h.db.prepare('SELECT COUNT(*) AS n FROM recording_recovery_diagnostics').get().n).toBe(1);
    });

    it('leaves rows alone while their file still exists', () => {
        insert({ cameraId: 1, filename: '20260728_104001.mp4', filePath: '/still/here.partial', active: 1 });

        const cleared = repository.pruneAbsentActiveDiagnostics({ fileExists: () => true });

        expect(cleared).toBe(0);
        expect(activeRows()).toHaveLength(1);
    });

    it('clears a whole production-sized backlog of colliding pairs in one pass', () => {
        for (let i = 0; i < 200; i += 1) {
            const filename = `20260727_${String(190000 + i)}.mp4`;
            insert({ cameraId: 9, filename, filePath: `${GONE}${i}`, active: 0 });
            insert({ cameraId: 9, filename, filePath: `${GONE}${i}`, active: 1 });
        }

        expect(repository.pruneAbsentActiveDiagnostics()).toBe(200);
        expect(activeRows()).toEqual([]);
    });
});
