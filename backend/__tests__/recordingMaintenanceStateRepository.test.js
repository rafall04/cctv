/**
 * Purpose: Verify recording maintenance state persistence for cleanup observability.
 * Caller: Vitest backend suite.
 * Deps: recordingMaintenanceStateRepository, connectionPool mocks.
 * MainFuncs: upsertRunState, insertRunEvent, getLatestState.
 * SideEffects: None; DB helpers are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    queryOne: queryOneMock,
}));

const repository = (await import('../services/recordingMaintenanceStateRepository.js')).default;

describe('recordingMaintenanceStateRepository', () => {
    beforeEach(() => {
        executeMock.mockReset();
        queryOneMock.mockReset();
    });

    it('upserts latest run state by maintenance type', () => {
        repository.upsertRunState({
            maintenanceType: 'scheduled_cleanup',
            status: 'ok',
            startedAt: '2026-05-18T10:00:00.000Z',
            finishedAt: '2026-05-18T10:00:02.000Z',
            deleted: 2,
            deletedBytes: 4096,
            errorMessage: null,
        });

        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(maintenance_type) DO UPDATE'), [
            'scheduled_cleanup',
            'ok',
            '2026-05-18T10:00:00.000Z',
            '2026-05-18T10:00:02.000Z',
            2,
            4096,
            null,
        ]);
    });

    it('inserts immutable run events for maintenance history', () => {
        repository.insertRunEvent({
            maintenanceType: 'emergency_cleanup',
            status: 'ok',
            startedAt: '2026-05-18T10:00:00.000Z',
            finishedAt: '2026-05-18T10:00:02.000Z',
            deleted: 1,
            deletedBytes: 2048,
            errorMessage: null,
        });

        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO recording_maintenance_events'), [
            'emergency_cleanup',
            'ok',
            '2026-05-18T10:00:00.000Z',
            '2026-05-18T10:00:02.000Z',
            1,
            2048,
            null,
        ]);
    });

    it('reads latest state for assurance diagnostics', () => {
        queryOneMock.mockReturnValue({ maintenance_type: 'emergency_cleanup', status: 'ok' });

        expect(repository.getLatestState('emergency_cleanup')).toEqual({
            maintenance_type: 'emergency_cleanup',
            status: 'ok',
        });
        expect(queryOneMock).toHaveBeenCalledWith(expect.stringContaining('FROM recording_maintenance_state'), ['emergency_cleanup']);
    });
});
