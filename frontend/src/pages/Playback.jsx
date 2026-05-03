/*
 * Purpose: Public/admin recording playback page with camera selection, sharing, and playback viewer tracking.
 * Caller: Public playback route and protected admin playback route.
 * Deps: React, router search params, recording/camera/playback viewer services, playback UI components.
 * MainFuncs: Playback, getSegmentKey.
 * SideEffects: Loads recordings, updates URL params, initializes media playback, tracks playback viewer sessions.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cameraService } from '../services/cameraService';
import recordingService from '../services/recordingService';
import { useBranding } from '../contexts/BrandingContext';
import { createCameraSlug, parseCameraIdFromSlug } from '../utils/slugify';
import {
    buildPlaybackSearchParams,
    getPlaybackUrlState,
} from '../utils/playbackUrlState.js';
import { REQUEST_POLICY } from '../services/requestPolicy';
import GlobalAdScript from '../components/ads/GlobalAdScript';
import InlineAdSlot from '../components/ads/InlineAdSlot';
import { isAdsMobileViewport, shouldRenderAdSlot } from '../components/ads/adsConfig.js';
import { getStreamCapabilities } from '../utils/cameraDelivery.js';
import { isAdminPlaybackScope, PLAYBACK_ACCESS_SCOPES } from '../utils/playbackAccessPolicy.js';

import PlaybackHeader from '../components/playback/PlaybackHeader';
import PlaybackVideo from '../components/playback/PlaybackVideo';
import PlaybackTimeline from '../components/playback/PlaybackTimeline';
import PlaybackSegmentList from '../components/playback/PlaybackSegmentList';
import PlaybackUsageGuide from '../components/playback/PlaybackUsageGuide';
import { useAdminReconnectRefresh } from '../hooks/admin/useAdminReconnectRefresh';
import { usePlaybackMediaSource } from '../hooks/playback/usePlaybackMediaSource.js';
import { usePlaybackSelectionActions } from '../hooks/playback/usePlaybackSelectionActions.js';
import { usePlaybackSegments } from '../hooks/playback/usePlaybackSegments.js';
import { usePlaybackShareAndSnapshot } from '../hooks/playback/usePlaybackShareAndSnapshot.js';
import { usePlaybackViewerTracking } from '../hooks/playback/usePlaybackViewerTracking.js';

const MAX_SEEK_DISTANCE = 180;
const BUFFERING_STALL_THRESHOLD_MS = 350;
function getSegmentKey(segment) {
    if (!segment) {
        return null;
    }

    if (segment.id) {
        return `id:${segment.id}`;
    }

    return `${segment.filename || 'no-file'}:${segment.start_time || 'no-start'}`;
}

function Playback({
    cameras: propCameras,
    selectedCamera: propSelectedCamera,
    adsConfig = null,
    accessScope = PLAYBACK_ACCESS_SCOPES.PUBLIC_PREVIEW,
}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const { cameraParam: cameraIdFromUrl, timestampParam: timestampFromUrl } = getPlaybackUrlState(searchParams);
    const { branding } = useBranding();
    const isAdminPlayback = isAdminPlaybackScope(accessScope);

    const [cameras, setCameras] = useState(propCameras || []);
    const supportedInitialCameras = (propCameras || []).filter((camera) => getStreamCapabilities(camera).playback);
    const [selectedCameraId, setSelectedCameraId] = useState(() => {
        if (propSelectedCamera?.id && getStreamCapabilities(propSelectedCamera).playback) {
            return propSelectedCamera.id;
        }

        if (cameraIdFromUrl) {
            return parseCameraIdFromSlug(cameraIdFromUrl);
        }

        return supportedInitialCameras[0]?.id ?? null;
    });
    const [camerasLoading, setCamerasLoading] = useState(true);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [videoError, setVideoError] = useState(null);
    const [errorType, setErrorType] = useState(null);
    const [isSeeking, setIsSeeking] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [seekWarning, setSeekWarning] = useState(null);
    const [autoPlayNotification, setAutoPlayNotification] = useState(null);
    const [autoPlayEnabled, setAutoPlayEnabled] = useState(() => {
        const saved = localStorage.getItem('playback-autoplay-enabled');
        return saved !== null ? saved === 'true' : true;
    });
    const {
        segments,
        segmentsCameraId,
        selectedSegment,
        setSelectedSegment,
        seekTargetSeconds,
        playbackPolicy,
        playbackDeniedMessage,
        reload: reloadSegments,
    } = usePlaybackSegments({
        cameraId: selectedCameraId,
        timestampParam: timestampFromUrl,
        accessScope,
    });
    const loading = camerasLoading;
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const lastSeekTimeRef = useRef(0);
    const bufferingTimeoutRef = useRef(null);
    const playbackSourceRef = useRef({ segmentKey: null, streamUrl: null });
    const playbackSeekTargetRef = useRef(null);
    const sourceLoadTokenRef = useRef(0);
    const activeSourceTokenRef = useRef(0);
    const lastPlaybackProgressRef = useRef(0);
    const lastPlaybackProgressAtRef = useRef(0);
    const hasLoadedDataForSourceRef = useRef(false);
    const hasStartedPlaybackForSourceRef = useRef(false);
    const queuedPlaybackPopunderRef = useRef(null);
    const hasTriggeredInitialPlaybackPopunderRef = useRef(false);

    // Refs to avoid stale closures in event handlers
    const selectedSegmentRef = useRef(selectedSegment);
    const segmentsRef = useRef(segments);
    const autoPlayEnabledRef = useRef(autoPlayEnabled);
    const selectedCameraIdRef = useRef(selectedCameraId);

    const playbackCameras = useMemo(() => cameras.filter((camera) => getStreamCapabilities(camera).playback), [cameras]);
    const selectedCamera = useMemo(() => {
        if (!selectedCameraId) {
            return null;
        }

        return playbackCameras.find((camera) => camera.id === selectedCameraId)
            || (propSelectedCamera?.id === selectedCameraId && getStreamCapabilities(propSelectedCamera).playback ? propSelectedCamera : null);
    }, [playbackCameras, propSelectedCamera, selectedCameraId]);
    const isMobileAdsViewport = isAdsMobileViewport();
    const showPlaybackNative = shouldRenderAdSlot(adsConfig, 'playbackNative', isMobileAdsViewport);
    const showPlaybackPopunder = shouldRenderAdSlot(adsConfig, 'playbackPopunder', isMobileAdsViewport);
    const [playbackPopunderTriggerId, setPlaybackPopunderTriggerId] = useState(0);
    const {
        snapshotNotification,
        clearSnapshotNotification,
        takeSnapshot,
        handleShare,
    } = usePlaybackShareAndSnapshot({
        videoRef,
        branding,
        selectedCamera,
        selectedSegment,
        searchParams,
        isAdminPlayback,
    });

    const {
        ensureSessionStarted: ensurePlaybackViewerSession,
    } = usePlaybackViewerTracking({
        cameraId: selectedCameraId,
        segment: selectedSegment,
        accessScope,
    });

    // Keep refs in sync
    useEffect(() => {
        selectedSegmentRef.current = selectedSegment;
    }, [selectedSegment]);

    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);

    useEffect(() => {
        autoPlayEnabledRef.current = autoPlayEnabled;
    }, [autoPlayEnabled]);

    useEffect(() => {
        selectedCameraIdRef.current = selectedCameraId;
    }, [selectedCameraId]);

    useEffect(() => {
        if (selectedCameraId && playbackCameras.some((camera) => camera.id === selectedCameraId)) {
            return;
        }

        setSelectedCameraId(playbackCameras[0]?.id ?? null);
    }, [playbackCameras, selectedCameraId]);

    useEffect(() => {
        if (!showPlaybackPopunder) {
            queuedPlaybackPopunderRef.current = null;
        }
    }, [showPlaybackPopunder]);

    const updatePlaybackSearchParams = useCallback(({
        camera,
        cameraId,
        timestamp,
        replace = false,
    }) => {
        setSearchParams((previous) => {
            const next = buildPlaybackSearchParams({
                currentParams: previous,
                camera: camera ? createCameraSlug(camera) : cameraId,
                timestamp,
            });
            const nextMode = next.get('mode');

            if (!nextMode || !['full', 'simple'].includes(nextMode)) {
                next.set('mode', 'full');
            }

            next.set('view', 'playback');

            return next;
        }, { replace });
    }, [setSearchParams]);

    const resetBufferingTimeout = useCallback(() => {
        if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current);
            bufferingTimeoutRef.current = null;
        }
    }, []);

    const clearBufferingState = useCallback(() => {
        resetBufferingTimeout();
        setIsBuffering(false);
    }, [resetBufferingTimeout]);

    const resetSourcePlaybackState = useCallback(({
        clearSeeking = true,
        clearBuffering = true,
    } = {}) => {
        resetBufferingTimeout();
        activeSourceTokenRef.current = sourceLoadTokenRef.current;
        hasLoadedDataForSourceRef.current = false;
        hasStartedPlaybackForSourceRef.current = false;
        lastPlaybackProgressRef.current = 0;
        lastPlaybackProgressAtRef.current = 0;

        if (clearSeeking) {
            setIsSeeking(false);
        }

        if (clearBuffering) {
            setIsBuffering(false);
        }
    }, [resetBufferingTimeout]);

    const resetVideoElement = useCallback(() => {
        const video = videoRef.current;
        if (!video) {
            return;
        }

        video.pause();
        video.removeAttribute('src');
        video.load();
    }, []);

    const {
        resetPlaybackSession,
        handleSegmentClick,
    } = usePlaybackSelectionActions({
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
    });

    const handleAutoPlayToggle = useCallback(() => {
        const newValue = !autoPlayEnabled;
        setAutoPlayEnabled(newValue);
        localStorage.setItem('playback-autoplay-enabled', String(newValue));

        setAutoPlayNotification({
            type: newValue ? 'enabled' : 'disabled',
            message: newValue
                ? 'Auto-play diaktifkan - segment berikutnya akan diputar otomatis'
                : 'Auto-play dinonaktifkan - video akan berhenti di akhir segment'
        });

        setTimeout(() => {
            setAutoPlayNotification(null);
        }, 3000);
    }, [autoPlayEnabled]);

    const isInitialMountRef = useRef(true);

    // Fetch cameras effect - only if no propCameras provided
    useEffect(() => {
        let isMounted = true;

        if (propCameras && propCameras.length > 0) {
            if (isMounted) {
                setCameras(propCameras);
            }

            if (propSelectedCamera?.id && propSelectedCamera.id !== selectedCameraIdRef.current) {
                setSelectedCameraId(propSelectedCamera.id);
            } else if (cameraIdFromUrl) {
                const nextCameraId = parseCameraIdFromSlug(cameraIdFromUrl);
                const hasMatchingCamera = propCameras.some((camera) => camera.id === nextCameraId);

                if (hasMatchingCamera && nextCameraId !== selectedCameraIdRef.current) {
                    setSelectedCameraId(nextCameraId);
                }
            } else if (!selectedCameraIdRef.current && propCameras.length > 0) {
                setSelectedCameraId(propCameras[0].id);
            }
            if (isMounted) {
                setCamerasLoading(false);
            }
            return;
        }

        const fetchCameras = async () => {
            try {
                const response = isAdminPlayback
                    ? await cameraService.getAllCameras(REQUEST_POLICY.BLOCKING)
                    : await cameraService.getActiveCameras(REQUEST_POLICY.BLOCKING);
                if (response.success) {
                    const recordingCameras = response.data.filter(cam => cam.enable_recording);
                    const uniqueCameras = recordingCameras.filter((cam, index, self) =>
                        index === self.findIndex(c => c.id === cam.id)
                    );

                    if (!isMounted) {
                        return;
                    }

                    setCameras(uniqueCameras);

                    if (cameraIdFromUrl) {
                        const camera = uniqueCameras.find(c => c.id === parseCameraIdFromSlug(cameraIdFromUrl));
                        if (camera) {
                            setSelectedCameraId(camera.id);
                        }
                    } else if (!selectedCameraIdRef.current && uniqueCameras.length > 0) {
                        setSelectedCameraId(uniqueCameras[0].id);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch cameras:', error);
            } finally {
                if (isMounted) {
                    setCamerasLoading(false);
                }
            }
        };

        fetchCameras();
        return () => {
            isMounted = false;
        };
    }, [cameraIdFromUrl, isAdminPlayback, propCameras, propSelectedCamera]);

    // URL camera change effect
    useEffect(() => {
        if (!isInitialMountRef.current && cameraIdFromUrl && cameras.length > 0) {
            const nextCameraId = parseCameraIdFromSlug(cameraIdFromUrl);
            const hasMatchingCamera = cameras.some((camera) => camera.id === nextCameraId);
            if (hasMatchingCamera && nextCameraId !== selectedCameraIdRef.current) {
                setSelectedCameraId(nextCameraId);
            }
        }
        isInitialMountRef.current = false;
    }, [cameraIdFromUrl, cameras]);

    const selectedSegmentKey = useMemo(() => {
        if (!selectedSegment || !selectedCameraId || segmentsCameraId !== selectedCameraId) {
            return null;
        }

        const segmentKey = getSegmentKey(selectedSegment);
        const segmentExists = segments.some((segment) => getSegmentKey(segment) === segmentKey);

        return segmentExists ? segmentKey : null;
    }, [segments, segmentsCameraId, selectedCameraId, selectedSegment]);

    const selectedPlaybackStreamUrl = useMemo(() => {
        if (!selectedSegmentKey || !selectedSegment?.filename || !selectedCameraId) {
            return null;
        }

        return recordingService.getSegmentStreamUrl(selectedCameraId, selectedSegment.filename, accessScope);
    }, [accessScope, selectedCameraId, selectedSegment, selectedSegmentKey]);

    useEffect(() => {
        if (!showPlaybackPopunder || !selectedSegmentKey) {
            return;
        }

        if (!hasTriggeredInitialPlaybackPopunderRef.current && !queuedPlaybackPopunderRef.current) {
            queuedPlaybackPopunderRef.current = {
                segmentKey: selectedSegmentKey,
                reason: 'initial-play',
            };
            return;
        }

        if (queuedPlaybackPopunderRef.current && !queuedPlaybackPopunderRef.current.segmentKey) {
            queuedPlaybackPopunderRef.current = {
                ...queuedPlaybackPopunderRef.current,
                segmentKey: selectedSegmentKey,
            };
        }
    }, [selectedSegmentKey, showPlaybackPopunder]);

    useEffect(() => {
        if (seekTargetSeconds !== null) {
            playbackSeekTargetRef.current = seekTargetSeconds;
        }
    }, [seekTargetSeconds]);

    useAdminReconnectRefresh(
        () => reloadSegments(selectedCameraId, { mode: 'resume' }),
        { enabled: Boolean(selectedCameraId) }
    );

    const hasActiveSource = useCallback(() => {
        return activeSourceTokenRef.current === sourceLoadTokenRef.current
            && playbackSourceRef.current.streamUrl !== null;
    }, []);

    const markPlaybackProgress = useCallback((videoTime) => {
        const now = Date.now();
        lastPlaybackProgressRef.current = videoTime;
        lastPlaybackProgressAtRef.current = now;
        hasStartedPlaybackForSourceRef.current = true;
        clearBufferingState();
    }, [clearBufferingState]);

    const handleVideoEnded = useCallback(() => {
        clearBufferingState();

        if (!autoPlayEnabledRef.current) {
            setAutoPlayNotification({ type: 'stopped', message: 'Video selesai - Auto-play dinonaktifkan' });
            setTimeout(() => setAutoPlayNotification(null), 5000);
            return;
        }

        const currentSegment = selectedSegmentRef.current;
        const currentSegments = segmentsRef.current;

        if (!currentSegment || currentSegments.length === 0) return;

        const currentIndex = currentSegments.findIndex(s => s.id === currentSegment.id);
        if (currentIndex === -1) return;

        const nextSegment = currentSegments[currentIndex - 1];

        if (nextSegment) {
            const currentEnd = new Date(currentSegment.end_time);
            const nextStart = new Date(nextSegment.start_time);
            const gapSeconds = (nextStart - currentEnd) / 1000;

            if (gapSeconds > 30) {
                const gapMinutes = Math.round(gapSeconds / 60);
                setAutoPlayNotification({ type: 'gap', message: `Melewati ${gapMinutes} menit rekaman yang hilang` });
            } else {
                setAutoPlayNotification({ type: 'next', message: 'Memutar segment berikutnya...' });
            }

            setTimeout(() => setAutoPlayNotification(null), 3000);
            setSelectedSegment(nextSegment);
            const timestamp = new Date(nextSegment.start_time).getTime();
            updatePlaybackSearchParams({
                cameraId: selectedCameraIdRef.current,
                timestamp,
                replace: false,
            });
        } else {
            setAutoPlayNotification({ type: 'complete', message: 'Playback selesai - tidak ada segment lagi' });
            setTimeout(() => setAutoPlayNotification(null), 5000);
        }
    }, [clearBufferingState, setSelectedSegment, updatePlaybackSearchParams]);

    const handlePlaybackStarted = useCallback(() => {
        if (!hasActiveSource() || !videoRef.current) {
            return;
        }

        hasLoadedDataForSourceRef.current = true;
        markPlaybackProgress(videoRef.current.currentTime);
        ensurePlaybackViewerSession();

        const queuedPlaybackPopunder = queuedPlaybackPopunderRef.current;
        if (
            showPlaybackPopunder
            && queuedPlaybackPopunder?.segmentKey
            && queuedPlaybackPopunder.segmentKey === selectedSegmentKey
        ) {
            hasTriggeredInitialPlaybackPopunderRef.current = true;
            queuedPlaybackPopunderRef.current = null;
            setPlaybackPopunderTriggerId((previous) => previous + 1);
        }
    }, [ensurePlaybackViewerSession, hasActiveSource, markPlaybackProgress, selectedSegmentKey, showPlaybackPopunder]);

    const handlePlaybackProgress = useCallback((videoTime) => {
        if (hasActiveSource()) {
            const previousTime = lastPlaybackProgressRef.current;
            if (videoTime > previousTime + 0.01) {
                markPlaybackProgress(videoTime);
            }
        }

        setCurrentTime(videoTime);
    }, [hasActiveSource, markPlaybackProgress]);

    usePlaybackMediaSource({
        videoRef,
        streamUrl: selectedPlaybackStreamUrl,
        selectedSegmentKey,
        onPlaybackStarted: handlePlaybackStarted,
        onEnded: handleVideoEnded,
        onProgress: handlePlaybackProgress,
        assignSource: false,
    });

    useEffect(() => {
        if (loading || !selectedSegmentKey || !selectedSegment || !videoRef.current || !selectedCameraId) {
            return;
        }

        if (selectedCameraIdRef.current !== selectedCameraId || selectedSegmentRef.current !== selectedSegment) {
            return;
        }

        if (!selectedSegment.filename || selectedSegment.filename.trim() === '') {
            return;
        }

        const nextStreamUrl = selectedPlaybackStreamUrl;
        if (!nextStreamUrl) {
            return;
        }

        if (
            playbackSourceRef.current.segmentKey === selectedSegmentKey
            && playbackSourceRef.current.streamUrl === nextStreamUrl
        ) {
            return;
        }

        const sourceToken = sourceLoadTokenRef.current + 1;
        sourceLoadTokenRef.current = sourceToken;
        activeSourceTokenRef.current = sourceToken;
        setVideoError(null);
        setErrorType(null);
        playbackSourceRef.current = {
            segmentKey: selectedSegmentKey,
            streamUrl: nextStreamUrl,
        };
        const video = videoRef.current;
        let canPlayRetried = false;

        const isStale = () => sourceLoadTokenRef.current !== sourceToken;

        const handleAutoPlayFailure = (error) => {
            if (isStale() || error?.name === 'AbortError') {
                return;
            }

            clearBufferingState();
            setAutoPlayNotification({
                type: 'manual',
                message: 'Auto-play gagal. Tekan tombol play untuk melanjutkan.',
            });
        };

        const attemptPlayback = () => {
            if (isStale()) {
                return;
            }

            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(handleAutoPlayFailure);
            }
        };

        const handleSourceLoadedMetadata = () => {
            if (isStale()) {
                return;
            }

            if (playbackSeekTargetRef.current !== null) {
                video.currentTime = playbackSeekTargetRef.current;
                lastSeekTimeRef.current = playbackSeekTargetRef.current;
                playbackSeekTargetRef.current = null;
            }

            attemptPlayback();
        };

        const handleSourceCanPlay = () => {
            if (isStale() || canPlayRetried || !video.paused) {
                return;
            }

            canPlayRetried = true;
            attemptPlayback();
        };

        const handleSourceError = () => {
            if (isStale()) {
                return;
            }

            const mediaError = video.error;
            const errorCode = mediaError?.code;

            clearBufferingState();
            setErrorType(errorCode === 2 ? 'network' : null);
            setVideoError(mediaError?.message || 'Gagal memuat video playback');
        };

        resetSourcePlaybackState({
            clearSeeking: true,
            clearBuffering: false,
        });
        setCurrentTime(0);
        setDuration(0);
        setIsBuffering(true);
        setAutoPlayNotification(null);

        video.addEventListener('loadedmetadata', handleSourceLoadedMetadata);
        video.addEventListener('canplay', handleSourceCanPlay);
        video.addEventListener('error', handleSourceError);

        resetVideoElement();
        video.src = nextStreamUrl;
        video.load();

        return () => {
            video.removeEventListener('loadedmetadata', handleSourceLoadedMetadata);
            video.removeEventListener('canplay', handleSourceCanPlay);
            video.removeEventListener('error', handleSourceError);

            if (!isStale()) {
                resetSourcePlaybackState();
                resetVideoElement();
            }
        };
    }, [clearBufferingState, loading, resetSourcePlaybackState, resetVideoElement, selectedCameraId, selectedPlaybackStreamUrl, selectedSegment, selectedSegmentKey]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.playbackRate = playbackSpeed;
    }, [loading, playbackSpeed]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleLoadedMetadata = () => setDuration(video.duration);
        const handleLoadedData = () => {
            if (!hasActiveSource()) {
                return;
            }

            hasLoadedDataForSourceRef.current = true;
            clearBufferingState();
        };

        const handleSeeking = () => {
            const targetTime = video.currentTime;
            const previousTime = lastSeekTimeRef.current || 0;
            const seekDistance = Math.abs(targetTime - previousTime);

            if (seekDistance > MAX_SEEK_DISTANCE) {
                const direction = targetTime > previousTime ? 1 : -1;
                const limitedTarget = previousTime + (MAX_SEEK_DISTANCE * direction);
                video.currentTime = limitedTarget;
                lastSeekTimeRef.current = limitedTarget;
                setSeekWarning({ type: 'limit' });
            } else {
                lastSeekTimeRef.current = targetTime;
            }

            setIsSeeking(true);
            setIsBuffering(true);
            setVideoError(null);
            setErrorType(null);
        };

        const handleSeeked = () => {
            setIsSeeking(false);
            resetBufferingTimeout();

            bufferingTimeoutRef.current = setTimeout(() => {
                setIsBuffering(false);
            }, 5000);
        };

        const handleWaiting = () => {
            if (!hasActiveSource() || !hasLoadedDataForSourceRef.current || video.paused || video.ended) {
                return;
            }

            setIsBuffering(true);
        };

        const handleCanPlay = () => {
            if (!hasActiveSource()) {
                return;
            }

            hasLoadedDataForSourceRef.current = true;
            clearBufferingState();
        };

        const handleCanPlayThrough = () => {
            if (!hasActiveSource()) {
                return;
            }

            hasLoadedDataForSourceRef.current = true;
            clearBufferingState();
        };

        const handleStalled = () => {
            if (
                !hasActiveSource()
                || !hasLoadedDataForSourceRef.current
                || !hasStartedPlaybackForSourceRef.current
                || video.paused
                || video.ended
            ) {
                return;
            }

            const msSinceLastProgress = Date.now() - lastPlaybackProgressAtRef.current;
            if (lastPlaybackProgressAtRef.current !== 0 && msSinceLastProgress < BUFFERING_STALL_THRESHOLD_MS) {
                return;
            }

            setIsBuffering(true);
        };

        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('loadeddata', handleLoadedData);
        video.addEventListener('seeking', handleSeeking);
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('canplaythrough', handleCanPlayThrough);
        video.addEventListener('stalled', handleStalled);

        return () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('loadeddata', handleLoadedData);
            video.removeEventListener('seeking', handleSeeking);
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('canplaythrough', handleCanPlayThrough);
            video.removeEventListener('stalled', handleStalled);

            resetBufferingTimeout();
        };
    }, [clearBufferingState, hasActiveSource, loading, resetBufferingTimeout]);

    const handleSpeedChange = (speed) => {
        setPlaybackSpeed(speed);
        if (videoRef.current) {
            videoRef.current.playbackRate = speed;
        }
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                await containerRef.current?.requestFullscreen?.();
            } else {
                await document.exitFullscreen?.();
            }
        } catch (err) {
            console.error('Fullscreen error:', err);
        }
    };

    const handleTimelineClick = (targetTime) => {
        if (!videoRef.current) return;

        const currentPos = videoRef.current.currentTime;
        const seekDistance = Math.abs(targetTime - currentPos);

        if (seekDistance > MAX_SEEK_DISTANCE) {
            const direction = targetTime > currentPos ? 1 : -1;
            const limitedTarget = currentPos + (MAX_SEEK_DISTANCE * direction);
            videoRef.current.currentTime = limitedTarget;
            lastSeekTimeRef.current = limitedTarget;
            setSeekWarning({ type: 'limit' });
        } else {
            videoRef.current.currentTime = targetTime;
            lastSeekTimeRef.current = targetTime;
        }
    };

    // Handle camera change and update URL for shareable links
    const handleCameraChange = useCallback((camera) => {
        if (!camera || camera.id === selectedCameraIdRef.current) {
            return;
        }

        if (showPlaybackPopunder) {
            queuedPlaybackPopunderRef.current = {
                segmentKey: null,
                reason: 'manual-camera-change',
            };
        }
        resetPlaybackSession({
            clearSegment: true,
            clearSegments: true,
        });
        selectedSegmentRef.current = null;
        segmentsRef.current = [];
        selectedCameraIdRef.current = camera.id;
        setSelectedCameraId(camera.id);
        updatePlaybackSearchParams({
            camera,
            timestamp: null,
            replace: false,
        });
    }, [resetPlaybackSession, showPlaybackPopunder, updatePlaybackSearchParams]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (cameras.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950">
                <div className="text-center max-w-md mx-auto px-4">
                    <svg className="w-20 h-20 mx-auto mb-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                        Belum Ada Recording Tersedia
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        Fitur recording sedang dalam proses aktivasi. Silakan cek kembali nanti.
                    </p>
                    <a href="/" className="inline-flex items-center gap-2 text-primary-500 hover:text-primary-600 font-medium">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                        Kembali ke Live Stream
                    </a>
                </div>
            </div>
        );
    }

    if (!isAdminPlayback && playbackDeniedMessage) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950">
                <div className="text-center max-w-xl mx-auto px-4">
                    <svg className="w-20 h-20 mx-auto mb-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M5.071 19h13.858c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                        Playback Publik Tidak Tersedia
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        {playbackDeniedMessage}
                    </p>
                    {branding?.whatsapp_number && (
                        <a
                            href={`https://wa.me/${branding.whatsapp_number}?text=${encodeURIComponent('Halo Admin, saya ingin informasi lebih lanjut tentang akses playback CCTV.')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
                        >
                            Hubungi Admin
                        </a>
                    )}
                </div>
            </div>
        );
    }

    return (
        <>
            {showPlaybackPopunder && playbackPopunderTriggerId > 0 && (
                <GlobalAdScript
                    key={playbackPopunderTriggerId}
                    slotKey={`playback-popunder-${playbackPopunderTriggerId}`}
                    script={adsConfig.slots.playbackPopunder.script}
                />
            )}
            <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-2 sm:py-6 md:py-8 px-2 sm:px-4">
            <div className="max-w-7xl mx-auto space-y-3 sm:space-y-4 md:space-y-6">
                <PlaybackHeader
                    cameras={playbackCameras}
                    selectedCamera={selectedCamera}
                    onCameraChange={handleCameraChange}
                    autoPlayEnabled={autoPlayEnabled}
                    onAutoPlayToggle={handleAutoPlayToggle}
                    onShare={isAdminPlayback ? null : handleShare}
                    playbackPolicy={playbackPolicy}
                    showPublicNotice={!isAdminPlayback}
                />

                <PlaybackVideo
                    videoRef={videoRef}
                    containerRef={containerRef}
                    selectedCamera={selectedCamera}
                    selectedSegment={selectedSegment}
                    playbackSpeed={playbackSpeed}
                    onSpeedChange={handleSpeedChange}
                    onSnapshot={takeSnapshot}
                    onToggleFullscreen={toggleFullscreen}
                    isFullscreen={isFullscreen}
                    isBuffering={isBuffering}
                    isSeeking={isSeeking}
                    videoError={videoError}
                    errorType={errorType}
                    currentTime={currentTime}
                    duration={duration}
                    autoPlayNotification={autoPlayNotification}
                    onAutoPlayNotificationClose={() => setAutoPlayNotification(null)}
                    seekWarning={seekWarning}
                    onSeekWarningClose={() => setSeekWarning(null)}
                    snapshotNotification={snapshotNotification}
                    onSnapshotNotificationClose={clearSnapshotNotification}
                    formatTimestamp={formatTimestamp}
                />

                {showPlaybackNative && (
                    <InlineAdSlot
                        slotKey="playback-native"
                        label="Sponsored"
                        script={adsConfig.slots.playbackNative.script}
                        minHeightClassName="min-h-[120px]"
                    />
                )}

                {!isAdminPlayback && (
                    <div className="flex justify-center">
                        <button
                            onClick={handleShare}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            title="Bagikan tautan playback ini"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                            </svg>
                            Bagikan Link Playback
                        </button>
                    </div>
                )}

                <PlaybackUsageGuide
                    isAdminPlayback={isAdminPlayback}
                    playbackPolicy={playbackPolicy}
                />

                <PlaybackTimeline
                    segments={segments}
                    selectedSegment={selectedSegment}
                    onSegmentClick={handleSegmentClick}
                    onTimelineClick={handleTimelineClick}
                    formatTimestamp={formatTimestamp}
                />

                <PlaybackSegmentList
                    segments={segments}
                    selectedSegment={selectedSegment}
                    onSegmentClick={handleSegmentClick}
                    formatTimestamp={formatTimestamp}
                />
            </div>
            </div>
        </>
    );
}

export default Playback;
