// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportExport from './ImportExport';

const {
    exportCameras,
    previewImportCameras,
    importCameras,
} = vi.hoisted(() => ({
    exportCameras: vi.fn(),
    previewImportCameras: vi.fn(),
    importCameras: vi.fn(),
}));

vi.mock('../../services/cameraService', () => ({
    cameraService: {
        exportCameras,
        previewImportCameras,
        importCameras,
    },
}));

vi.mock('../../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

describe('ImportExport', () => {
    beforeEach(() => {
        class MockFileReader {
            readAsText() {
                this.onload({
                    target: {
                        result: JSON.stringify({
                            targetArea: 'SURABAYA',
                            sourceProfile: 'internal_rtsp_live_only',
                            cameras: [
                                {
                                    name: 'A. YANI - JEMURSARI',
                                    private_rtsp_url: 'rtsp://user:pass@host:554/Streaming/Channels/402',
                                    source_tag: 'surabaya_private_rtsp',
                                },
                            ],
                        }),
                    },
                });
            }
        }
        vi.stubGlobal('FileReader', MockFileReader);
        exportCameras.mockReset();
        previewImportCameras.mockReset();
        importCameras.mockReset();

        previewImportCameras.mockResolvedValue({
            success: true,
            data: {
                canImport: true,
                fieldMapping: { name: 'nama' },
                sourceStats: {
                    totalRows: 61,
                    onlineCount: 59,
                    offlineCount: 2,
                    missingCoordsCount: 0,
                    duplicateUrlCount: 0,
                    categoryBreakdown: [{ category: 'Persimpangan', count: 36 }],
                },
                summary: {
                    totalRows: 61,
                    importableCount: 61,
                    duplicateCount: 0,
                    invalidCount: 0,
                    filteredOutCount: 0,
                    deliveryTypeBreakdown: [{ deliveryType: 'external_mjpeg', count: 61 }],
                },
                rows: [
                    {
                        index: 0,
                        resolvedName: 'Perempatan A',
                        resolvedDeliveryType: 'external_mjpeg',
                        resolvedUrl: 'https://example.com/mjpeg',
                        resolvedHealthMode: 'passive_first',
                        resolvedTlsMode: 'strict',
                        status: 'importable',
                        reason: null,
                    },
                ],
                warnings: [{ code: 'jombang_tokenized_source', count: 1, message: 'tokenized' }],
            },
        });
    });

    it('prefills target area from query string and previews remote Jombang preset', async () => {
        render(
            <MemoryRouter initialEntries={['/admin/import-export?area=Jombang']}>
                <ImportExport />
            </MemoryRouter>
        );

        expect(screen.getByDisplayValue('Jombang')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Commit Import to DB' }).disabled).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Remote Source Preset' }));
        fireEvent.click(screen.getByRole('button', { name: 'Preview Import' }));

        await waitFor(() => {
            expect(previewImportCameras).toHaveBeenCalledWith(expect.objectContaining({
                targetArea: 'Jombang',
                sourceProfile: 'jombang_mjpeg',
                globalOverrides: expect.objectContaining({
                    external_health_mode: 'passive_first',
                    external_tls_mode: 'strict',
                    external_use_proxy: 1,
                }),
            }));
        });

        await screen.findByText('Perempatan A');
        expect(screen.getByRole('button', { name: 'Commit Import to DB' }).disabled).toBe(false);
    });

    it('menandai profile private RTSP sebagai internal live-only saat preview upload JSON', async () => {
        previewImportCameras.mockResolvedValueOnce({
            success: true,
            data: {
                canImport: true,
                fieldMapping: { streamUrl: 'private_rtsp_url (private only)' },
                sourceStats: {
                    totalRows: 1,
                    onlineCount: 0,
                    offlineCount: 0,
                    missingCoordsCount: 1,
                    duplicateUrlCount: 0,
                    categoryBreakdown: [{ category: 'surabaya_private_rtsp', count: 1 }],
                },
                summary: {
                    totalRows: 1,
                    importableCount: 1,
                    duplicateCount: 0,
                    invalidCount: 0,
                    filteredOutCount: 0,
                    deliveryTypeBreakdown: [{ deliveryType: 'internal_hls', count: 1 }],
                },
                rows: [
                    {
                        index: 0,
                        resolvedName: 'A. YANI - JEMURSARI',
                        resolvedDeliveryType: 'internal_hls',
                        resolvedStreamSource: 'internal',
                        resolvedRecordingEnabled: 0,
                        resolvedUrl: 'rtsp://user:***@host:554/Streaming/Channels/402',
                        resolvedHealthMode: 'default',
                        resolvedTlsMode: 'strict',
                        status: 'importable',
                        reason: null,
                    },
                ],
                warnings: [{ code: 'private_rtsp_live_only', count: 1, message: 'private-only' }],
            },
        });

        render(
            <MemoryRouter initialEntries={['/admin/import-export?area=Surabaya']}>
                <ImportExport />
            </MemoryRouter>
        );

        fireEvent.change(screen.getByLabelText('Import Profile'), {
            target: { value: 'internal_rtsp_live_only' },
        });

        fireEvent.change(screen.getByLabelText('Upload JSON'), {
            target: {
                files: [new File(['{}'], 'surabaya-private.json', { type: 'application/json' })],
            },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Preview Import' }));

        await waitFor(() => {
            expect(previewImportCameras).toHaveBeenCalledWith(expect.objectContaining({
                sourceProfile: 'internal_rtsp_live_only',
                globalOverrides: expect.objectContaining({
                    delivery_type: 'internal_hls',
                }),
            }));
        });

        expect(screen.getByText(/private rtsp seperti surabaya/i)).toBeTruthy();
        expect(screen.getByText(/internal • live only/i)).toBeTruthy();
    });
});
