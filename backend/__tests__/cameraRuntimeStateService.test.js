import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraRuntimeStateService from '../services/cameraRuntimeStateService.js';

describe('cameraRuntimeStateService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('creates a seeded runtime row when state does not exist', () => {
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
            });

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
