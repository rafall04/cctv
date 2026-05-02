/*
 * Purpose: Manage playback video source assignment and media event listener lifecycle.
 * Caller: Playback route and media source hook tests.
 * Deps: React hooks and HTMLMediaElement-compatible video ref.
 * MainFuncs: usePlaybackMediaSource.
 * SideEffects: Mutates video element src when enabled and attaches/removes media listeners.
 */

import { useEffect, useRef } from 'react';

export function usePlaybackMediaSource({
    videoRef,
    streamUrl,
    selectedSegmentKey,
    onPlaybackStarted,
    onEnded,
    onProgress,
    assignSource = true,
}) {
    const startedKeyRef = useRef(null);
    const sourceKeyRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !streamUrl || !selectedSegmentKey) {
            return undefined;
        }

        sourceKeyRef.current = selectedSegmentKey;
        startedKeyRef.current = null;

        if (assignSource && video.src !== streamUrl) {
            video.src = streamUrl;
            video.load?.();
        }

        const handlePlaying = () => {
            if (sourceKeyRef.current !== selectedSegmentKey) {
                return;
            }

            if (startedKeyRef.current === selectedSegmentKey) {
                return;
            }

            startedKeyRef.current = selectedSegmentKey;
            onPlaybackStarted?.();
        };

        const handleTimeUpdate = () => {
            if (sourceKeyRef.current !== selectedSegmentKey) {
                return;
            }

            onProgress?.(video.currentTime);
        };

        const handleEnded = () => {
            if (sourceKeyRef.current !== selectedSegmentKey) {
                return;
            }

            onEnded?.();
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('ended', handleEnded);
        };
    }, [assignSource, onEnded, onPlaybackStarted, onProgress, selectedSegmentKey, streamUrl, videoRef]);
}
