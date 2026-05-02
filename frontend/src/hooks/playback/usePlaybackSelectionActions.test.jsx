/*
 * Purpose: Validate extracted playback selection/reset actions before removing them from Playback.jsx.
 * Caller: Frontend Vitest suite during playback route refactors.
 * Deps: React Testing Library, Vitest, playback selection hook.
 * MainFuncs: usePlaybackSelectionActions.
 * SideEffects: Mocks setter callbacks, refs, and URL update handlers.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlaybackSelectionActions } from './usePlaybackSelectionActions.js';

function buildHookProps(overrides = {}) {
    return {
        sourceLoadTokenRef: { current: 4 },
        playbackSourceRef: { current: { segmentKey: 'id:7', streamUrl: '/stream/7' } },
        lastSeekTimeRef: { current: 14 },
        playbackSeekTargetRef: { current: 28 },
        segmentsRef: { current: [{ id: 1 }] },
        queuedPlaybackPopunderRef: { current: null },
        selectedCamera: { id: 3, name: 'Gerbang Utama' },
        showPlaybackPopunder: true,
        updatePlaybackSearchParams: vi.fn(),
        resetSourcePlaybackState: vi.fn(),
        resetVideoElement: vi.fn(),
        setCurrentTime: vi.fn(),
        setDuration: vi.fn(),
        setVideoError: vi.fn(),
        setErrorType: vi.fn(),
        setSeekWarning: vi.fn(),
        setAutoPlayNotification: vi.fn(),
        setIsSeeking: vi.fn(),
        setIsBuffering: vi.fn(),
        setSelectedSegment: vi.fn(),
        getSegmentKey: (segment) => `id:${segment.id}`,
        ...overrides,
    };
}

describe('usePlaybackSelectionActions', () => {
    it('resets playback session state and clears optional segment data', () => {
        const props = buildHookProps();
        const { result } = renderHook(() => usePlaybackSelectionActions(props));

        act(() => {
            result.current.resetPlaybackSession({
                clearSegment: true,
                clearSegments: true,
            });
        });

        expect(props.sourceLoadTokenRef.current).toBe(5);
        expect(props.playbackSourceRef.current).toEqual({ segmentKey: null, streamUrl: null });
        expect(props.lastSeekTimeRef.current).toBe(0);
        expect(props.playbackSeekTargetRef.current).toBe(null);
        expect(props.resetSourcePlaybackState).toHaveBeenCalledTimes(1);
        expect(props.setCurrentTime).toHaveBeenCalledWith(0);
        expect(props.setDuration).toHaveBeenCalledWith(0);
        expect(props.setVideoError).toHaveBeenCalledWith(null);
        expect(props.setErrorType).toHaveBeenCalledWith(null);
        expect(props.setSeekWarning).toHaveBeenCalledWith(null);
        expect(props.setAutoPlayNotification).toHaveBeenCalledWith(null);
        expect(props.setSelectedSegment).toHaveBeenCalledWith(null);
        expect(props.segmentsRef.current).toEqual([]);
        expect(props.resetVideoElement).toHaveBeenCalledTimes(1);
    });

    it('updates URL and playback refs when a segment is selected manually', () => {
        const props = buildHookProps();
        const segment = {
            id: 9,
            start_time: '2026-05-03T11:22:33.000Z',
        };
        const { result } = renderHook(() => usePlaybackSelectionActions(props));

        act(() => {
            result.current.handleSegmentClick(segment);
        });

        expect(props.queuedPlaybackPopunderRef.current).toEqual({
            segmentKey: 'id:9',
            reason: 'manual-segment-change',
        });
        expect(props.updatePlaybackSearchParams).toHaveBeenCalledWith({
            camera: props.selectedCamera,
            cameraId: props.selectedCamera.id,
            timestamp: new Date(segment.start_time).getTime(),
            replace: false,
        });
        expect(props.setSelectedSegment).toHaveBeenCalledWith(segment);
        expect(props.setSeekWarning).toHaveBeenCalledWith(null);
        expect(props.setAutoPlayNotification).toHaveBeenCalledWith(null);
        expect(props.setIsSeeking).toHaveBeenCalledWith(false);
        expect(props.setIsBuffering).toHaveBeenCalledWith(false);
        expect(props.lastSeekTimeRef.current).toBe(0);
        expect(props.playbackSeekTargetRef.current).toBe(0);
        expect(props.resetSourcePlaybackState).toHaveBeenCalledTimes(1);
    });
});
