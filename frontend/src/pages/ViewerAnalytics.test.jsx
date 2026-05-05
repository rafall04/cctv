// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ViewerAnalytics, { DailyDetailModal } from './ViewerAnalytics';

const {
    getViewerAnalytics,
    getRealTimeViewers,
    getViewerHistory,
    getAllCameras,
} = vi.hoisted(() => ({
    getViewerAnalytics: vi.fn(),
    getRealTimeViewers: vi.fn(),
    getViewerHistory: vi.fn(),
    getAllCameras: vi.fn(),
}));

vi.mock('../services/adminService', () => ({
    adminService: {
        getViewerAnalytics,
        getRealTimeViewers,
        getViewerHistory,
    },
}));

vi.mock('../services/cameraService', () => ({
    cameraService: {
        getAllCameras,
    },
}));

vi.mock('../contexts/TimezoneContext', () => ({
    TIMESTAMP_STORAGE: {
        LOCAL_SQL: 'local_sql',
        UTC_SQL: 'utc_sql',
        AUTO: 'auto',
    },
    useTimezone: () => ({
        timezone: 'Asia/Jakarta',
        formatDateTime: (value) => `fmt:${value}`,
        formatDate: (value) => `date:${value}`,
        formatTime: (value) => `time:${value}`,
    }),
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
        getViewerHistory.mockReset();
        getAllCameras.mockReset();
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
        getViewerHistory.mockImplementation((query = {}) => Promise.resolve({
            success: true,
            data: {
                items: [
                    {
                        id: query.page === 2 ? 22 : 11,
                        camera_id: 2,
                        camera_name: query.page === 2 ? 'Page Two Camera' : 'Gate',
                        ip_address: '10.0.0.11',
                        device_type: 'desktop',
                        started_at: '2026-03-06T10:01:00.000Z',
                        ended_at: '2026-03-06T10:06:00.000Z',
                        duration_seconds: 300,
                        user_agent: 'test-agent',
                    },
                ],
                pagination: { page: query.page || 1, pageSize: query.pageSize || 25, totalItems: 60, totalPages: 3 },
                summary: { totalItems: 60, uniqueViewers: 1, totalWatchTime: 300 },
            },
        }));
        getAllCameras.mockResolvedValue({
            success: true,
            data: [
                { id: 1, name: 'Lobby' },
                { id: 2, name: 'Gate' },
            ],
        });
    });

    it('memanggil ulang analytics saat periode berubah', async () => {
        render(<ViewerAnalytics />);

        await screen.findByText('Statistik Penonton');
        fireEvent.click(screen.getByRole('button', { name: '30 Hari' }));

        await waitFor(() => {
            expect(getViewerAnalytics).toHaveBeenLastCalledWith('30days', 'blocking');
        });
    });

    it('memuat tab history dari endpoint server-side dan filter kamera ikut dikirim', async () => {
        render(<ViewerAnalytics />);

        await screen.findByText('Statistik Penonton');
        fireEvent.click(screen.getByRole('button', { name: 'History' }));

        await waitFor(() => {
            expect(screen.getByText('Riwayat Sesi Live')).toBeTruthy();
        });

        fireEvent.change(screen.getAllByDisplayValue('Semua Kamera')[0], { target: { value: '2' } });

        await waitFor(() => {
            expect(getViewerHistory).toHaveBeenLastCalledWith(expect.objectContaining({
                cameraId: '2',
            }), 'blocking');
        });

        expect(screen.getByText('Riwayat Sesi Live')).toBeTruthy();
    });

    it('menampilkan sesi aktif pada tab active', async () => {
        render(<ViewerAnalytics />);

        await screen.findByText('Statistik Penonton');
        fireEvent.click(screen.getByRole('button', { name: 'Active' }));

        await waitFor(() => {
            expect(screen.getByText('Viewer Aktif')).toBeTruthy();
        });

        expect(screen.getByText('127.0.0.1')).toBeTruthy();
    });

    it('tetap menampilkan history page 2 setelah pagination diklik', async () => {
        render(<ViewerAnalytics />);

        await screen.findByText('Statistik Penonton');
        fireEvent.click(screen.getByRole('button', { name: 'History' }));

        await screen.findByText('Riwayat Sesi Live');
        fireEvent.click(screen.getByRole('button', { name: '2' }));

        await waitFor(() => {
            expect(getViewerHistory).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), 'blocking');
        });
        await waitFor(() => {
            expect(screen.getByText('Page Two Camera')).toBeTruthy();
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
