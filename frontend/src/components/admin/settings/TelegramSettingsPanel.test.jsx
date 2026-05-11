// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TelegramSettingsPanel from './TelegramSettingsPanel';
import { adminService } from '../../../services/adminService';
import { areaService } from '../../../services/areaService';

vi.mock('../../../services/adminService', () => ({
    adminService: {
        getTelegramStatus: vi.fn(),
        updateTelegramConfig: vi.fn(),
        testTelegramNotification: vi.fn(),
    },
}));

vi.mock('../../../services/areaService', () => ({
    areaService: {
        getAllAreas: vi.fn(),
    },
}));

const statusPayload = {
    enabled: true,
    monitoringConfigured: false,
    cameraMonitoringConfigured: true,
    feedbackConfigured: false,
    botToken: '123456789...',
    monitoringChatId: '',
    feedbackChatId: '',
    notificationTargets: [
        { id: 'area-bojonegoro', name: 'Area Bojonegoro', chatId: '-100-area', enabled: true },
    ],
    notificationRules: [
        {
            id: 'rule-area',
            enabled: true,
            targetId: 'area-bojonegoro',
            scope: 'area',
            areaId: 7,
            cameraId: null,
            events: ['offline'],
            ingestModes: ['always_on'],
        },
    ],
    notificationRuleIssues: [],
};

describe('TelegramSettingsPanel', () => {
    beforeEach(() => {
        adminService.getTelegramStatus.mockResolvedValue({ success: true, data: statusPayload });
        adminService.updateTelegramConfig.mockResolvedValue({ success: true, data: statusPayload });
        adminService.testTelegramNotification.mockResolvedValue({ success: true, message: 'ok' });
        areaService.getAllAreas.mockResolvedValue({
            success: true,
            data: [{ id: 7, name: 'KAB BOJONEGORO' }],
        });
    });

    it('shows custom-only camera monitoring as active', async () => {
        render(<TelegramSettingsPanel />);

        expect(await screen.findByText('Telegram Bot')).toBeTruthy();
        expect(screen.getByText('Multi Grup Monitoring')).toBeTruthy();
        expect(screen.getByText('Routing Policy')).toBeTruthy();
        expect(screen.getAllByText('AKTIF').length).toBeGreaterThan(0);
    });

    it('sends a test notification to a custom target', async () => {
        render(<TelegramSettingsPanel />);

        expect(await screen.findByText('Area Bojonegoro')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Test Area Bojonegoro' }));

        await waitFor(() => {
            expect(adminService.testTelegramNotification).toHaveBeenCalledWith('target', {
                targetId: 'area-bojonegoro',
            });
        });
    });

    it('saves the masked token unchanged so backend can preserve the full token', async () => {
        render(<TelegramSettingsPanel />);

        fireEvent.click(await screen.findByText('Edit'));
        fireEvent.click(screen.getByText('Simpan'));

        await waitFor(() => {
            expect(adminService.updateTelegramConfig).toHaveBeenCalledWith(
                expect.objectContaining({ botToken: '123456789...' })
            );
        });
    });
});
