/**
 * Purpose: Validate recordingHealthDashboardService snapshot aggregation and the
 *          ok/warning/critical status derivation.
 * Caller: Vitest backend test suite.
 * Deps: createRecordingHealthDashboardService with injected scheduler/recovery/query mocks.
 * MainFuncs: getSnapshot.
 * SideEffects: None — all dependencies are stubbed.
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createRecordingHealthDashboardService } from '../services/recordingHealthDashboardService.js';

const NOW = Date.UTC(2026, 4, 22, 10, 0, 0);

function healthyScheduler(overrides = {}) {
    return {
        isRunning: () => true,
        getAllStats: () => [
            {
                name: 'segment-recovery-scanner',
                intervalMs: 60000,
                runCount: 12,
                lastRunAt: NOW - 10000,
                lastDurationMs: 120,
                lastError: null,
            },
            {
                name: 'scheduled-cleanup',
                intervalMs: 3600000,
                runCount: 3,
                lastRunAt: NOW - 30000,
                lastDurationMs: 800,
                lastError: null,
            },
        ],
        ...overrides,
    };
}

function emptyRecoveryService(overrides = {}) {
    return {
        getStats: () => ({ queueLength: 0, inFlightCount: 0, activeCount: 0, maxConcurrent: 3 }),
        ...overrides,
    };
}

function emptyDiagnosticsRepository(overrides = {}) {
    return {
        summarizeActive: () => ({}),
        getActiveHealthSummary: () => ({
            oldest_active_seen_at: null,
            max_attempt_count: 0,
            active_total: 0,
        }),
        ...overrides,
    };
}

/** Branch a query stub on SQL content so each section gets predictable rows. */
function makeQuery(rowsBySubstring = {}) {
    return (sql) => {
        for (const [needle, rows] of Object.entries(rowsBySubstring)) {
            if (sql.includes(needle)) return rows;
        }
        return [];
    };
}

function makeQueryOne(rowBySubstring = {}) {
    return (sql) => {
        for (const [needle, row] of Object.entries(rowBySubstring)) {
            if (sql.includes(needle)) return row;
        }
        return null;
    };
}

function buildService(overrides = {}) {
    return createRecordingHealthDashboardService({
        scheduler: healthyScheduler(),
        recoveryService: emptyRecoveryService(),
        diagnosticsRepository: emptyDiagnosticsRepository(),
        queryFn: makeQuery(),
        queryOneFn: makeQueryOne(),
        logger: { error: () => {} },
        ...overrides,
    });
}

