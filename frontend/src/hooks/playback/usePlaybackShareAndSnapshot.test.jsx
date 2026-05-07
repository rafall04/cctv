/*
 * Purpose: Validate playback share and snapshot hook behavior outside Playback.jsx.
 * Caller: Frontend Vitest suite before extracting share/snapshot behavior.
 * Deps: React Testing Library, usePlaybackShareAndSnapshot hook, browser API mocks.
 * MainFuncs: usePlaybackShareAndSnapshot.
 * SideEffects: Mocks navigator share/clipboard and canvas APIs.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackShareAndSnapshot } from './usePlaybackShareAndSnapshot.js';

function buildHookProps(overrides = {}) {
    return {
        videoRef: {
            current: {
                paused: false,
                readyState: 4,
                currentTime: 12.4,
                videoWidth: 640,
                videoHeight: 360,
            },
        },
        branding: {
            logo_text: 'R',
            company_name: 'RAF NET',
        },
        selectedCamera: {
            id: 7,
            name: 'Lobby Camera',
        },
        selectedSegment: {
            start_time: '2026-05-02T10:00:00.000Z',
        },
        searchParams: new URLSearchParams('mode=simple&view=playback&cam=7-lobby-camera'),
        isAdminPlayback: false,
        ...overrides,
    };
}

describe('usePlaybackShareAndSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { origin: 'https://cctv.example.test' },
        });

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });

        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: undefined,
        });

        Object.defineProperty(navigator, 'canShare', {
            configurable: true,
            value: undefined,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows not-ready notification when snapshot video is unavailable', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps({
            videoRef: { current: null },
        })));

        await act(async () => {
            await result.current.takeSnapshot();
        });

        expect(result.current.snapshotNotification).toEqual({
            type: 'error',
            message: 'Video belum siap untuk snapshot',
        });

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(result.current.snapshotNotification).toBe(null);
    });

    it('copies public share URL with camera slug and precise timestamp', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps()));

        await act(async () => {
            await result.current.handleShare();
        });

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            'https://cctv.example.test/playback?cam=7-lobby-camera&t=1777716012400'
        );
        expect(result.current.snapshotNotification).toEqual({
            type: 'success',
            message: 'Tautan disalin ke clipboard!',
        });
    });

    it('copies canonical public playback share links', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps({
            videoRef: {
                current: {
                    currentTime: 2.4,
                },
            },
            selectedCamera: {
                id: 7,
                name: 'Gerbang Utama',
            },
            selectedSegment: {
                start_time: '2024-03-09T16:00:00.000Z',
            },
            searchParams: new URLSearchParams('mode=full&view=playback&cam=7-gerbang-utama'),
        })));

        await act(async () => {
            await result.current.handleShare();
        });

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            expect.stringMatching(/^https:\/\/cctv\.example\.test\/playback\?cam=7-gerbang-utama&t=\d+$/)
        );
    });

    it('does not share admin playback links', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps({
            isAdminPlayback: true,
        })));

        await act(async () => {
            await result.current.handleShare();
        });

        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        expect(result.current.snapshotNotification).toBe(null);
    });

    it('clears notification through returned callback', async () => {
        const { result } = renderHook(() => usePlaybackShareAndSnapshot(buildHookProps()));

        await act(async () => {
            await result.current.handleShare();
        });

        act(() => {
            result.current.clearSnapshotNotification();
        });

        expect(result.current.snapshotNotification).toBe(null);
    });
});
