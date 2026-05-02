/**
 * Purpose: Validate bounded SQL access for recording segment cleanup and playback.
 * Caller: Vitest backend test suite.
 * Deps: mocked connectionPool and recordingSegmentRepository.
 * MainFuncs: findExpiredSegments, findExistingFilenames, findPlaybackSegments, findSegmentByFilename.
 * SideEffects: None; database calls are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const executeMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

const { default: recordingSegmentRepository } = await import('../services/recordingSegmentRepository.js');

describe('recordingSegmentRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches expired cleanup candidates with camera cutoff and limit', () => {
        queryMock.mockReturnValueOnce([]);

        recordingSegmentRepository.findExpiredSegments({
            cameraId: 7,
            cutoffIso: '2026-05-02T09:00:00.000Z',
            limit: 6,
        });

        expect(queryMock).toHaveBeenCalledWith(
            expect.stringContaining('WHERE camera_id = ? AND start_time < ?'),
            [7, '2026-05-02T09:00:00.000Z', 6]
        );
        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time ASC');
        expect(queryMock.mock.calls[0][0]).toContain('LIMIT ?');
    });

    it('fetches latest playback preview with bounded descending SQL then returns ascending order', () => {
        queryMock.mockReturnValueOnce([
            { id: 2, filename: '20260502_101000.mp4', start_time: '2026-05-02T10:10:00.000Z' },
            { id: 1, filename: '20260502_100000.mp4', start_time: '2026-05-02T10:00:00.000Z' },
        ]);

        const result = recordingSegmentRepository.findPlaybackSegments({
            cameraId: 9,
            order: 'latest',
            limit: 2,
            returnAscending: true,
        });

        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time DESC');
        expect(queryMock.mock.calls[0][0]).toContain('LIMIT ?');
        expect(queryMock.mock.calls[0][1]).toEqual([9, 2]);
        expect(result.map((segment) => segment.id)).toEqual([1, 2]);
    });

    it('checks only the current filesystem batch when looking up known filenames', () => {
        queryMock.mockReturnValueOnce([
            { filename: '20260502_100000.mp4' },
        ]);

        const result = recordingSegmentRepository.findExistingFilenames({
            cameraId: 7,
            filenames: ['20260502_100000.mp4', '20260502_101000.mp4'],
        });

        expect(queryMock).toHaveBeenCalledWith(
            expect.stringContaining('WHERE camera_id = ? AND filename IN (?, ?)'),
            [7, '20260502_100000.mp4', '20260502_101000.mp4']
        );
        expect(result).toEqual(['20260502_100000.mp4']);
    });

    it('looks up a stream segment by camera and filename', () => {
        queryOneMock.mockReturnValueOnce({ id: 5, filename: '20260502_100000.mp4' });

        const result = recordingSegmentRepository.findSegmentByFilename({
            cameraId: 3,
            filename: '20260502_100000.mp4',
        });

        expect(result.id).toBe(5);
        expect(queryOneMock).toHaveBeenCalledWith(
            expect.stringContaining('WHERE camera_id = ? AND filename = ?'),
            [3, '20260502_100000.mp4']
        );
    });
});
