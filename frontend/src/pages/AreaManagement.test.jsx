// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AreaManagement from './AreaManagement';

const {
    getAdminOverview,
    createArea,
    updateArea,
    deleteArea,
    bulkUpdateByArea,
    bulkDeleteByArea,
    getMapCenter,
} = vi.hoisted(() => ({
    getAdminOverview: vi.fn(),
    createArea: vi.fn(),
    updateArea: vi.fn(),
    deleteArea: vi.fn(),
    bulkUpdateByArea: vi.fn(),
    bulkDeleteByArea: vi.fn(),
    getMapCenter: vi.fn(),
}));

vi.mock('../services/areaService', () => ({
    areaService: {
        getAdminOverview,
        createArea,
        updateArea,
        deleteArea,
    },
}));

vi.mock('../services/cameraService', () => ({
    cameraService: {
        bulkUpdateByArea,
        bulkDeleteByArea,
    },
}));

vi.mock('../services/settingsService', () => ({
    settingsService: {
        getMapCenter,
        updateMapCenter: vi.fn(),
    },
}));

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock('../components/LocationPicker', () => ({
    default: () => <div>mock-location-picker</div>,
}));

describe('AreaManagement', () => {
    beforeEach(() => {
        getAdminOverview.mockReset();
        createArea.mockReset();
        updateArea.mockReset();
        deleteArea.mockReset();
        bulkUpdateByArea.mockReset();
        bulkDeleteByArea.mockReset();
        getMapCenter.mockReset();

        getAdminOverview.mockResolvedValue({
            success: true,
            data: [{
                id: 1,
                name: 'Area A',
                description: 'Area uji',
                kecamatan: 'Kecamatan A',
                kelurahan: 'Kelurahan A',
                cameraCount: 4,
                onlineCount: 2,
                offlineCount: 2,
                internalValidCount: 1,
                externalValidCount: 3,
                externalUnresolvedCount: 0,
                recordingEnabledCount: 1,
                coverage_scope: 'default',
                viewport_zoom_override: null,
                external_health_mode_override: 'default',
                show_on_grid_default: 1,
                topReasons: [],
            }],
        });
        getMapCenter.mockResolvedValue({ success: true, data: { latitude: -7.1, longitude: 111.9, zoom: 13, name: 'Bojonegoro' } });
        updateArea.mockResolvedValue({
            success: true,
            data: {
                id: 1,
                show_on_grid_default: 0,
            },
        });
        bulkUpdateByArea.mockResolvedValue({
            success: true,
            data: {
                targetFilter: 'external_hls_only',
                summary: {
                    totalInArea: 4,
                    matchedCount: 3,
                    eligibleCount: 3,
                    blockedCount: 0,
                    unresolvedCount: 0,
                    recordingEnabledCount: 1,
                    blockedReasons: [],
                    examples: [],
                    blockedExamples: [],
                },
            },
        });
        bulkDeleteByArea.mockResolvedValue({ success: true, data: { deletedCount: 4 } });
    });

    it('menampilkan total kamera dari overview tunggal', async () => {
        render(
            <MemoryRouter>
                <AreaManagement />
            </MemoryRouter>
        );

        await screen.findByText('Area A');
        expect(screen.getByText('4 Kamera')).toBeTruthy();
        expect(getAdminOverview).toHaveBeenCalled();
    });

    it('memaksa preview proxy policy ke target external_hls_only', async () => {
        render(
            <MemoryRouter>
                <AreaManagement />
            </MemoryRouter>
        );

        await screen.findByText('Area A');
        fireEvent.click(screen.getByTitle('Pengaturan Massal Kamera'));

        const proxyField = screen.getByText('Gunakan Proxy Server').closest('div');
        fireEvent.change(proxyField.querySelector('select'), { target: { value: '1' } });

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        await waitFor(() => {
            expect(bulkUpdateByArea).toHaveBeenCalledWith(1, expect.objectContaining({
                preview: true,
                targetFilter: 'external_hls_only',
                operation: 'policy_update',
                payload: expect.objectContaining({
                    external_use_proxy: 1,
                }),
            }));
        });
    });

    it('memaksa preview health policy ke target external_streams_only', async () => {
        render(
            <MemoryRouter>
                <AreaManagement />
            </MemoryRouter>
        );

        await screen.findByText('Area A');
        fireEvent.click(screen.getByTitle('Pengaturan Massal Kamera'));

        fireEvent.change(screen.getByLabelText('Health Monitoring'), { target: { value: 'passive_first' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        await waitFor(() => {
            expect(bulkUpdateByArea).toHaveBeenCalledWith(1, expect.objectContaining({
                preview: true,
                targetFilter: 'external_streams_only',
                operation: 'policy_update',
                payload: expect.objectContaining({
                    external_health_mode: 'passive_first',
                }),
            }));
        });
    });

    it('menampilkan dan mengubah toggle grid default langsung dari kartu area', async () => {
        render(
            <MemoryRouter>
                <AreaManagement />
            </MemoryRouter>
        );

        await screen.findByText('Grid View Default');
        expect(screen.getByText('Area aktif')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Grid Default Aktif/i })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Grid Default Aktif/i }));

        await waitFor(() => {
            expect(updateArea).toHaveBeenCalledWith(1, expect.objectContaining({
                name: 'Area A',
                show_on_grid_default: false,
            }));
        });
    });
});
