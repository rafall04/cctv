/**
 * Purpose: Validate recording playback service controls, stream authorization, and safe file access.
 * Caller: Vitest backend test suite.
 * Deps: mocked connectionPool, fs, recordingService, settings, tokens, and security audit logger.
 * MainFuncs: getSegments, getStreamSegment, updateRecordingSettings.
 * SideEffects: None; external services and filesystem access are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const executeMock = vi.fn();
const startRecordingMock = vi.fn();
const stopRecordingMock = vi.fn();
const getRecordingStatusMock = vi.fn();
const getStorageUsageMock = vi.fn();
const logAdminActionMock = vi.fn();
const getPublicPlaybackSettingsMock = vi.fn();
const existsSyncMock = vi.fn();
const statSyncMock = vi.fn();
const validateRequestForCameraMock = vi.fn();

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
    existsSync: existsSyncMock,
    statSync: statSyncMock,
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

vi.mock('../services/playbackTokenService.js', () => ({
    default: {
        validateRequestForCamera: validateRequestForCameraMock,
    },
}));

const { default: recordingPlaybackService } = await import('../services/recordingPlaybackService.js');

describe('recordingPlaybackService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        existsSyncMock.mockReturnValue(true);
        statSyncMock.mockReturnValue({ size: 100 });
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
        validateRequestForCameraMock.mockReturnValue(null);
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

    it('rejects enabling recording for non-recordable delivery types', async () => {
        queryOneMock.mockReturnValueOnce({
            id: 7,
            name: 'CCTV MJPEG',
            enabled: 1,
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
        });

        await expect(recordingPlaybackService.updateRecordingSettings(
            7,
            { enable_recording: true },
            { user: { id: 1 } }
        )).rejects.toMatchObject({
            statusCode: 400,
            message: 'Recording only supports internal HLS or external HLS cameras',
        });

        expect(executeMock).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE cameras SET enable_recording'),
            expect.any(Array)
        );
    });

    it('rejects recording retention outside accepted bounds', async () => {
        queryOneMock.mockReturnValueOnce({
            id: 7,
            name: 'CCTV HLS',
            enabled: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
        });

        await expect(recordingPlaybackService.updateRecordingSettings(
            7,
            { recording_duration_hours: 3000 },
            { user: { id: 1 } }
        )).rejects.toMatchObject({
            statusCode: 400,
            message: 'Recording retention must be between 1 and 2160 hours',
        });
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

    it('allows explicit selected token for admin_only camera', () => {
        validateRequestForCameraMock.mockReturnValue({
            id: 20,
            scope_type: 'selected',
            effective_playback_window_hours: 12,
        });

        const access = recordingPlaybackService.resolvePlaybackAccess({
            id: 4,
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: 10,
        }, { query: {}, url: '/api/recordings/4/segments', cookies: { raf_playback_token: 'token' } });

        expect(validateRequestForCameraMock).toHaveBeenCalledWith(
            expect.any(Object),
            4,
            expect.objectContaining({
                camera: expect.objectContaining({ id: 4 }),
            })
        );
        expect(access).toMatchObject({
            accessMode: 'token_full',
            playbackWindowHours: 12,
            tokenId: 20,
        });
    });

    it('denies all-scope token for admin_only camera when token service rejects it', () => {
        validateRequestForCameraMock.mockImplementation(() => {
            const err = new Error('Token playback tidak mencakup kamera ini');
            err.statusCode = 403;
            throw err;
        });

        expect(() => recordingPlaybackService.resolvePlaybackAccess({
            id: 4,
            public_playback_mode: 'admin_only',
            public_playback_preview_minutes: 10,
        }, { query: {}, url: '/api/recordings/4/segments', cookies: { raf_playback_token: 'token' } }))
            .toThrow('Token playback tidak mencakup kamera ini');
    });

    it('streams by filename without loading every segment for the camera', () => {
        const filePath = join(process.cwd(), '..', 'recordings', 'camera9', '20260517_010000.mp4');
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
                filename: '20260517_010000.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
                end_time: '2026-03-20T10:20:00.000Z',
                duration: 600,
                file_path: filePath,
                file_size: 100,
                created_at: '2026-03-20T10:10:00.000Z',
            });
        queryMock.mockReturnValueOnce([
            {
                id: 2,
                filename: '20260517_010000.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
            },
        ]);

        const result = recordingPlaybackService.getStreamSegment(9, '20260517_010000.mp4', { query: {} });

        expect(result.segment.filename).toBe('20260517_010000.mp4');
        expect(queryOneMock.mock.calls[2][0]).toContain('WHERE camera_id = ? AND filename = ?');
        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time DESC');
        expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('ORDER BY start_time ASC'), [9]);
    });

    it('authorizes token stream lookup with a direct playback-window filename query', () => {
        const filePath = join(process.cwd(), '..', 'recordings', 'camera9', '20260517_010000.mp4');
        validateRequestForCameraMock.mockReturnValue({
            id: 20,
            scope_type: 'selected',
            effective_playback_window_hours: 12,
        });
        queryOneMock
            .mockReturnValueOnce({
                id: 9,
                name: 'CCTV TAMAN',
                public_playback_mode: 'admin_only',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({
                id: 2,
                filename: '20260517_010000.mp4',
                start_time: '2026-05-17T01:00:00.000Z',
                end_time: '2026-05-17T01:10:00.000Z',
                duration: 600,
                file_path: filePath,
                file_size: 100,
                created_at: '2026-05-17T01:00:00.000Z',
            })
            .mockReturnValueOnce({ id: 2, filename: '20260517_010000.mp4' });

        const result = recordingPlaybackService.getStreamSegment(9, '20260517_010000.mp4', {
            query: {},
            url: '/api/recordings/9/stream/20260517_010000.mp4',
            cookies: { raf_playback_token: 'token' },
        });

        expect(result.segment.filename).toBe('20260517_010000.mp4');
        expect(queryOneMock.mock.calls[2][0]).toContain('AND start_time >= ?');
        expect(queryMock).not.toHaveBeenCalledWith(
            expect.stringContaining('LIMIT ?'),
            [9, 1000]
        );
    });

    it('rejects stream segment when DB path escapes camera recording directory', () => {
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
                filename: '20260517_010000.mp4',
                start_time: '2026-05-17T01:00:00.000Z',
                end_time: '2026-05-17T01:10:00.000Z',
                duration: 600,
                file_path: 'C:\\escape\\20260517_010000.mp4',
                file_size: 100,
                created_at: '2026-05-17T01:00:00.000Z',
            });
        queryMock.mockReturnValueOnce([
            { id: 2, filename: '20260517_010000.mp4', start_time: '2026-05-17T01:00:00.000Z' },
        ]);

        expect(() => recordingPlaybackService.getStreamSegment(9, '20260517_010000.mp4', { query: {} }))
            .toThrow('Segment file path is not safe');
    });

    it('does not mutate recording_segments during stream lookup when file size differs on disk', () => {
        const filePath = join(process.cwd(), '..', 'recordings', 'camera12', '20260517_011000.mp4');
        queryOneMock
            .mockReturnValueOnce({
                id: 12,
                name: 'CCTV TAMAN',
                public_playback_mode: 'inherit',
                public_playback_preview_minutes: null,
            })
            .mockReturnValueOnce({ value: '628111111111' })
            .mockReturnValueOnce({
                id: 4,
                filename: '20260517_011000.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
                end_time: '2026-03-20T10:20:00.000Z',
                duration: 600,
                file_path: filePath,
                file_size: 100,
                created_at: '2026-03-20T10:10:00.000Z',
            });
        queryMock.mockReturnValueOnce([
            {
                id: 4,
                filename: '20260517_011000.mp4',
                start_time: '2026-03-20T10:10:00.000Z',
            },
        ]);

        statSyncMock.mockReturnValue({ size: 2 * 1024 * 1024 });

        const result = recordingPlaybackService.getStreamSegment(12, '20260517_011000.mp4', { query: {} });

        expect(result.segment.filename).toBe('20260517_011000.mp4');
        expect(executeMock).not.toHaveBeenCalledWith(
            'UPDATE recording_segments SET file_size = ? WHERE id = ?',
            [2 * 1024 * 1024, 4]
        );
    });

    it('uses connectionPool helpers instead of legacy database.js helpers', async () => {
        const source = await readFile(new URL('../services/recordingPlaybackService.js', import.meta.url), 'utf8');

        expect(source).toContain("../database/connectionPool.js");
        expect(source).not.toContain("../database/database.js");
    });
});
