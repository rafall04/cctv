/**
 * Purpose: Verify recording segment identity is idempotent across repeated registration attempts.
 * Caller: Vitest backend suite before recording lifecycle hardening lands.
 * Deps: recordingSegmentRepository helpers and mocked SQLite connection helpers.
 * MainFuncs: duplicate-safe insert/update expectations.
 * SideEffects: None; repository contract tests only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    query: queryMock,
    queryOne: queryOneMock,
}));

describe('recordingSegmentRepository uniqueness', () => {
    beforeEach(() => {
        executeMock.mockReset();
        queryMock.mockReset();
        queryOneMock.mockReset();
    });

    it('upserts by camera_id and filename instead of inserting duplicate rows', async () => {
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

        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT(camera_id, filename) DO UPDATE'),
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
});
