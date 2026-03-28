// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackAnalytics from './PlaybackAnalytics';

const {
    getPlaybackViewerAnalyticsMock,
    getPlaybackViewerActiveMock,
    getAllCamerasMock,
} = vi.hoisted(() => ({
    getPlaybackViewerAnalyticsMock: vi.fn(),
    getPlaybackViewerActiveMock: vi.fn(),
    getAllCamerasMock: vi.fn(),
}));

vi.mock('../services/adminService', () => ({
    adminService: {
        getPlaybackViewerAnalytics: getPlaybackViewerAnalyticsMock,
        getPlaybackViewerActive: getPlaybackViewerActiveMock,
    },
}));

vi.mock('../services/cameraService', () => ({
    cameraService: {
        getAllCameras: getAllCamerasMock,
    },
}));

vi.mock('../hooks/admin/useAdminReconnectRefresh', () => ({
    useAdminReconnectRefresh: () => {},
}));

describe('PlaybackAnalytics', () => {
    beforeEach(() => {
        getPlaybackViewerAnalyticsMock.mockReset();
        getPlaybackViewerActiveMock.mockReset();
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

        await waitFor(() => {
            expect(screen.getByText('Viewer Playback Aktif')).toBeTruthy();
        });

        expect(getPlaybackViewerAnalyticsMock).toHaveBeenCalledWith('7days', {}, expect.anything());
        expect(getPlaybackViewerActiveMock).toHaveBeenCalledWith({}, expect.anything());
        expect(screen.getAllByText('Lobby').length).toBeGreaterThan(0);

        fireEvent.change(screen.getByLabelText('Akses'), { target: { value: 'admin_full' } });

        await waitFor(() => {
            expect(getPlaybackViewerAnalyticsMock).toHaveBeenLastCalledWith(
                '7days',
                { cameraId: undefined, accessMode: 'admin_full' },
                expect.anything()
            );
        });
    });
});
