/**
 * Purpose: Verify recording segment identity is idempotent across repeated registration attempts.
 * Caller: Vitest backend suite before recording lifecycle hardening lands.
 * Deps: recordingSegmentRepository helpers and mocked SQLite connection helpers.
 * MainFuncs: duplicate-safe update-first insert expectations.
 * SideEffects: None; repository contract tests only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();
const transactionMock = vi.fn((callback) => callback);

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    query: queryMock,
    queryOne: queryOneMock,
    transaction: transactionMock,
}));

describe('recordingSegmentRepository uniqueness', () => {
    beforeEach(() => {
        executeMock.mockReset();
        queryMock.mockReset();
        queryOneMock.mockReset();
        transactionMock.mockClear();
    });

    it('updates by camera_id and filename before inserting to work without a unique index', async () => {
        const repository = (await import('../services/recordingSegmentRepository.js')).default;

        executeMock.mockReturnValue({ changes: 1 });

        repository.upsertSegment({
            cameraId: 9,
            filename: '20260503_010000.mp4',
            startTime: '2026-05-03T01:00:00.000Z',
            endTime: '2026-05-03T01:10:00.000Z',
            fileSize: 2048,
            duration: 600,
            filePath: '/recordings/camera9/20260503_010000.mp4',
        });

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('WHERE camera_id = ? AND filename = ?'),
            [
                '2026-05-03T01:00:00.000Z',
                '2026-05-03T01:10:00.000Z',
                2048,
                600,
                '/recordings/camera9/20260503_010000.mp4',
                9,
                '20260503_010000.mp4',
            ]
        );
    });

    it('inserts a segment only when no existing camera filename row was updated', async () => {
        const repository = (await import('../services/recordingSegmentRepository.js')).default;

        executeMock
            .mockReturnValueOnce({ changes: 0 })
            .mockReturnValueOnce({ changes: 1, lastInsertRowid: 22 });

        const result = repository.upsertSegment({
            cameraId: 9,
            filename: '20260503_010000.mp4',
            startTime: '2026-05-03T01:00:00.000Z',
            endTime: '2026-05-03T01:10:00.000Z',
            fileSize: 2048,
            duration: 600,
            filePath: '/recordings/camera9/20260503_010000.mp4',
        });

        expect(result.lastInsertRowid).toBe(22);
        expect(executeMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('INSERT INTO recording_segments'),
            [
                9,
                '20260503_010000.mp4',
                '2026-05-03T01:00:00.000Z',
                '2026-05-03T01:10:00.000Z',
                2048,
                600,
                '/recordings/camera9/20260503_010000.mp4',
            ]
        );
    });

    it('removes older duplicate rows when an old schema already has repeated segment identities', async () => {
        const repository = (await import('../services/recordingSegmentRepository.js')).default;

        executeMock
            .mockReturnValueOnce({ changes: 3 })
            .mockReturnValueOnce({ changes: 2 });

        repository.upsertSegment({
            cameraId: 9,
            filename: '20260503_010000.mp4',
            startTime: '2026-05-03T01:00:00.000Z',
            endTime: '2026-05-03T01:10:00.000Z',
            fileSize: 2048,
            duration: 600,
            filePath: '/recordings/camera9/20260503_010000.mp4',
        });

        expect(executeMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('DELETE FROM recording_segments'),
            [9, '20260503_010000.mp4', 9, '20260503_010000.mp4']
        );
        expect(executeMock.mock.calls[1][0]).toContain('MAX(id)');
    });
});
