// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ViewerAnalytics, { DailyDetailModal } from './ViewerAnalytics';

const { getViewerAnalytics, getRealTimeViewers } = vi.hoisted(() => ({
    getViewerAnalytics: vi.fn(),
    getRealTimeViewers: vi.fn(),
}));

vi.mock('../services/adminService', () => ({
    adminService: {
        getViewerAnalytics,
        getRealTimeViewers,
    },
}));

vi.mock('../components/RealtimeChart', () => ({
    RealtimeActivityChart: () => <div>realtime-chart</div>,
}));

vi.mock('../components/RetentionMetrics', () => ({
    RetentionMetrics: () => <div>retention-metrics</div>,
}));

vi.mock('../components/CameraPerformanceTable', () => ({
    CameraPerformanceTable: () => <div>camera-performance</div>,
}));

vi.mock('../components/ActivityHeatmap', () => ({
    ActivityHeatmap: ({ onCellClick }) => <button onClick={() => onCellClick({ hour: 10 })}>open-heatmap</button>,
    HeatmapDetailModal: ({ onClose }) => <button onClick={onClose}>heatmap-modal</button>,
}));

function buildAnalyticsData() {
    return {
        overview: {
            activeViewers: 2,
            uniqueVisitors: 12,
            totalSessions: 20,
            totalWatchTime: 3600,
            avgSessionDuration: 180,
            longestSession: 900,
        },
        comparison: { trends: { uniqueVisitors: 10, totalWatchTime: 5 } },
        retention: { returningVisitorsRate: 50 },
        charts: {
            sessionsByDay: [
                { date: '2026-03-05', sessions: 5 },
                { date: '2026-03-06', sessions: 7 },
            ],
            sessionsByHour: [
                { hour: 9, sessions: 3 },
                { hour: 10, sessions: 5 },
            ],
            activityHeatmap: [{ day: 1, hour: 10, count: 2 }],
        },
        topCameras: [
            { camera_id: 1, camera_name: 'Lobby', total_views: 10, unique_viewers: 4, total_watch_time: 1200 },
            { camera_id: 2, camera_name: 'Gate', total_views: 7, unique_viewers: 3, total_watch_time: 900 },
        ],
        deviceBreakdown: [
            { device_type: 'mobile', count: 8, percentage: 60 },
            { device_type: 'desktop', count: 5, percentage: 40 },
        ],
        topVisitors: [
            { ip_address: '10.0.0.1', total_sessions: 4, cameras_watched: 2, total_watch_time: 800 },
        ],
        peakHours: [
            { hour: 10, sessions: 8, unique_visitors: 5 },
            { hour: 11, sessions: 6, unique_visitors: 4 },
        ],
        cameraPerformance: [{ camera_id: 1, camera_name: 'Lobby' }],
        recentSessions: Array.from({ length: 20 }).map((_, index) => ({
            id: index + 1,
            camera_id: index < 10 ? 1 : 2,
            camera_name: index < 10 ? 'Lobby' : 'Gate',
            ip_address: `10.0.0.${index + 1}`,
            device_type: index % 2 === 0 ? 'mobile' : 'desktop',
            started_at: `2026-03-0${index % 2 === 0 ? 5 : 6}T10:0${index % 5}:00.000Z`,
            duration_seconds: 120 + index,
        })),
    };
}

describe('ViewerAnalytics', () => {
    beforeEach(() => {
        getViewerAnalytics.mockReset();
        getRealTimeViewers.mockReset();
        getViewerAnalytics.mockResolvedValue({ success: true, data: buildAnalyticsData() });
        getRealTimeViewers.mockResolvedValue({
            success: true,
            data: {
                activeSessions: [
                    {
                        sessionId: 'active-1',
                        cameraName: 'Lobby',
                        ipAddress: '127.0.0.1',
                        durationSeconds: 120,
                        deviceType: 'desktop',
                    },
                ],
            },
        });
    });

    it('memanggil ulang analytics saat periode berubah', async () => {
        render(<ViewerAnalytics />);

        await screen.findByText('Statistik Penonton');
        fireEvent.click(screen.getByRole('button', { name: '30 Hari' }));

        await waitFor(() => {
            expect(getViewerAnalytics).toHaveBeenLastCalledWith('30days');
        });
    });

    it('memfilter sesi berdasarkan kamera tanpa mengubah summary global', async () => {
        render(<ViewerAnalytics />);

        await screen.findByText('Pengunjung Unik');
        fireEvent.change(screen.getByDisplayValue('Semua Kamera'), { target: { value: '2' } });

        const sessionsSection = screen.getByText('Sesi Terbaru').closest('.bg-white');

        await waitFor(() => {
            expect(screen.getByText(/Menampilkan 10 dari 10 sesi/)).toBeTruthy();
        });

        expect(screen.getByText('12')).toBeTruthy();
        expect(within(sessionsSection).queryByText('10.0.0.1')).toBeNull();
        expect(within(sessionsSection).getByText('10.0.0.11')).toBeTruthy();
    });

    it('membuka modal detail saat bar chart harian diklik', async () => {
        render(<ViewerAnalytics />);

        await screen.findByText('Sesi per Hari');
        const chartSection = screen.getByText('Sesi per Hari').closest('.bg-white');
        fireEvent.click(within(chartSection).getByText(/6$/));

        await waitFor(() => {
            expect(screen.getByText(/Detail Tanggal/i)).toBeTruthy();
        });
    });
});

describe('DailyDetailModal', () => {
    it('rerenders from hidden to visible without breaking hook order', () => {
        const sessions = [
            {
                started_at: '2026-03-05T10:00:00.000Z',
                ip_address: '127.0.0.1',
                duration_seconds: 120,
                sessionId: 'session-1',
                location: 'Jakarta',
                deviceType: 'desktop',
                viewerName: 'Operator',
                cameraName: 'Lobby',
                durationSeconds: 120,
                camera_name: 'Lobby',
                device_type: 'desktop',
            },
        ];

        const { rerender } = render(<DailyDetailModal date={null} sessions={sessions} onClose={() => {}} />);

        expect(screen.queryByText(/Detail Tanggal/i)).toBeNull();

        rerender(<DailyDetailModal date="2026-03-05" sessions={sessions} onClose={() => {}} />);

        expect(screen.getByText(/Detail Tanggal/i)).toBeTruthy();
        expect(screen.getByText(/1 sesi/i)).toBeTruthy();
    });
});
