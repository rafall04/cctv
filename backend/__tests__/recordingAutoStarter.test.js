/**
 * Purpose: Validate recording boot auto-start delegates to lifecycle reconciler and pre-marks offline cameras.
 * Caller: Vitest backend suite.
 * Deps: recordingAutoStarter with injected query/suspendOffline/reconcileAll mocks.
 * MainFuncs: createRecordingAutoStarter, autoStart.
 * SideEffects: None; all collaborators mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingAutoStarter } from '../services/recordingAutoStarter.js';

describe('recordingAutoStarter', () => {
    let query;
    let suspendOffline;
    let reconcileAll;
    let logger;

    beforeEach(() => {
        query = vi.fn();
        suspendOffline = vi.fn();
        reconcileAll = vi.fn();
        logger = { log: vi.fn(), error: vi.fn() };
    });

    it('pre-marks offline cameras as suspended before reconciling', async () => {
        query.mockReturnValue([{ id: 11 }, { id: 22 }]);
        reconcileAll.mockResolvedValue({ results: [] });
        const starter = createRecordingAutoStarter({ query, suspendOffline, reconcileAll, logger });

        await starter.autoStart();

        expect(query).toHaveBeenCalledWith(
            'SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1 AND COALESCE(is_online, 1) != 1'
        );
        expect(suspendOffline).toHaveBeenCalledWith(11);
        expect(suspendOffline).toHaveBeenCalledWith(22);
        expect(reconcileAll).toHaveBeenCalledWith('auto_start');
    });

    it('reports started vs skipped counts', async () => {
        query.mockReturnValue([]);
        reconcileAll.mockResolvedValue({
            results: [
                { action: 'start', success: true },
                { action: 'start', success: false },
                { action: 'noop_disabled', success: true },
                { action: 'wait_cooldown', success: true },
            ],
        });
        const starter = createRecordingAutoStarter({ query, suspendOffline, reconcileAll, logger });

        const result = await starter.autoStart();

        expect(result).toMatchObject({ success: true, started: 1, skipped: 3, total: 4 });
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('1 started, 3 skipped'));
    });

    it('returns failure when reconciler throws', async () => {
        query.mockReturnValue([]);
        reconcileAll.mockRejectedValue(new Error('db connection lost'));
        const starter = createRecordingAutoStarter({ query, suspendOffline, reconcileAll, logger });

        const result = await starter.autoStart();

        expect(result).toMatchObject({ success: false, error: 'db connection lost' });
        expect(logger.error).toHaveBeenCalled();
    });

    it('still queries offline cameras even when none are eligible', async () => {
        query.mockReturnValue([]);
        reconcileAll.mockResolvedValue({ results: [] });
        const starter = createRecordingAutoStarter({ query, suspendOffline, reconcileAll, logger });

        await starter.autoStart();

        expect(suspendOffline).not.toHaveBeenCalled();
        expect(reconcileAll).toHaveBeenCalledWith('auto_start');
    });

    it('rejects construction with missing callbacks', () => {
        expect(() => createRecordingAutoStarter({ query, reconcileAll })).toThrow(/suspendOffline/);
        expect(() => createRecordingAutoStarter({ query, suspendOffline })).toThrow(/reconcileAll/);
    });
});
