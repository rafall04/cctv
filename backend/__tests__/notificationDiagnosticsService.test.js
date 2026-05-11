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
                health_status: 'online',
                last_checked_at: '2026-05-11 10:00:00',
                last_error: null,
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
            .mockReturnValueOnce({ camera_id: 5, health_status: 'online' });
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
