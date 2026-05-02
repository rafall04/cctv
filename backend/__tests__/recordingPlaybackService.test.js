import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const executeMock = vi.fn();
const startRecordingMock = vi.fn();
const stopRecordingMock = vi.fn();
const getRecordingStatusMock = vi.fn();
const getStorageUsageMock = vi.fn();
const logAdminActionMock = vi.fn();
const getPublicPlaybackSettingsMock = vi.fn();

vi.mock('../database/database.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

vi.mock('fs', () => ({
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ size: 100 })),
}));

vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        startRecording: startRecordingMock,
        stopRecording: stopRecordingMock,
        getRecordingStatus: getRecordingStatusMock,
        getStorageUsage: getStorageUsageMock,
    },
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: logAdminActionMock,
}));

vi.mock('../services/settingsService.js', () => ({
    default: {
        getPublicPlaybackSettings: getPublicPlaybackSettingsMock,
    },
}));

const { default: recordingPlaybackService } = await import('../services/recordingPlaybackService.js');

describe('recordingPlaybackService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getPublicPlaybackSettingsMock.mockReturnValue({
            publicPlaybackEnabled: true,
            previewMinutes: 10,
            notice: {
                enabled: true,
                title: 'Notice',
                text: 'Playback publik dibatasi',
            },
            contactMode: 'branding_whatsapp',
        });
    });

    it('returns enriched overview camera fields for recording dashboard', () => {
        queryMock.mockReturnValueOnce([
            {
                id: 5,
                name: 'CCTV ALUN',
                location: 'Bojonegoro',
                enabled: 1,
                status: 'active',
                enable_recording: 1,
                recording_status: 'recording',
                recording_duration_hours: 24,
                last_recording_start: '2026-03-16T00:00:00.000Z',
                stream_source: 'external',
            },
        ]).mockReturnValueOnce([{ count: 2 }]);

        getRecordingStatusMock.mockReturnValue({ isRecording: true, status: 'recording' });
        getStorageUsageMock.mockReturnValue({ totalSize: 1024, segmentCount: 2 });

        const result = recordingPlaybackService.getRecordingsOverview();

        expect(result.cameras).toEqual([
            expect.objectContaining({
                id: 5,
                location: 'Bojonegoro',
                enabled: 1,
                status: 'active',
                stream_source: 'external',
                runtime_status: { isRecording: true, status: 'recording' },
                storage: { totalSize: 1024, segmentCount: 2 },
            }),
        ]);
    });

    it('updates recording settings and starts recording when enabled', async () => {
        queryOneMock.mockReturnValueOnce({
            id: 7,
            name: 'CCTV PASAR',
            enabled: 1,
        });
        startRecordingMock.mockResolvedValue({ success: true });

        await recordingPlaybackService.updateRecordingSettings(
            7,
            { enable_recording: true, recording_duration_hours: 12 },
            { user: { id: 1 } }
        );

        expect(executeMock).toHaveBeenCalledWith(
            'UPDATE cameras SET enable_recording = ?, recording_duration_hours = ? WHERE id = ?',
            [1, 12, 7]
        );
        expect(startRecordingMock).toHaveBeenCalledWith(7);
        expect(stopRecordingMock).not.toHaveBeenCalled();
        expect(logAdminActionMock).toHaveBeenCalled();
    });

    it('returns the latest preview segments for public playback', () => {
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' });
        queryMock.mockReturnValueOnce([
            { id: 2, filename: 'second.mp4', start_time: '2026-03-20T10:10:00.000Z', end_time: '2026-03-20T10:20:00.000Z', duration: 600, file_path: 'b', file_size: 100, created_at: '2026-03-20T10:10:00.000Z' },
        ]);

        const result = recordingPlaybackService.getSegments(9, { query: {} });

        expect(result.playback_policy).toEqual(expect.objectContaining({
            accessMode: 'public_preview',
            previewMinutes: 10,
        }));
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].filename).toBe('second.mp4');
        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time DESC');
        expect(queryMock.mock.calls[0][0]).toContain('LIMIT ?');
    });

    it('allows admin full playback when admin scope is requested by authenticated user', () => {
        queryOneMock.mockReturnValueOnce({
            id: 10,
            name: 'CCTV ALUN',
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: null,
        });
        queryMock.mockReturnValueOnce([
            { id: 1, filename: 'first.mp4', start_time: '2026-03-20T10:00:00.000Z', end_time: '2026-03-20T10:10:00.000Z', duration: 600, file_path: 'a', file_size: 100, created_at: '2026-03-20T10:00:00.000Z' },
            { id: 2, filename: 'second.mp4', start_time: '2026-03-20T10:10:00.000Z', end_time: '2026-03-20T10:20:00.000Z', duration: 600, file_path: 'b', file_size: 100, created_at: '2026-03-20T10:10:00.000Z' },
        ]);

        const result = recordingPlaybackService.getSegments(10, {
            query: { scope: 'admin' },
            user: { id: 1 },
        });

        expect(result.playback_policy.accessMode).toBe('admin_full');
        expect(result.segments).toHaveLength(2);
    });

    it('blocks public playback for admin-only cameras', () => {
        queryOneMock.mockReturnValueOnce({
            id: 11,
            name: 'CCTV PRIVAT',
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: null,
        });

        expect(() => recordingPlaybackService.getSegments(11, { query: {} })).toThrow('Playback publik tidak tersedia untuk kamera ini');
    });

    it('streams by filename without loading every segment for the camera', () => {
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' })
            .mockReturnValueOnce({
                id: 2,
                filename: 'second.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
                end_time: '2026-03-20T10:20:00.000Z',
                duration: 600,
                file_path: 'b',
                file_size: 100,
                created_at: '2026-03-20T10:10:00.000Z',
            });
        queryMock.mockReturnValueOnce([
            {
                id: 2,
                filename: 'second.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
            },
        ]);

        const result = recordingPlaybackService.getStreamSegment(9, 'second.mp4', { query: {} });

        expect(result.segment.filename).toBe('second.mp4');
        expect(queryOneMock.mock.calls[2][0]).toContain('WHERE camera_id = ? AND filename = ?');
        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time DESC');
        expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('ORDER BY start_time ASC'), [9]);
    });
});
