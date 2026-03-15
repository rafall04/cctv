import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const executeMock = vi.fn();
const startRecordingMock = vi.fn();
const stopRecordingMock = vi.fn();
const getRecordingStatusMock = vi.fn();
const getStorageUsageMock = vi.fn();
const logAdminActionMock = vi.fn();

vi.mock('../database/database.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
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

const { default: recordingPlaybackService } = await import('../services/recordingPlaybackService.js');

describe('recordingPlaybackService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
