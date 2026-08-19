/**
 * Purpose: Verify the DB interface between the API process and the recording worker —
 *          published process state, health snapshot + staleness, and the reconcile queue.
 * Caller: Vitest backend suite.
 * Deps: mocked connectionPool.
 * SideEffects: None.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn(() => []);
const queryOneMock = vi.fn(() => null);
const executeMock = vi.fn(() => ({ changes: 1 }));

vi.mock('../database/connectionPool.js', () => ({
    query: (...args) => queryMock(...args),
    queryOne: (...args) => queryOneMock(...args),
    execute: (...args) => executeMock(...args),
}));

let repo;

beforeEach(async () => {
    vi.clearAllMocks();
    queryMock.mockReturnValue([]);
    queryOneMock.mockReturnValue(null);
    executeMock.mockReturnValue({ changes: 1 });
    vi.resetModules();
    repo = (await import('../services/recordingWorkerStateRepository.js')).default;
});

describe('process state', () => {
    it('upserts one row per camera', () => {
        expect(repo.publishProcessState(5, {
            pid: 4242, status: 'recording', streamSource: 'internal',
            adopted: true, startedAt: '2026-07-28T05:00:00.000Z',
        })).toBe(true);

        const [sql, params] = executeMock.mock.calls[0];
        expect(sql).toContain('INSERT INTO recording_process_state');
        expect(sql).toContain('ON CONFLICT(camera_id) DO UPDATE');
        expect(params.slice(0, 5)).toEqual([5, 4242, 'recording', 'internal', 1]);
    });

    it('never throws when the table is missing — this must not fail an API request', () => {
        executeMock.mockImplementation(() => { throw new Error('no such table'); });
        expect(repo.publishProcessState(5, { status: 'recording' })).toBe(false);
        queryOneMock.mockImplementation(() => { throw new Error('no such table'); });
        expect(repo.readProcessState(5)).toBeNull();
    });
});

describe('health snapshot + heartbeat', () => {
    it('round-trips the snapshot as JSON', () => {
        repo.publishHealthSnapshot({ status: 'ok', counts: { recording: 11 } }, 999);
        const [sql, params] = executeMock.mock.calls[0];
        expect(sql).toContain('INSERT INTO recording_health_snapshot');
        expect(JSON.parse(params[0])).toEqual({ status: 'ok', counts: { recording: 11 } });
        expect(params[1]).toBe(999);
    });

    it('marks a fresh snapshot available and not stale', () => {
        const now = Date.parse('2026-07-28T05:00:00.000Z');
        queryOneMock.mockReturnValue({
            snapshot: JSON.stringify({ status: 'ok' }),
            worker_pid: 999,
            updated_at: '2026-07-28T04:59:50.000Z',
        });

        const result = repo.readHealthSnapshot(now);
        expect(result).toMatchObject({ available: true, stale: false, workerPid: 999 });
        expect(result.snapshot).toEqual({ status: 'ok' });
    });

    it('marks an old snapshot STALE so the API stops trusting it', () => {
        // A dashboard that looks healthy because nobody is updating it is worse than
        // one that admits the worker is gone.
        const now = Date.parse('2026-07-28T05:00:00.000Z');
        queryOneMock.mockReturnValue({
            snapshot: JSON.stringify({ status: 'ok' }),
            worker_pid: 999,
            updated_at: '2026-07-28T04:55:00.000Z', // 5 min old, limit is 90s
        });

        expect(repo.readHealthSnapshot(now)).toMatchObject({ stale: true });
    });

    it('treats a never-reported worker as unavailable and stale', () => {
        queryOneMock.mockReturnValue(null);
        expect(repo.readHealthSnapshot()).toMatchObject({ available: false, stale: true, snapshot: null });
    });

    it('survives a corrupt snapshot payload', () => {
        queryOneMock.mockReturnValue({ snapshot: '{not json', worker_pid: 1, updated_at: new Date().toISOString() });
        expect(repo.readHealthSnapshot()).toMatchObject({ available: false, snapshot: null });
    });
});

describe('reconcile request queue', () => {
    it('queues a request for the worker', () => {
        repo.requestReconcile(7, 'settings_changed');
        const [sql, params] = executeMock.mock.calls[0];
        expect(sql).toContain('INSERT INTO recording_reconcile_requests');
        expect(params.slice(0, 2)).toEqual([7, 'settings_changed']);
    });

    it('claims requests, deletes them, and COALESCES per camera', () => {
        // Ten edits to one camera still only need one reconcile.
        queryMock.mockReturnValue([
            { id: 1, camera_id: 7, reason: 'settings_changed', action: 'reconcile' },
            { id: 2, camera_id: 7, reason: 'source_changed', action: 'reconcile' },
            { id: 3, camera_id: 9, reason: 'health_transition_offline', action: 'reconcile' },
        ]);

        // Plain reconciles still coalesce first-wins; only an imperative overrides one.
        expect(repo.takeReconcileRequests()).toEqual([
            { cameraId: 7, reason: 'settings_changed', action: 'reconcile' },
            { cameraId: 9, reason: 'health_transition_offline', action: 'reconcile' },
        ]);

        const [deleteSql, deleteParams] = executeMock.mock.calls[0];
        expect(deleteSql).toContain('DELETE FROM recording_reconcile_requests');
        expect(deleteParams).toEqual([1, 2, 3]);
    });

    it('does not issue a delete when the queue is empty', () => {
        queryMock.mockReturnValue([]);
        expect(repo.takeReconcileRequests()).toEqual([]);
        expect(executeMock).not.toHaveBeenCalled();
    });
});
