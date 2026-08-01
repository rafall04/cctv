/*
 * Purpose: Validate playback viewer session lifecycle independent from Playback.jsx.
 * Caller: Vitest frontend suite before extracting playback viewer tracking.
 * Deps: React Testing Library, playback viewer tracking hook, mocked playbackViewerService.
 * MainFuncs: usePlaybackViewerTracking.
 * SideEffects: Uses mock service calls only.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackViewerTracking } from './usePlaybackViewerTracking.js';
import playbackViewerService from '../../services/playbackViewerService.js';

vi.mock('../../services/playbackViewerService.js', () => ({
    default: {
        startSession: vi.fn(),
        stopSession: vi.fn(),
        stopAllSessions: vi.fn(),
    },
}));

const segmentA = {
    filename: '20260502_100000.mp4',
    start_time: '2026-05-02T10:00:00.000Z',
};

const segmentB = {
    filename: '20260502_100500.mp4',
    start_time: '2026-05-02T10:05:00.000Z',
};

describe('usePlaybackViewerTracking', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playbackViewerService.startSession.mockResolvedValue('session-1');
        playbackViewerService.stopSession.mockResolvedValue(undefined);
        playbackViewerService.stopAllSessions.mockResolvedValue(undefined);
    });

    it('starts one session for duplicate media event bursts', async () => {
        const { result } = renderHook(() => usePlaybackViewerTracking({
            cameraId: 7,
            segment: segmentA,
            accessScope: 'public_preview',
        }));

        await act(async () => {
            await Promise.all([
                result.current.ensureSessionStarted(),
                result.current.ensureSessionStarted(),
            ]);
        });

        expect(playbackViewerService.startSession).toHaveBeenCalledTimes(1);
        expect(playbackViewerService.startSession).toHaveBeenCalledWith({
            cameraId: 7,
            segmentFilename: '20260502_100000.mp4',
            segmentStartedAt: '2026-05-02T10:00:00.000Z',
            accessMode: 'public_preview',
        });
    });

    it('stops previous session when segment changes', async () => {
        const { result, rerender } = renderHook(
            ({ segment }) => usePlaybackViewerTracking({
                cameraId: 7,
                segment,
                accessScope: 'public_preview',
            }),
            { initialProps: { segment: segmentA } }
        );

        await act(async () => {
            await result.current.ensureSessionStarted();
        });

        playbackViewerService.startSession.mockResolvedValueOnce('session-2');
        rerender({ segment: segmentB });

        await act(async () => {
            await result.current.stopSession();
            await result.current.ensureSessionStarted();
        });

        expect(playbackViewerService.stopSession).toHaveBeenCalledWith('session-1');
        expect(playbackViewerService.startSession).toHaveBeenCalledTimes(2);
    });

    it('cleans up active sessions on unmount', async () => {
        const { result, unmount } = renderHook(() => usePlaybackViewerTracking({
            cameraId: 7,
            segment: segmentA,
            accessScope: 'admin_full',
        }));

        await act(async () => {
            await result.current.ensureSessionStarted();
        });

        unmount();

        expect(playbackViewerService.stopAllSessions).toHaveBeenCalled();
    });
});