describe('recordingHealthDashboardService.getSnapshot', () => {
    it('reports status ok when scheduler is running and nothing is wrong', () => {
        const snap = buildService().getSnapshot(NOW);
        expect(snap.status.level).toBe('ok');
        expect(snap.status.reasons).toEqual([]);
        expect(snap.generatedAt).toBe(new Date(NOW).toISOString());
        expect(snap.scheduler.running).toBe(true);
        expect(snap.scheduler.taskCount).toBe(2);
        expect(snap.scheduler.tasks.every((t) => t.healthy)).toBe(true);
    });

    it('marks status critical when the scheduler is not running', () => {
        const snap = buildService({
            scheduler: healthyScheduler({ isRunning: () => false }),
        }).getSnapshot(NOW);
        expect(snap.status.level).toBe('critical');
        expect(snap.status.reasons.join(' ')).toContain('not running');
    });

    it('marks status critical when a scheduler task has a lastError', () => {
        const scheduler = healthyScheduler({
            getAllStats: () => [
                {
                    name: 'scheduled-cleanup',
                    intervalMs: 3600000,
                    runCount: 5,
                    lastRunAt: NOW - 1000,
                    lastDurationMs: 50,
                    lastError: 'disk read failed',
                },
            ],
        });
        const snap = buildService({ scheduler }).getSnapshot(NOW);
        expect(snap.status.level).toBe('critical');
        expect(snap.status.reasons.join(' ')).toContain('scheduled-cleanup');
        expect(snap.scheduler.tasks[0].healthy).toBe(false);
    });

    it('flags an overdue task (last run older than 2x its interval) as a warning', () => {
        const scheduler = healthyScheduler({
            getAllStats: () => [
                {
                    name: 'segment-recovery-scanner',
                    intervalMs: 60000,
                    runCount: 8,
                    lastRunAt: NOW - 200000, // > 2x interval
                    lastDurationMs: 100,
                    lastError: null,
                },
            ],
        });
        const snap = buildService({ scheduler }).getSnapshot(NOW);
        expect(snap.scheduler.tasks[0].overdue).toBe(true);
        expect(snap.scheduler.tasks[0].healthy).toBe(false);
        expect(snap.status.level).toBe('warning');
    });

    it('marks status warning when unrecoverable files exist', () => {
        const snap = buildService({
            queryOneFn: makeQueryOne({
                'terminal_state IS NOT NULL': { count: 4 },
                'FROM recording_segments': { segment_count: 10, total_size: 0 },
            }),
            queryFn: makeQuery({
                'terminal_state IS NOT NULL': [
                    { camera_id: 7, filename: 'a.mp4', reason: 'corrupt', terminal_state: 'unrecoverable' },
                ],
            }),
        }).getSnapshot(NOW);
        expect(snap.recovery.diagnostics.terminalTotal).toBe(4);
        expect(snap.status.level).toBe('warning');
        expect(snap.status.reasons.join(' ')).toContain('unrecoverable');
    });

    it('marks status warning when the recovery queue has a backlog', () => {
        const snap = buildService({
            recoveryService: emptyRecoveryService({
                getStats: () => ({ queueLength: 120, inFlightCount: 3, activeCount: 3, maxConcurrent: 3 }),
            }),
        }).getSnapshot(NOW);
        expect(snap.status.level).toBe('warning');
        expect(snap.status.reasons.join(' ')).toContain('backlog');
    });

    it('critical outranks warning when both a failing task and unrecoverable files exist', () => {
        const scheduler = healthyScheduler({
            getAllStats: () => [
                { name: 't', intervalMs: 1000, runCount: 1, lastRunAt: NOW, lastDurationMs: 1, lastError: 'boom' },
            ],
        });
        const snap = buildService({
            scheduler,
            queryOneFn: makeQueryOne({ 'terminal_state IS NOT NULL': { count: 2 } }),
        }).getSnapshot(NOW);
        expect(snap.status.level).toBe('critical');
    });

    it('aggregates recording process counts (from recording_process_state), restarts, and storage', () => {
        const snap = buildService({
            queryFn: makeQuery({
                // The process section now counts REAL recorders, not the cameras.recording_status column.
                'recording_process_state': [
                    { status: 'recording', count: 22 },
                ],
                'GROUP BY success': [
                    { success: 1, count: 30 },
                    { success: 0, count: 2 },
                ],
                'ORDER BY restart_time': [
                    { camera_id: 1, reason: 'process_crashed', restart_time: 't', success: 0 },
                ],
            }),
            queryOneFn: makeQueryOne({
                'FROM recording_segments': { segment_count: 12000, total_size: 5 * 1024 * 1024 * 1024 },
            }),
        }).getSnapshot(NOW);

        expect(snap.recordingProcesses.recording).toBe(22);
        expect(snap.restarts.last24h).toEqual({ total: 32, succeeded: 30, failed: 2 });
        expect(snap.restarts.recent).toHaveLength(1);
        expect(snap.storage.totalSegments).toBe(12000);
        expect(snap.storage.totalSizeGB).toBe(5);
    });


    it('degrades a failing section to a safe fallback instead of throwing', () => {
        const snap = buildService({
            recoveryService: emptyRecoveryService({
                getStats: () => { throw new Error('queue exploded'); },
            }),
        }).getSnapshot(NOW);
        // The recovery section failed, but the snapshot still resolves.
        expect(snap.recovery.error).toBe('queue exploded');
        expect(snap.recovery.queue.queueLength).toBe(0);
        // Other sections are unaffected.
        expect(snap.scheduler.running).toBe(true);
        expect(snap.status.level).toBe('ok');
    });
});

