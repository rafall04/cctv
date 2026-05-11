// @vitest-environment jsdom

/*
 * Purpose: Verify admin Telegram notification diagnostics page workflow.
 * Caller: Vitest frontend suite for pages/NotificationDiagnostics.jsx.
 * Deps: React Testing Library, mocked adminService and cameraService.
 * MainFuncs: NotificationDiagnostics tests.
 * SideEffects: Renders jsdom UI only; no real API calls.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationDiagnostics from './NotificationDiagnostics';
import { adminService } from '../services/adminService';
import { cameraService } from '../services/cameraService';

vi.mock('../services/adminService', () => ({
    adminService: {
        previewNotificationDiagnostics: vi.fn(),
        runNotificationDiagnosticsDrill: vi.fn(),
        getNotificationDiagnosticsRuns: vi.fn(),
    },
}));

vi.mock('../services/cameraService', () => ({
    cameraService: {
        getAllCameras: vi.fn(),
    },
}));

describe('NotificationDiagnostics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cameraService.getAllCameras.mockResolvedValue({
            success: true,
            data: [{ id: 5, name: 'Gate 1', area_name: 'North' }],
        });
        adminService.getNotificationDiagnosticsRuns.mockResolvedValue({ success: true, data: [] });
    });

    it('previews routing and enables drill when Telegram target matches', async () => {
        adminService.previewNotificationDiagnostics.mockResolvedValue({
            success: true,
            data: {
                camera: { id: 5, name: 'Gate 1', areaName: 'North' },
                health: { status: 'online', lastCheckedAt: '2026-05-11 10:00:00' },
                eventType: 'offline',
                routing: {
                    canSend: true,
                    matchedTargets: [{ id: 'north', name: 'North Group', chatIdMasked: '-10***001' }],
                    matchedRules: [{ id: 'north-offline', targetName: 'North Group', scope: 'area' }],
                    unmatchedRules: [],
                    ruleIssues: [],
                },
            },
        });

        render(<NotificationDiagnostics />);

        fireEvent.change(await screen.findByLabelText(/CCTV/i), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /Preview Routing/i }));

        expect(await screen.findByText('North Group')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Kirim Drill Offline/i }).disabled).toBe(false);
    });

    it('keeps drill disabled when no Telegram target matches', async () => {
        adminService.previewNotificationDiagnostics.mockResolvedValue({
            success: true,
            data: {
                camera: { id: 5, name: 'Gate 1', areaName: 'North' },
                health: { status: 'online' },
                eventType: 'offline',
                routing: {
                    canSend: false,
                    skippedReason: 'NO_MATCHING_TARGET',
                    matchedTargets: [],
                    matchedRules: [],
                    unmatchedRules: [],
                    ruleIssues: [],
                },
            },
        });

        render(<NotificationDiagnostics />);

        fireEvent.change(await screen.findByLabelText(/CCTV/i), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /Preview Routing/i }));

        expect(await screen.findByText(/NO_MATCHING_TARGET/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Kirim Drill Offline/i }).disabled).toBe(true);
    });

    it('runs drill and refreshes recent diagnostics', async () => {
        adminService.previewNotificationDiagnostics.mockResolvedValue({
            success: true,
            data: {
                camera: { id: 5, name: 'Gate 1', areaName: 'North' },
                health: { status: 'online' },
                eventType: 'offline',
                routing: {
                    canSend: true,
                    matchedTargets: [{ id: 'north', name: 'North Group', chatIdMasked: '-10***001' }],
                    matchedRules: [],
                    unmatchedRules: [],
                    ruleIssues: [],
                },
            },
        });
        adminService.runNotificationDiagnosticsDrill.mockResolvedValue({ success: true, data: { success: true } });
        adminService.getNotificationDiagnosticsRuns
            .mockResolvedValueOnce({ success: true, data: [] })
            .mockResolvedValueOnce({
                success: true,
                data: [{ id: 1, cameraName: 'Gate 1', eventType: 'offline', success: true, targetCount: 1, sentCount: 1, createdAt: '2026-05-11 10:01:00' }],
            });

        render(<NotificationDiagnostics />);

        fireEvent.change(await screen.findByLabelText(/CCTV/i), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /Preview Routing/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Kirim Drill Offline/i }));

        await waitFor(() => expect(adminService.runNotificationDiagnosticsDrill).toHaveBeenCalledWith({ cameraId: 5, eventType: 'offline' }));
        expect(await screen.findByText('Sent')).toBeTruthy();
    });
});
