import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraRuntimeStateService from '../services/cameraRuntimeStateService.js';

describe('cameraRuntimeStateService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('creates a seeded runtime row when state does not exist', () => {
        // hasRuntimeTable() memoizes into the singleton, so whether it consumes a queryOne
        // call depends on which test ran first. Without this reset the mock sequence below
        // means something different in a full-suite run than it does in a focused one —
        // which is exactly how this passed alone and failed in the suite.
        cameraRuntimeStateService.tableSupport = null;
        const queryOneSpy = vi.spyOn(connectionPool, 'queryOne');
        const executeSpy = vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });

        queryOneSpy
            .mockReturnValueOnce({ name: 'camera_runtime_state' })
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce({
                camera_id: 12,
                is_online: 1,
                monitoring_state: 'online',
                monitoring_reason: 'seed_from_camera',
            })
            // TERMINAL DEFAULT, and it is load-bearing. `vi.spyOn` keeps calling THROUGH to the
            // real function once the `Once` queue is exhausted — so a fourth queryOne here does
            // not return undefined, it queries the developer's actual backend/data/cctv.db.
            // That is how this test failed intermittently: whether the queue ran dry depended on
            // test ordering under load, and what came back depended on whatever rows happened to
            // be in that database. Proven the hard way — with real cameras seeded locally it
            // returned a monitoring_reason that CHANGED between runs.
            .mockReturnValue(undefined);

        const state = cameraRuntimeStateService.ensureRuntimeState(12, {
            is_online: 1,
            monitoring_state: 'online',
        });

        expect(executeSpy).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO camera_runtime_state'),
            expect.arrayContaining([12, 1, 'online'])
        );
        expect(state).toMatchObject({
            camera_id: 12,
            is_online: 1,
            monitoring_state: 'online',
        });
    });

    /*
     * REGRESSION (production: 22 x "[CameraHealth] Check failed: Cannot read
     * properties of undefined (reading 'last_runtime_signal_at')").
     *
     * cameraHealthService calls upsertRuntimeState for every camera from INSIDE a
     * transaction(). connectionPool holds separate read and write connections, so
     * within that transaction the read connection CANNOT see the row the write
     * connection just inserted — for a camera with no runtime row yet this is a
     * certainty, not a race. ensureRuntimeState then returned undefined, and
     * upsertRuntimeState dereferenced it.
     *
     * The blast radius was the whole sweep: the health check's try/catch wraps the
     * entire tick, and the upserts share one transaction, so a single camera in
     * this state rolled back every camera's state and left the rest unchecked.
     */
    it('REGRESSION: returns the written row even when the read-back cannot see it', () => {
        // hasRuntimeTable() memoizes into the singleton, so whether it consumes a
        // queryOne call depends on test order. Reset it to make the mock sequence
        // below mean the same thing however this file is run.
        cameraRuntimeStateService.tableSupport = null;
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce({ name: 'camera_runtime_state' }) // hasRuntimeTable
            .mockReturnValueOnce(undefined)                        // existing row: none
            .mockReturnValueOnce(undefined)                        // read-back: invisible in-transaction
            .mockReturnValue(undefined);                           // never fall through to the real DB

        const state = cameraRuntimeStateService.ensureRuntimeState(41, {
            is_online: 1,
            monitoring_state: 'online',
            monitoring_reason: 'probe_ok',
        });

        expect(state).toBeDefined();
        expect(state).toMatchObject({
            camera_id: 41,
            is_online: 1,
            monitoring_state: 'online',
            monitoring_reason: 'probe_ok',
        });
        // The field whose absence produced the production crash must be present.
        expect(state).toHaveProperty('last_runtime_signal_at', null);
    });

    it('REGRESSION: upsert survives a runtime row that cannot be read back', () => {
        // hasRuntimeTable() memoizes into the singleton, so whether it consumes a
        // queryOne call depends on test order. Reset it to make the mock sequence
        // below mean the same thing however this file is run.
        cameraRuntimeStateService.tableSupport = null;
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce({ name: 'camera_runtime_state' }) // hasRuntimeTable
            .mockReturnValueOnce(undefined)                        // existing row: none
            .mockReturnValueOnce(undefined)                        // read-back: invisible
            .mockReturnValue(undefined);                           // any later reads

        // These are exactly the fields cameraHealthService passes — note it never
        // sends last_runtime_signal_at, which is why that was the field that threw.
        expect(() => cameraRuntimeStateService.upsertRuntimeState(41, {
            is_online: 1,
            monitoring_state: 'online',
            monitoring_reason: 'probe_ok',
            last_health_check_at: '2026-08-03 00:00:00',
        })).not.toThrow();
    });

    it('upserts runtime state with latest health metadata', () => {
        vi.spyOn(connectionPool, 'queryOne')
            .mockReturnValueOnce({ name: 'camera_runtime_state' })
            .mockReturnValue({
                camera_id: 8,
                is_online: 0,
                monitoring_state: 'offline',
                monitoring_reason: 'seed_from_camera',
                last_runtime_signal_at: null,
                last_runtime_signal_type: null,
                last_health_check_at: null,
            });
        const executeSpy = vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });

        const result = cameraRuntimeStateService.upsertRuntimeState(8, {
            is_online: 1,
            monitoring_state: 'online',
            monitoring_reason: 'health_check_online',
            last_runtime_signal_at: '2026-03-30 08:10:00',
            last_runtime_signal_type: 'external_flv_runtime_playing',
            last_health_check_at: '2026-03-30 08:10:00',
        });

        expect(executeSpy).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT(camera_id) DO UPDATE'),
            expect.arrayContaining([
                8,
                1,
                'online',
                'health_check_online',
                '2026-03-30 08:10:00',
                'external_flv_runtime_playing',
                '2026-03-30 08:10:00',
            ])
        );
        expect(result).toMatchObject({
            is_online: 1,
            monitoring_state: 'online',
            monitoring_reason: 'health_check_online',
            last_runtime_signal_type: 'external_flv_runtime_playing',
        });
    });
});
