// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test/renderWithRouter';
import Dashboard from './Dashboard';

const { getStats } = vi.hoisted(() => ({
    getStats: vi.fn(),
}));

vi.mock('../services/adminService', () => ({
    adminService: {
        getStats,
    },
}));

vi.mock('../components/QuickStatsCards', () => ({
    QuickStatsCards: ({ dateRange }) => <div data-testid="quick-stats">{dateRange}</div>,
}));

vi.mock('../components/DateRangeSelector', () => ({
    DateRangeSelector: ({ onChange }) => (
        <div>
            <button onClick={() => onChange('7days')}>7 Hari</button>
            <button onClick={() => onChange('date:2026-03-05')}>Tanggal Kustom</button>
        </div>
    ),
}));

vi.mock('../components/TopCamerasWidget', () => ({
    TopCamerasWidget: () => <div>top-cameras</div>,
}));

describe('Dashboard', () => {
    beforeEach(() => {
        getStats.mockReset();
        getStats.mockResolvedValue({
            success: true,
            data: {
                summary: {
                    totalCameras: 2,
                    activeCameras: 2,
                    disabledCameras: 0,
                    totalAreas: 1,
                    activeViewers: 1,
                },
                system: {
                    platform: 'win32',
                    arch: 'x64',
                    cpus: 8,
                    cpuModel: 'Test CPU',
                    cpuLoad: 10,
                    totalMem: 16000,
                    freeMem: 8000,
                    usedMem: 8000,
                    memUsagePercent: 50,
                    uptime: 1000,
                    loadAvg: [0, 0, 0],
                },
                streams: [],
                recentLogs: [],
                mtxConnected: true,
                cameraStatusBreakdown: { online: 2, offline: 0, maintenance: 0 },
                topCameras: [],
                allSessions: [],
            },
        });
        vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 1);
        vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mengubah range quick stats tanpa double-fetch dashboard utama', async () => {
        renderWithRouter(<Dashboard />);

        await waitFor(() => {
            expect(screen.getByTestId('quick-stats').textContent).toBe('today');
        });
        expect(getStats).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('7 Hari'));
        expect(screen.getByTestId('quick-stats').textContent).toBe('7days');
        expect(getStats).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Tanggal Kustom'));
        expect(screen.getByTestId('quick-stats').textContent).toBe('date:2026-03-05');
        expect(getStats).toHaveBeenCalledTimes(1);
    });

    it('merefresh dashboard saat browser kembali fokus tanpa toast blocking', async () => {
        renderWithRouter(<Dashboard />);

        await waitFor(() => {
            expect(getStats).toHaveBeenCalledTimes(1);
        });

        fireEvent(window, new Event('focus'));

        await waitFor(() => {
            expect(getStats).toHaveBeenCalledTimes(2);
        });
    });

    it('menampilkan timestamp log lengkap dan hanya melaporkan status sistem yang benar-benar diukur', async () => {
        getStats.mockResolvedValueOnce({
            success: true,
            data: {
                summary: {
                    totalCameras: 2,
                    activeCameras: 2,
                    disabledCameras: 0,
                    totalAreas: 1,
                    activeViewers: 1,
                },
                system: {
                    platform: 'win32',
                    arch: 'x64',
                    cpus: 8,
                    cpuModel: 'Test CPU',
                    cpuLoad: 10,
                    totalMem: 16000,
                    freeMem: 8000,
                    usedMem: 8000,
                    memUsagePercent: 50,
                    uptime: 1000,
                    loadAvg: [0, 0, 0],
                },
                streams: [],
                recentLogs: [
                    {
                        id: 1,
                        action: 'UPDATE_CAMERA',
                        details: 'Updated camera ID: 7',
                        username: 'aldi',
                        created_at_wib: '08/03/2026 18.06.05',
                    },
                ],
                mtxConnected: true,
                cameraStatusBreakdown: { online: 2, offline: 0, maintenance: 0 },
                topCameras: [],
                allSessions: [],
            },
        });

        renderWithRouter(<Dashboard />);

        await waitFor(() => {
            expect(screen.getByText('Updated camera ID: 7')).toBeTruthy();
        });

        expect(screen.getByText('aldi')).toBeTruthy();
        expect(screen.getByText('08/03/2026 18.06.05')).toBeTruthy();

        // The panel used to list three rows but measured only one: "Database: Optimal" and
        // "API Gateway: Online" were hardcoded and said the same thing however sick the box was.
        const systemHealthCard = screen.getByText('Status Sistem').closest('div');
        expect(systemHealthCard?.className).toContain('bg-surface');
        expect(systemHealthCard?.className).not.toContain('gray-');
        expect(screen.getByText('Media server')).toBeTruthy();
        expect(screen.getByText('Terhubung').parentElement.className).toContain('status-live');
        expect(screen.queryByText('Database')).toBeNull();
        expect(screen.queryByText('API Gateway')).toBeNull();
    });

    it('mewarnai maintenance sebagai warn, bukan fault — merah hanya untuk yang benar-benar rusak', async () => {
        getStats.mockResolvedValueOnce({
            success: true,
            data: {
                summary: { totalCameras: 3, activeCameras: 2, disabledCameras: 0, totalAreas: 1, activeViewers: 0 },
                system: { cpuLoad: 5, cpuModel: 'Test CPU', totalMem: 16000, freeMem: 8000 },
                streams: [],
                recentLogs: [],
                mtxConnected: true,
                cameraStatusBreakdown: { online: 2, offline: 0, maintenance: 1 },
                topCameras: [],
                allSessions: [],
            },
        });

        renderWithRouter(<Dashboard />);

        const notice = await screen.findByText('1 kamera maintenance');
        expect(notice.closest('div').className).not.toContain('status-fault');
        expect(screen.getByText('maintenance', { selector: 'span' }).closest('span').className).not.toContain('status-fault');
    });

    it('meringkas stream aktif menjadi top 8 dan membuka drawer untuk daftar penuh', async () => {
        getStats.mockResolvedValueOnce({
            success: true,
            data: {
                summary: {
                    totalCameras: 12,
                    activeCameras: 12,
                    disabledCameras: 0,
                    totalAreas: 3,
                    activeViewers: 9,
                },
                system: {
                    platform: 'win32',
                    arch: 'x64',
                    cpus: 8,
                    cpuModel: 'Test CPU',
                    cpuLoad: 10,
                    totalMem: 16000,
                    freeMem: 8000,
                    usedMem: 8000,
                    memUsagePercent: 50,
                    uptime: 1000,
                    loadAvg: [0, 0, 0],
                },
                streams: Array.from({ length: 10 }, (_, index) => ({
                    id: index + 1,
                    name: `Stream ${index + 1}`,
                    viewers: 10 - index,
                    sessions: [],
                    bytesSent: 1024 * (index + 1),
                    bytesReceived: 512 * (index + 1),
                    operationalState: index === 8 ? 'offline' : 'online',
                    state: index === 8 ? 'offline' : 'ready',
                })),
                recentLogs: [],
                mtxConnected: true,
                cameraStatusBreakdown: { online: 10, offline: 2, maintenance: 0 },
                topCameras: [],
                allSessions: [],
            },
        });

        renderWithRouter(<Dashboard />);

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-streams-panel')).toBeTruthy();
        });

        expect(screen.getByText('Stream 1')).toBeTruthy();
        expect(screen.getByText('Stream 8')).toBeTruthy();
        expect(screen.queryByText('Stream 9')).toBeNull();
        expect(screen.getByTestId('open-streams-drawer')).toBeTruthy();

        fireEvent.click(screen.getByTestId('open-streams-drawer'));

        await waitFor(() => {
            expect(screen.getByText('Semua stream aktif')).toBeTruthy();
        });

        expect(screen.getByText('Stream 10')).toBeTruthy();
    });
});
