// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackAnalytics from './PlaybackAnalytics';

const {
    getPlaybackViewerAnalyticsMock,
    getPlaybackViewerActiveMock,
    getPlaybackViewerHistoryMock,
    getAllCamerasMock,
} = vi.hoisted(() => ({
    getPlaybackViewerAnalyticsMock: vi.fn(),
    getPlaybackViewerActiveMock: vi.fn(),
    getPlaybackViewerHistoryMock: vi.fn(),
    getAllCamerasMock: vi.fn(),
}));

vi.mock('../services/adminService', () => ({
    adminService: {
        getPlaybackViewerAnalytics: getPlaybackViewerAnalyticsMock,
        getPlaybackViewerActive: getPlaybackViewerActiveMock,
        getPlaybackViewerHistory: getPlaybackViewerHistoryMock,
    },
}));

vi.mock('../services/cameraService', () => ({
    cameraService: {
        getAllCameras: getAllCamerasMock,
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

vi.mock('../hooks/admin/useAdminReconnectRefresh', () => ({
    useAdminReconnectRefresh: () => {},
}));

describe('PlaybackAnalytics', () => {
    beforeEach(() => {
        getPlaybackViewerAnalyticsMock.mockReset();
        getPlaybackViewerActiveMock.mockReset();
        getPlaybackViewerHistoryMock.mockReset();
        getAllCamerasMock.mockReset();

        getPlaybackViewerAnalyticsMock.mockResolvedValue({
            success: true,
            data: {
                overview: {
                    activeViewers: 2,
                    totalSessions: 12,
                    uniqueViewers: 5,
                    totalWatchTime: 1800,
                },
                accessBreakdown: [
                    { playback_access_mode: 'public_preview', count: 7 },
                    { playback_access_mode: 'admin_full', count: 5 },
                ],
                deviceBreakdown: [
                    { device_type: 'desktop', count: 6, percentage: 50 },
                ],
                topViewers: [
                    { ip_address: '127.0.0.1', total_sessions: 3, cameras_watched: 1, total_watch_time: 600 },
                ],
                topCameras: [
                    {
                        camera_id: 1,
                        camera_name: 'Lobby',
                        total_sessions: 7,
                        unique_viewers: 3,
                        total_watch_time: 900,
                    },
                ],
                topSegments: [
                    {
                        camera_id: 1,
                        camera_name: 'Lobby',
                        segment_filename: 'seg-1.mp4',
                        playback_access_mode: 'public_preview',
                        total_sessions: 4,
                        total_watch_time: 600,
                    },
                ],
                recentSessions: [
                    {
                        id: 1,
                        camera_name: 'Lobby',
                        segment_filename: 'seg-1.mp4',
                        playback_access_mode: 'admin_full',
                        ip_address: '127.0.0.1',
                        admin_username: 'admin',
                        duration_seconds: 120,
                        started_at: '2026-03-29T10:00:00.000Z',
                    },
                ],
            },
        });

        getPlaybackViewerActiveMock.mockResolvedValue({
            success: true,
            data: {
                sessions: [
                    {
                        session_id: 'session-1',
                        camera_name: 'Lobby',
                        segment_filename: 'seg-1.mp4',
                        playback_access_mode: 'public_preview',
                        ip_address: '127.0.0.1',
                        device_type: 'desktop',
                        duration_seconds: 65,
                    },
                ],
            },
        });

        getPlaybackViewerHistoryMock.mockImplementation((query = {}) => Promise.resolve({
            success: true,
            data: {
                items: [
                    {
                        id: query.page === 2 ? 2 : 1,
                        camera_name: query.page === 2 ? 'Playback Page Two' : 'Lobby',
                        segment_filename: query.page === 2 ? 'seg-2.mp4' : 'seg-1.mp4',
                        playback_access_mode: 'admin_full',
                        ip_address: '127.0.0.1',
                        admin_username: 'admin',
                        device_type: 'desktop',
                        duration_seconds: 120,
                        started_at: '2026-03-29T10:00:00.000Z',
                    },
                ],
                pagination: { page: query.page || 1, pageSize: query.pageSize || 25, totalItems: 60, totalPages: 3 },
                summary: { totalItems: 60, uniqueViewers: 1, totalWatchTime: 120 },
            },
        }));

        getAllCamerasMock.mockResolvedValue({
            success: true,
            data: [
                { id: 1, name: 'Lobby', enable_recording: 1 },
                { id: 2, name: 'Gate', enable_recording: 0 },
            ],
        });
    });

    it('memuat analytics playback dan filter akses mengirim query yang benar', async () => {
        render(<PlaybackAnalytics />);

        await waitFor(() => {
            expect(screen.getByText('Playback Analytics')).toBeTruthy();
        });

        expect(getPlaybackViewerAnalyticsMock).toHaveBeenCalledWith('7days', {}, expect.anything());
        expect(getPlaybackViewerActiveMock).toHaveBeenCalledWith({}, expect.anything());

        fireEvent.change(screen.getByLabelText('Akses'), { target: { value: 'admin_full' } });

        await waitFor(() => {
            expect(getPlaybackViewerAnalyticsMock).toHaveBeenLastCalledWith(
                '7days',
                { cameraId: undefined, accessMode: 'admin_full' },
                expect.anything()
            );
        });
    });

    it('memuat tab history dari endpoint playback history terpisah', async () => {
        render(<PlaybackAnalytics />);

        await screen.findByText('Playback Analytics');
        fireEvent.click(screen.getByRole('button', { name: 'History' }));

        await waitFor(() => {
            expect(screen.getByText('Riwayat Playback')).toBeTruthy();
        });

        expect(getPlaybackViewerHistoryMock).toHaveBeenCalledWith(expect.objectContaining({
            period: '7days',
        }), 'blocking');
        expect(screen.getByText('seg-1.mp4')).toBeTruthy();
    });

    it('tetap menampilkan playback history page 2 setelah pagination diklik', async () => {
        render(<PlaybackAnalytics />);

        await screen.findByText('Playback Analytics');
        fireEvent.click(screen.getByRole('button', { name: 'History' }));

        await screen.findByText('Riwayat Playback');
        fireEvent.click(screen.getByRole('button', { name: '2' }));

        await waitFor(() => {
            expect(getPlaybackViewerHistoryMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), 'blocking');
        });
        await waitFor(() => {
            expect(screen.getByText('seg-2.mp4')).toBeTruthy();
        });
    });
});
