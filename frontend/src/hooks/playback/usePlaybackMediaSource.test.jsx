/*
 * Purpose: Validate playback media source lifecycle and listener cleanup.
 * Caller: Vitest frontend suite before extracting media event wiring from Playback.jsx.
 * Deps: React Testing Library and usePlaybackMediaSource hook.
 * MainFuncs: usePlaybackMediaSource.
 * SideEffects: Attaches listeners to an in-memory video element.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackMediaSource } from './usePlaybackMediaSource.js';

function createVideoElement() {
    const listeners = new Map();
    return {
        src: '',
        currentTime: 0,
        duration: 300,
        paused: false,
        ended: false,
        addEventListener: vi.fn((event, handler) => {
            listeners.set(event, handler);
        }),
        removeEventListener: vi.fn((event, handler) => {
            if (listeners.get(event) === handler) {
                listeners.delete(event);
            }
        }),
        load: vi.fn(),
        play: vi.fn(() => Promise.resolve()),
        dispatch(event) {
            listeners.get(event)?.();
        },
    };
}

describe('usePlaybackMediaSource', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('assigns stream URL and attaches media listeners', () => {
        const video = createVideoElement();
        const videoRef = { current: video };

        renderHook(() => usePlaybackMediaSource({
            videoRef,
            streamUrl: '/api/recordings/stream/a.mp4',
            selectedSegmentKey: 'id:1',
            onPlaybackStarted: vi.fn(),
            onEnded: vi.fn(),
            onProgress: vi.fn(),
        }));

        expect(video.src).toContain('/api/recordings/stream/a.mp4');
        expect(video.addEventListener).toHaveBeenCalledWith('playing', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    });

    it('calls playback started once for repeated playing events on same source', () => {
        const video = createVideoElement();
        const onPlaybackStarted = vi.fn();

        renderHook(() => usePlaybackMediaSource({
            videoRef: { current: video },
            streamUrl: '/api/recordings/stream/a.mp4',
            selectedSegmentKey: 'id:1',
            onPlaybackStarted,
            onEnded: vi.fn(),
            onProgress: vi.fn(),
        }));

        act(() => {
            video.dispatch('playing');
            video.dispatch('playing');
        });

        expect(onPlaybackStarted).toHaveBeenCalledTimes(1);
    });

    it('removes listeners on unmount', () => {
        const video = createVideoElement();
        const { unmount } = renderHook(() => usePlaybackMediaSource({
            videoRef: { current: video },
            streamUrl: '/api/recordings/stream/a.mp4',
            selectedSegmentKey: 'id:1',
            onPlaybackStarted: vi.fn(),
            onEnded: vi.fn(),
            onProgress: vi.fn(),
        }));

        unmount();

        expect(video.removeEventListener).toHaveBeenCalledWith('playing', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    });
});
