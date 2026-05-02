/*
 * Purpose: Own Playback.jsx actions that reset playback session state and apply manual segment selection.
 * Caller: Playback route shell and playback selection hook tests.
 * Deps: React useCallback plus caller-provided refs, state setters, and URL update callback.
 * MainFuncs: usePlaybackSelectionActions.
 * SideEffects: Mutates refs, clears playback UI state, and updates shareable playback URL params.
 */
import { useCallback } from 'react';

export function usePlaybackSelectionActions({
    sourceLoadTokenRef,
    playbackSourceRef,
    lastSeekTimeRef,
    playbackSeekTargetRef,
    segmentsRef,
    queuedPlaybackPopunderRef,
    selectedCamera,
    showPlaybackPopunder,
    updatePlaybackSearchParams,
    resetSourcePlaybackState,
    resetVideoElement,
    setCurrentTime,
    setDuration,
    setVideoError,
    setErrorType,
    setSeekWarning,
    setAutoPlayNotification,
    setIsSeeking,
    setIsBuffering,
    setSelectedSegment,
    getSegmentKey,
}) {
    const resetPlaybackSession = useCallback(({
        clearSegment = false,
        clearSegments = false,
        preserveAutoPlayNotification = false,
    } = {}) => {
        sourceLoadTokenRef.current += 1;
        playbackSourceRef.current = { segmentKey: null, streamUrl: null };
        lastSeekTimeRef.current = 0;
        playbackSeekTargetRef.current = null;
        resetSourcePlaybackState();

        setCurrentTime(0);
        setDuration(0);
        setVideoError(null);
        setErrorType(null);
        setSeekWarning(null);

        if (!preserveAutoPlayNotification) {
            setAutoPlayNotification(null);
        }

        if (clearSegment) {
            setSelectedSegment(null);
        }

        if (clearSegments) {
            segmentsRef.current = [];
        }

        resetVideoElement();
    }, [
        lastSeekTimeRef,
        playbackSeekTargetRef,
        playbackSourceRef,
        resetSourcePlaybackState,
        resetVideoElement,
        segmentsRef,
        setAutoPlayNotification,
        setCurrentTime,
        setDuration,
        setErrorType,
        setSeekWarning,
        setSelectedSegment,
        setVideoError,
        sourceLoadTokenRef,
    ]);

    const handleSegmentClick = useCallback((segment) => {
        if (showPlaybackPopunder) {
            queuedPlaybackPopunderRef.current = {
                segmentKey: getSegmentKey(segment),
                reason: 'manual-segment-change',
            };
        }

        const timestamp = new Date(segment.start_time).getTime();
        updatePlaybackSearchParams({
            camera: selectedCamera,
            cameraId: selectedCamera?.id,
            timestamp,
            replace: false,
        });
        setSelectedSegment(segment);
        setSeekWarning(null);
        setAutoPlayNotification(null);
        setIsSeeking(false);
        setIsBuffering(false);
        lastSeekTimeRef.current = 0;
        playbackSeekTargetRef.current = 0;
        resetSourcePlaybackState();
    }, [
        getSegmentKey,
        lastSeekTimeRef,
        playbackSeekTargetRef,
        queuedPlaybackPopunderRef,
        resetSourcePlaybackState,
        selectedCamera,
        setAutoPlayNotification,
        setIsBuffering,
        setIsSeeking,
        setSeekWarning,
        setSelectedSegment,
        showPlaybackPopunder,
        updatePlaybackSearchParams,
    ]);

    return {
        resetPlaybackSession,
        handleSegmentClick,
    };
}
