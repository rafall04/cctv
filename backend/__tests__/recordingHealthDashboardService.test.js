/**
 * Purpose: Validate recordingHealthDashboardService snapshot aggregation and the
 *          ok/warning/critical status derivation.
 * Caller: Vitest backend test suite.
 * Deps: createRecordingHealthDashboardService with injected scheduler/recovery/query mocks.
 * MainFuncs: getSnapshot.
 * SideEffects: None — all dependencies are stubbed.
 */
import { describe, expect, it } from 'vitest';
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

    it('aggregates recording process counts, restarts, and storage', () => {
        const snap = buildService({
            queryFn: makeQuery({
                'FROM cameras': [
                    { status: 'recording', count: 800 },
                    { status: 'stopped', count: 48 },
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

        expect(snap.recordingProcesses.recording).toBe(800);
        expect(snap.recordingProcesses.stopped).toBe(48);
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
