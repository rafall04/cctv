/*
 * Purpose: Validate playback segment loading, camera reset, policy state, and stale response guards.
 * Caller: Vitest frontend suite before extracting segment loading from Playback.jsx.
 * Deps: React Testing Library, usePlaybackSegments hook, mocked recordingService.
 * MainFuncs: usePlaybackSegments.
 * SideEffects: Uses mock recording service calls only.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackSegments } from './usePlaybackSegments.js';
import recordingService from '../../services/recordingService.js';

vi.mock('../../services/recordingService.js', () => ({
    default: {
        getSegments: vi.fn(),
    },
}));

const segmentA = {
    id: 1,
    filename: '20260502_100000.mp4',
    start_time: '2026-05-02T10:00:00.000Z',
    end_time: '2026-05-02T10:05:00.000Z',
};

const segmentB = {
    id: 2,
    filename: '20260502_100500.mp4',
    start_time: '2026-05-02T10:05:00.000Z',
    end_time: '2026-05-02T10:10:00.000Z',
};

describe('usePlaybackSegments', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads segments for the selected camera and selects timestamp match', async () => {
        recordingService.getSegments.mockResolvedValue({
            success: true,
            data: { segments: [segmentA, segmentB] },
        });

        const { result } = renderHook(() => usePlaybackSegments({
            cameraId: 7,
            timestampParam: String(Date.parse('2026-05-02T10:06:00.000Z')),
            accessScope: 'public_preview',
            isAdminPlayback: false,
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.segments).toEqual([segmentA, segmentB]);
        expect(result.current.selectedSegment).toEqual(segmentB);
        expect(result.current.segmentsCameraId).toBe(7);
        expect(result.current.seekTargetSeconds).toBe(60);
    });

    it('selects the latest segment when no timestamp is present', async () => {
        recordingService.getSegments.mockResolvedValue({
            success: true,
            data: { segments: [segmentA, segmentB] },
        });

        const { result } = renderHook(() => usePlaybackSegments({
            cameraId: 7,
            timestampParam: null,
            accessScope: 'public_preview',
            isAdminPlayback: false,
        }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.selectedSegment).toEqual(segmentB);
        expect(result.current.seekTargetSeconds).toBe(null);
    });

    it('ignores stale response after camera changes', async () => {
        let resolveFirst;
        recordingService.getSegments
            .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValueOnce({ success: true, data: { segments: [segmentB] } });

        const { result, rerender } = renderHook(
            ({ cameraId }) => usePlaybackSegments({
                cameraId,
                timestampParam: null,
                accessScope: 'admin_full',
                isAdminPlayback: true,
            }),
            { initialProps: { cameraId: 7 } }
        );

        rerender({ cameraId: 8 });

        await waitFor(() => expect(result.current.segmentsCameraId).toBe(8));

        await act(async () => {
            resolveFirst({ success: true, data: { segments: [segmentA] } });
        });

        expect(result.current.segments).toEqual([segmentB]);
        expect(result.current.selectedSegment).toEqual(segmentB);
    });

    it('resets segment state when camera is cleared', async () => {
        recordingService.getSegments.mockResolvedValue({ success: true, data: { segments: [segmentA] } });

        const { result, rerender } = renderHook(
            ({ cameraId }) => usePlaybackSegments({
                cameraId,
                timestampParam: null,
                accessScope: 'public_preview',
                isAdminPlayback: false,
            }),
            { initialProps: { cameraId: 7 } }
        );

        await waitFor(() => expect(result.current.segments).toHaveLength(1));

        rerender({ cameraId: null });

        expect(result.current.segments).toEqual([]);
        expect(result.current.selectedSegment).toBe(null);
        expect(result.current.segmentsCameraId).toBe(null);
    });
});
