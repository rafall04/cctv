// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../components/CameraStatusOverview', () => ({
    CameraStatusOverview: () => <div>camera-overview</div>,
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
    });

    it('mengubah range quick stats tanpa double-fetch dashboard utama', async () => {
        render(
            <MemoryRouter>
                <Dashboard />
            </MemoryRouter>
        );

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
});
