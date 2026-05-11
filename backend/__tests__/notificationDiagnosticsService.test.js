/**
 * Purpose: Verify admin Telegram notification diagnostics preview, drill, and audit behavior.
 * Caller: Backend Vitest suite for services/notificationDiagnosticsService.js.
 * Deps: Vitest, mocked database helpers, mocked telegramService.
 * MainFuncs: notificationDiagnosticsService tests.
 * SideEffects: Mocks database writes and Telegram sends; no real network or database access.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockQueryOne,
    mockQuery,
    mockExecute,
    mockInspectRouting,
    mockSendCameraStatusNotifications,
} = vi.hoisted(() => ({
    mockQueryOne: vi.fn(),
    mockQuery: vi.fn(),
    mockExecute: vi.fn(),
    mockInspectRouting: vi.fn(),
    mockSendCameraStatusNotifications: vi.fn(),
}));

vi.mock('../database/database.js', () => ({
    queryOne: mockQueryOne,
    query: mockQuery,
    execute: mockExecute,
}));

vi.mock('../services/telegramService.js', () => ({
    inspectCameraNotificationRouting: mockInspectRouting,
    sendCameraStatusNotifications: mockSendCameraStatusNotifications,
}));

describe('notificationDiagnosticsService', () => {
    beforeEach(() => {
        vi.resetModules();
        mockQueryOne.mockReset();
        mockQuery.mockReset();
        mockExecute.mockReset();
        mockInspectRouting.mockReset();
        mockSendCameraStatusNotifications.mockReset();
    });

    it('builds a routing preview with camera and runtime health snapshot', async () => {
        mockQueryOne
            .mockReturnValueOnce({
                id: 5,
                name: 'Gate 1',
                area_id: 10,
                area_name: 'North',
                location: 'North Gate',
                enabled: 1,
            })
            .mockReturnValueOnce({
                camera_id: 5,
                is_online: 1,
                monitoring_state: 'online',
                monitoring_reason: 'health_check_ok',
                last_runtime_signal_at: '2026-05-11 09:59:30',
                last_runtime_signal_type: 'hls_probe',
                last_health_check_at: '2026-05-11 10:00:00',
                updated_at: '2026-05-11 10:00:01',
            });
        mockInspectRouting.mockReturnValue({
            configured: true,
            canSend: true,
            skippedReason: null,
            matchedTargets: [{ id: 'north', name: 'North Group', chatIdMasked: '-10***001' }],
            matchedRules: [{ id: 'north-offline', matched: true }],
            unmatchedRules: [],
            ruleIssues: [],
        });

        const service = (await import('../services/notificationDiagnosticsService.js')).default;
        const result = service.previewCameraEvent({ cameraId: 5, eventType: 'offline' });

        expect(result.camera).toEqual(expect.objectContaining({ id: 5, name: 'Gate 1', areaName: 'North' }));
        expect(result.health).toEqual(expect.objectContaining({ status: 'online' }));
        expect(result.routing.canSend).toBe(true);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('maps the real camera_runtime_state schema into diagnostics health fields', async () => {
        const service = await import('../services/notificationDiagnosticsService.js');

        const health = service.formatRuntimeHealthForDiagnostics({
            camera_id: 5,
            is_online: 0,
            monitoring_state: 'offline',
            monitoring_reason: 'probe_timeout',
            last_runtime_signal_at: '2026-05-11 09:50:00',
            last_runtime_signal_type: 'manifest',
            last_health_check_at: '2026-05-11 10:00:00',
            updated_at: '2026-05-11 10:00:01',
        });

        expect(health).toEqual({
            status: 'offline',
            isOnline: false,
            reason: 'probe_timeout',
            lastCheckedAt: '2026-05-11 10:00:00',
            lastRuntimeSignalAt: '2026-05-11 09:50:00',
            lastRuntimeSignalType: 'manifest',
            updatedAt: '2026-05-11 10:00:01',
            lastError: 'probe_timeout',
            responseTimeMs: null,
            consecutiveFailures: 0,
        });
    });

    it('runtime state SELECT is compatible with the real camera_runtime_state columns', async () => {
        const service = await import('../services/notificationDiagnosticsService.js');
        const selectSql = service.RUNTIME_STATE_DIAGNOSTICS_SELECT;

        expect(selectSql).toContain('camera_id');
        expect(selectSql).toContain('is_online');
        expect(selectSql).toContain('monitoring_state');
        expect(selectSql).toContain('monitoring_reason');
        expect(selectSql).toContain('last_runtime_signal_at');
        expect(selectSql).toContain('last_runtime_signal_type');
        expect(selectSql).toContain('last_health_check_at');
        expect(selectSql).toContain('updated_at');
        expect(selectSql).not.toContain('health_status');
        expect(selectSql).not.toContain('last_checked_at');
        expect(selectSql).not.toContain('response_time_ms');
        expect(selectSql).not.toContain('consecutive_failures');
    });

    it('runs a drill through production camera status routing and writes audit row', async () => {
        mockQueryOne
            .mockReturnValueOnce({
                id: 5,
                name: 'Gate 1',
                area_id: 10,
                area_name: 'North',
                location: 'North Gate',
                enabled: 1,
            })
            .mockReturnValueOnce({
                camera_id: 5,
                is_online: 1,
                monitoring_state: 'online',
                monitoring_reason: 'health_check_ok',
                last_health_check_at: '2026-05-11 10:00:00',
                updated_at: '2026-05-11 10:00:01',
            });
        mockInspectRouting.mockReturnValue({
            configured: true,
            canSend: true,
            skippedReason: null,
            matchedTargets: [{ id: 'north', name: 'North Group', chatIdMasked: '-10***001' }],
            matchedRules: [{ id: 'north-offline', matched: true }],
            unmatchedRules: [],
            ruleIssues: [],
        });
        mockSendCameraStatusNotifications.mockResolvedValue(true);

        const service = (await import('../services/notificationDiagnosticsService.js')).default;
        const result = await service.runCameraEventDrill({ cameraId: 5, eventType: 'offline', userId: 99 });

        expect(result.success).toBe(true);
        expect(mockSendCameraStatusNotifications).toHaveBeenCalledWith('offline', [expect.objectContaining({ id: 5 })], {
            bypassCooldown: true,
            diagnostic: true,
        });
        expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_diagnostic_runs'), expect.arrayContaining([
            5,
            'Gate 1',
            'offline',
            'drill',
            1,
        ]));
    });

    it('does not send drill when routing preview has no matching target', async () => {
        mockQueryOne
            .mockReturnValueOnce({ id: 5, name: 'Gate 1', area_id: 10, area_name: 'North', enabled: 1 })
            .mockReturnValueOnce(null);
        mockInspectRouting.mockReturnValue({
            configured: true,
            canSend: false,
            skippedReason: 'NO_MATCHING_TARGET',
            matchedTargets: [],
            matchedRules: [],
            unmatchedRules: [],
            ruleIssues: [],
        });

        const service = (await import('../services/notificationDiagnosticsService.js')).default;
        const result = await service.runCameraEventDrill({ cameraId: 5, eventType: 'offline', userId: 99 });

        expect(result.success).toBe(false);
        expect(result.skippedReason).toBe('NO_MATCHING_TARGET');
        expect(mockSendCameraStatusNotifications).not.toHaveBeenCalled();
        expect(mockExecute).toHaveBeenCalled();
    });
});