// A substring-matched mock never executes SQL, so it cannot catch a typo in the new queries and it
// cannot prove the restart/segment windows actually filter. These run the REAL SQL on a temp DB.
describe('recordingHealthDashboardService.getSnapshot — real SQLite', () => {
    const NOW_MS = Date.UTC(2026, 7, 8, 12, 0, 0);
    const iso = (msAgo) => new Date(NOW_MS - msAgo).toISOString();

    function makeDb() {
        const db = new Database(':memory:');
        db.exec(`
            CREATE TABLE cameras (
                id INTEGER PRIMARY KEY, enabled INTEGER, enable_recording INTEGER,
                is_online INTEGER, recording_status TEXT, last_recording_start TEXT
            );
            CREATE TABLE recording_process_state (
                camera_id INTEGER PRIMARY KEY, status TEXT, pid INTEGER
            );
            CREATE TABLE restart_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, reason TEXT,
                restart_time TEXT, recovery_time TEXT, success INTEGER
            );
            CREATE TABLE recording_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, start_time TEXT,
                file_size INTEGER
            );
            CREATE TABLE recording_recovery_diagnostics (
                id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, filename TEXT,
                reason TEXT, terminal_state TEXT, quarantined_path TEXT, updated_at TEXT, active INTEGER
            );
        `);
        return db;
    }

    // Scheduler whose lastRunAt is anchored to THIS block's clock, so tasks are not spuriously
    // flagged overdue (the shared healthyScheduler() helper is anchored to the other block's NOW).
    function freshScheduler() {
        return {
            isRunning: () => true,
            getAllStats: () => [
                { name: 'scanner', intervalMs: 60000, runCount: 10, lastRunAt: NOW_MS - 5000, lastDurationMs: 20, lastError: null },
            ],
        };
    }

    function serviceFor(db) {
        return createRecordingHealthDashboardService({
            scheduler: freshScheduler(),
            recoveryService: emptyRecoveryService(),
            diagnosticsRepository: emptyDiagnosticsRepository(),
            queryFn: (sql, params = []) => db.prepare(sql).all(params),
            queryOneFn: (sql, params = []) => db.prepare(sql).get(params),
            logger: { error: () => {} },
        });
    }

    it('counts real recorder processes and validates every section query executes', () => {
        const db = makeDb();
        // 3 cameras enabled for recording; only 2 have a live process row.
        db.exec(`
            INSERT INTO cameras (id, enabled, enable_recording, is_online, recording_status, last_recording_start) VALUES
                (1, 1, 1, 1, 'recording', '${iso(3 * 3600 * 1000)}'),
                (2, 1, 1, 1, 'recording', '${iso(3 * 3600 * 1000)}'),
                (3, 1, 1, 1, 'recording', '${iso(3 * 3600 * 1000)}');
            INSERT INTO recording_process_state (camera_id, status, pid) VALUES (1, 'recording', 111), (2, 'recording', 222);
        `);
        // Cameras 1 and 2 produced a fresh segment; camera 3 produced none in the window → silent failure.
        db.prepare('INSERT INTO recording_segments (camera_id, start_time, file_size) VALUES (?, ?, ?)').run(1, iso(5 * 60 * 1000), 10);
        db.prepare('INSERT INTO recording_segments (camera_id, start_time, file_size) VALUES (?, ?, ?)').run(2, iso(5 * 60 * 1000), 20);

        const snap = serviceFor(db).getSnapshot(NOW_MS);

        // recordingProcesses reflects the process table (2), not the 3 'recording' rows in cameras.
        expect(snap.recordingProcesses.recording).toBe(2);
        expect(snap.integrity.expectedRecording).toBe(3);
        expect(snap.integrity.liveButNoRecentSegments).toBe(1); // camera 3
        expect(snap.status.level).toBe('warning');
        expect(snap.status.reasons.join(' ')).toContain('producing no segments');
    });

    it('flags a single-camera restart loop and honours the 24h ISO window', () => {
        const db = makeDb();
        const ins = db.prepare('INSERT INTO restart_logs (camera_id, reason, restart_time, success) VALUES (?, ?, ?, ?)');
        for (let i = 0; i < 30; i += 1) ins.run(37, 'stream_frozen', iso(i * 60 * 1000), 1); // 30 in the last 30 min
        ins.run(37, 'stream_frozen', iso(26 * 3600 * 1000), 1);                               // 1 older than 24h → excluded
        ins.run(5, 'process_crashed', iso(10 * 60 * 1000), 0);

        const snap = serviceFor(db).getSnapshot(NOW_MS);

        expect(snap.restarts.topCamera24h).toEqual({ camera_id: 37, count: 30 }); // the 26h-old row excluded
        expect(snap.status.level).toBe('warning');
        expect(snap.status.reasons.join(' ')).toContain('camera 37');
    });

    it('stays ok when processes match, restarts are few, and every live camera produces segments', () => {
        const db = makeDb();
        db.exec(`
            INSERT INTO cameras (id, enabled, enable_recording, is_online, recording_status, last_recording_start) VALUES
                (1, 1, 1, 1, 'recording', '${iso(3 * 3600 * 1000)}');
            INSERT INTO recording_process_state (camera_id, status, pid) VALUES (1, 'recording', 111);
        `);
        db.prepare('INSERT INTO recording_segments (camera_id, start_time, file_size) VALUES (?, ?, ?)').run(1, iso(5 * 60 * 1000), 10);
        db.prepare('INSERT INTO restart_logs (camera_id, reason, restart_time, success) VALUES (?, ?, ?, ?)').run(1, 'stream_frozen', iso(60 * 1000), 1);

        const snap = serviceFor(db).getSnapshot(NOW_MS);

        expect(snap.status.level).toBe('ok');
        expect(snap.status.reasons).toEqual([]);
        expect(snap.integrity.liveButNoRecentSegments).toBe(0);
        expect(snap.integrity.restartingButNoSegments).toBe(0); // has a segment → not a silent loop
    });

    it('flags a SLOW restart-loop with zero segments even when last_recording_start is always fresh (fix #8)', () => {
        const db = makeDb();
        // Camera restarting within the hour: last_recording_start is only 5 min old (FRESH < 1h), so
        // the stale detector (last_recording_start <= now-1h) NEVER fires — the exact blind spot. But
        // it restarted inside the window and produced ZERO completed segments → silent footage loss.
        db.exec(`
            INSERT INTO cameras (id, enabled, enable_recording, is_online, recording_status, last_recording_start) VALUES
                (7, 1, 1, 1, 'recording', '${iso(5 * 60 * 1000)}');
            INSERT INTO recording_process_state (camera_id, status, pid) VALUES (7, 'recording', 777);
        `);
        const ins = db.prepare('INSERT INTO restart_logs (camera_id, reason, restart_time, success) VALUES (?, ?, ?, ?)');
        ins.run(7, 'stream_frozen', iso(5 * 60 * 1000), 1);   // restarted 5 min ago (in window)
        ins.run(7, 'stream_frozen', iso(45 * 60 * 1000), 1);  // and 45 min ago (in window)
        // NO recording_segments for camera 7 → the silent loop.

        const snap = serviceFor(db).getSnapshot(NOW_MS);

        expect(snap.integrity.liveButNoRecentSegments).toBe(0);  // stale detector MISSES it (fresh start)
        expect(snap.integrity.restartingButNoSegments).toBe(1);  // new detector CATCHES it
        expect(snap.status.level).toBe('warning');
        expect(snap.status.reasons.join(' ')).toContain('restart-loop');
    });
});
