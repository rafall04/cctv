import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cameraService } from '../services/cameraService';
import recordingService from '../services/recordingService';
import { useBranding } from '../contexts/BrandingContext';
import { createCameraSlug, parseCameraIdFromSlug } from '../utils/slugify';
import { buildPublicPlaybackShareUrl } from '../utils/publicShareUrl';
import { REQUEST_POLICY } from '../services/requestPolicy';
import GlobalAdScript from '../components/ads/GlobalAdScript';
import InlineAdSlot from '../components/ads/InlineAdSlot';
import { isAdsMobileViewport, shouldRenderAdSlot } from '../components/ads/adsConfig.js';
import { getStreamCapabilities } from '../utils/cameraDelivery.js';

import PlaybackHeader from '../components/playback/PlaybackHeader';
import PlaybackVideo from '../components/playback/PlaybackVideo';
import PlaybackTimeline from '../components/playback/PlaybackTimeline';
import PlaybackSegmentList from '../components/playback/PlaybackSegmentList';
import { useAdminReconnectRefresh } from '../hooks/admin/useAdminReconnectRefresh';

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

function Playback({ cameras: propCameras, selectedCamera: propSelectedCamera, adsConfig = null }) {
    const [searchParams, setSearchParams] = useSearchParams();
    const cameraIdFromUrl = searchParams.get('cam');
    const { branding } = useBranding();

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
    const [segments, setSegments] = useState([]);
    const [segmentsCameraId, setSegmentsCameraId] = useState(null);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [videoError, setVideoError] = useState(null);
    const [errorType, setErrorType] = useState(null);
    const [isSeeking, setIsSeeking] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const [seekWarning, setSeekWarning] = useState(null);
    const [autoPlayNotification, setAutoPlayNotification] = useState(null);
    const [autoPlayEnabled, setAutoPlayEnabled] = useState(() => {
        const saved = localStorage.getItem('playback-autoplay-enabled');
        return saved !== null ? saved === 'true' : true;
    });

    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const lastSeekTimeRef = useRef(0);
    const bufferingTimeoutRef = useRef(null);
    const segmentsRequestIdRef = useRef(0);
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
            const next = new URLSearchParams(previous);
            const nextMode = next.get('mode');

            if (!nextMode || !['full', 'simple'].includes(nextMode)) {
                next.set('mode', 'full');
            }

            next.set('view', 'playback');

            if (camera) {
                next.set('cam', createCameraSlug(camera));
            } else if (cameraId) {
                next.set('cam', String(cameraId));
            }

            if (timestamp !== null && timestamp !== undefined) {
                next.set('t', String(timestamp));
            } else {
                next.delete('t');
            }

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
            setSegments([]);
            setSegmentsCameraId(null);
        }

        resetVideoElement();
    }, [resetSourcePlaybackState, resetVideoElement]);

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
                setLoading(false);
            }
            return;
        }

        const fetchCameras = async () => {
            try {
                const response = await cameraService.getActiveCameras(REQUEST_POLICY.BLOCKING);
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
                    setLoading(false);
                }
            }
        };

        fetchCameras();
        return () => {
            isMounted = false;
        };
    }, [cameraIdFromUrl, propCameras, propSelectedCamera]);

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

    // Effect to select segment from URL or auto-select latest when segments are loaded
    useEffect(() => {
        if (segments.length === 0) return;

        const timestampFromUrl = searchParams.get('t');
        if (timestampFromUrl && (!selectedSegment || isInitialMountRef.current)) {
            const targetTime = parseInt(timestampFromUrl);
            const segmentFromUrl = segments.find(s => {
                const startTime = new Date(s.start_time).getTime();
                const endTime = new Date(s.end_time).getTime();
                return targetTime >= startTime && targetTime <= endTime;
            });

            if (segmentFromUrl) {
                if (getSegmentKey(segmentFromUrl) !== getSegmentKey(selectedSegment)) {
                    setSelectedSegment(segmentFromUrl);
                }
                // Hitung selisih detik pencarian untuk dikonsumsi video nanti saat loadedMetadata
                const sTime = new Date(segmentFromUrl.start_time).getTime();
                const diffSeconds = (targetTime - sTime) / 1000;
                playbackSeekTargetRef.current = diffSeconds > 0 ? diffSeconds : 0;
            } else {
                const closestSegment = segments.reduce((prev, curr) => {
                    const prevDiff = Math.abs(new Date(prev.start_time).getTime() - targetTime);
                    const currDiff = Math.abs(new Date(curr.start_time).getTime() - targetTime);
                    return currDiff < prevDiff ? curr : prev;
                }, segments[0]);
                if (getSegmentKey(closestSegment) !== getSegmentKey(selectedSegment)) {
                    setSelectedSegment(closestSegment);
                }
                // Karena fallback ke closest, seek ke awal saja
                playbackSeekTargetRef.current = 0;
            }
        } else if (!selectedSegment && segments.length > 0) {
            // Auto-select latest segment if no segment selected
            const sortedSegments = [...segments].sort((a, b) =>
                new Date(b.start_time) - new Date(a.start_time)
            );
            setSelectedSegment(sortedSegments[0]);
        }
    }, [segments, selectedSegment, searchParams]);

    const loadSegments = useCallback(async (cameraId, { mode = 'initial', reset = false } = {}) => {
        if (!cameraId) {
            return;
        }

        const isBackgroundMode = mode === 'background' || mode === 'resume';
        const requestId = ++segmentsRequestIdRef.current;

        if (reset) {
            resetPlaybackSession({
                clearSegment: true,
                clearSegments: true,
            });
        }

        try {
            const response = await recordingService.getSegments(
                cameraId,
                isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING
            );

            if (requestId !== segmentsRequestIdRef.current) {
                return;
            }

            if (response.success && response.data) {
                const segmentsArray = response.data.segments || [];
                setSegments(segmentsArray);
                setSegmentsCameraId(cameraId);

                const activeSegmentKey = getSegmentKey(selectedSegmentRef.current);
                if (activeSegmentKey) {
                    const hasActiveSegment = segmentsArray.some((segment) => getSegmentKey(segment) === activeSegmentKey);
                    if (!hasActiveSegment && !isBackgroundMode) {
                        setSelectedSegment(null);
                    }
                }
            } else if (!isBackgroundMode) {
                console.warn('API response not successful:', response);
            }
        } catch (error) {
            if (requestId !== segmentsRequestIdRef.current) {
                return;
            }

            console.error('Failed to fetch segments:', error);
            if (!isBackgroundMode) {
                setSegments([]);
                setSegmentsCameraId(null);
                setSelectedSegment(null);
            }
        }
    }, [resetPlaybackSession]);

    // Fetch segments effect
    useEffect(() => {
        if (!selectedCameraId) {
            return;
        }

        loadSegments(selectedCameraId, { mode: 'initial', reset: true });
        const interval = setInterval(() => {
            loadSegments(selectedCameraId, { mode: 'background' });
        }, 10000);

        return () => {
            clearInterval(interval);
        };
    }, [loadSegments, selectedCameraId]);

    useAdminReconnectRefresh(
        () => loadSegments(selectedCameraId, { mode: 'resume' }),
        { enabled: Boolean(selectedCameraId) }
    );

    useEffect(() => {
        if (loading || !selectedSegmentKey || !selectedSegment || !videoRef.current || !selectedCameraId) {
            return;
        }

        if (!selectedSegment.filename || selectedSegment.filename.trim() === '') {
            return;
        }

        const nextStreamUrl = recordingService.getSegmentStreamUrl(selectedCameraId, selectedSegment.filename);
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
                playPromise
                    .then(() => {
                        if (isStale()) {
                            return;
                        }

                        hasStartedPlaybackForSourceRef.current = true;
                        clearBufferingState();
                    })
                    .catch(handleAutoPlayFailure);
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
    }, [clearBufferingState, loading, resetSourcePlaybackState, resetVideoElement, selectedCameraId, selectedSegment, selectedSegmentKey]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.playbackRate = playbackSpeed;
    }, [loading, playbackSpeed]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const hasActiveSource = () => {
            return activeSourceTokenRef.current === sourceLoadTokenRef.current
                && playbackSourceRef.current.streamUrl !== null;
        };

        const markPlaybackProgress = () => {
            const now = Date.now();
            lastPlaybackProgressRef.current = video.currentTime;
            lastPlaybackProgressAtRef.current = now;
            hasStartedPlaybackForSourceRef.current = true;
            clearBufferingState();
        };

        const handleTimeUpdate = () => {
            if (hasActiveSource()) {
                const previousTime = lastPlaybackProgressRef.current;
                const currentVideoTime = video.currentTime;
                if (currentVideoTime > previousTime + 0.01) {
                    markPlaybackProgress();
                }
            }

            setCurrentTime(video.currentTime);
        };
        const handleLoadedMetadata = () => setDuration(video.duration);
        const handleLoadedData = () => {
            if (!hasActiveSource()) {
                return;
            }

            hasLoadedDataForSourceRef.current = true;
            clearBufferingState();
        };

        const handleEnded = () => {
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
        const handlePlaying = () => {
            if (!hasActiveSource()) {
                return;
            }

            hasLoadedDataForSourceRef.current = true;
            markPlaybackProgress();

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

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('loadeddata', handleLoadedData);
        video.addEventListener('ended', handleEnded);
        video.addEventListener('seeking', handleSeeking);
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('canplaythrough', handleCanPlayThrough);
        video.addEventListener('stalled', handleStalled);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('loadeddata', handleLoadedData);
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('seeking', handleSeeking);
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('canplaythrough', handleCanPlayThrough);
            video.removeEventListener('stalled', handleStalled);

            resetBufferingTimeout();
        };
    }, [clearBufferingState, loading, resetBufferingTimeout, selectedSegmentKey, showPlaybackPopunder, updatePlaybackSearchParams]);

    const handleSpeedChange = (speed) => {
        setPlaybackSpeed(speed);
        if (videoRef.current) {
            videoRef.current.playbackRate = speed;
        }
    };

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
        playbackSeekTargetRef.current = 0; // Reset saat diklik manual dari list agar selalu play dari awal segmen
        resetSourcePlaybackState();
    }, [resetSourcePlaybackState, selectedCamera, showPlaybackPopunder, updatePlaybackSearchParams]);

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

    const takeSnapshot = async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            setSnapshotNotification({ type: 'error', message: 'Video belum siap untuk snapshot' });
            setTimeout(() => setSnapshotNotification(null), 3000);
            return;
        }

        const cameraName = selectedCamera?.name || 'camera';

        try {
            const video = videoRef.current;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const watermarkHeight = Math.max(40, canvas.height * 0.08);
            const padding = watermarkHeight * 0.3;
            const fontSize = watermarkHeight * 0.4;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(canvas.width - (watermarkHeight * 4) - padding, canvas.height - watermarkHeight - padding, watermarkHeight * 4, watermarkHeight);

            const logoSize = watermarkHeight * 0.6;
            const logoX = canvas.width - (watermarkHeight * 3.5) - padding;
            const logoY = canvas.height - (watermarkHeight / 2) - padding;

            ctx.fillStyle = '#0ea5e9';
            ctx.beginPath();
            ctx.arc(logoX, logoY, logoSize / 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${logoSize * 0.6}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding.logo_text || 'R', logoX, logoY);

            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding.company_name || 'RAF NET', logoX + logoSize / 2 + padding / 2, logoY - fontSize / 3);

            ctx.font = `${fontSize * 0.7}px Arial`;
            ctx.fillStyle = '#94a3b8';
            const timestamp = new Date().toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            ctx.fillText(timestamp, logoX + logoSize / 2 + padding / 2, logoY + fontSize / 2);

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    setSnapshotNotification({ type: 'error', message: 'Gagal membuat snapshot' });
                    setTimeout(() => setSnapshotNotification(null), 3000);
                    return;
                }

                const filename = `${cameraName}-${Date.now()}.png`;

                if (navigator.share && navigator.canShare) {
                    try {
                        const file = new File([blob], filename, { type: 'image/png' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({ files: [file], title: `Snapshot - ${cameraName}` });
                            setSnapshotNotification({ type: 'success', message: 'Snapshot berhasil dibagikan!' });
                            setTimeout(() => setSnapshotNotification(null), 3000);
                            return;
                        }
                    } catch (err) {
                        if (err.name !== 'AbortError') console.warn('Share failed:', err);
                    }
                }

                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.click();
                URL.revokeObjectURL(url);

                setSnapshotNotification({ type: 'success', message: 'Snapshot berhasil diunduh!' });
                setTimeout(() => setSnapshotNotification(null), 3000);
            }, 'image/png', 0.95);

        } catch (error) {
            console.error('Snapshot error:', error);
            setSnapshotNotification({ type: 'error', message: 'Gagal mengambil snapshot' });
            setTimeout(() => setSnapshotNotification(null), 3000);
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
        setSelectedCameraId(camera.id);
        updatePlaybackSearchParams({
            camera,
            timestamp: null,
            replace: false,
        });
    }, [resetPlaybackSession, showPlaybackPopunder, updatePlaybackSearchParams]);

    // Handle share playback link - use timestamp instead of segment ID
    const handleShare = useCallback(async () => {
        let preciseTimestamp = null;
        if (selectedSegment?.start_time) {
            const baseTimeMs = new Date(selectedSegment.start_time).getTime();
            preciseTimestamp = baseTimeMs;

            if (videoRef.current && typeof videoRef.current.currentTime === 'number') {
                const currentSecsMs = Math.floor(videoRef.current.currentTime * 1000);
                preciseTimestamp += currentSecsMs;
            }
        }

        const shareUrl = buildPublicPlaybackShareUrl({
            searchParams,
            camera: selectedCamera?.id ? createCameraSlug(selectedCamera) : null,
            timestamp: preciseTimestamp,
        });

        const shareData = {
            title: `Playback - ${selectedCamera?.name || 'CCTV'}`,
            text: `Lihat rekaman dari kamera ${selectedCamera?.name || 'CCTV'}`,
            url: shareUrl
        };

        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    await navigator.clipboard.writeText(shareUrl);
                    setSnapshotNotification({ type: 'success', message: 'Tautan disalin ke clipboard!' });
                    setTimeout(() => setSnapshotNotification(null), 3000);
                }
            }
        } else {
            try {
                await navigator.clipboard.writeText(shareUrl);
                setSnapshotNotification({ type: 'success', message: 'Tautan disalin ke clipboard!' });
                setTimeout(() => setSnapshotNotification(null), 3000);
            } catch (err) {
                setSnapshotNotification({ type: 'error', message: 'Gagal menyalin tautan' });
                setTimeout(() => setSnapshotNotification(null), 3000);
            }
        }
    }, [searchParams, selectedCamera, selectedSegment]);



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
                    onShare={handleShare}
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

                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start gap-3">
                        <svg className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                            <h3 className="text-sm sm:text-base font-semibold text-blue-900 dark:text-blue-100 mb-2">Cara Menggunakan Playback</h3>
                            <ul className="space-y-1.5 text-xs sm:text-sm text-blue-800 dark:text-blue-200">
                                <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">•</span><span><strong>Skip Video:</strong> Maksimal lompat 3 menit per sekali skip</span></li>
                                <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">•</span><span><strong>Timeline:</strong> Klik pada timeline untuk melompat ke waktu tertentu</span></li>
                                <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">•</span><span><strong>Kecepatan:</strong> Klik tombol di pojok kanan atas video (0.5x - 2x)</span></li>
                                <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">•</span><span><strong>Segment:</strong> Pilih segment di bawah untuk melihat recording waktu berbeda</span></li>
                            </ul>
                        </div>
                    </div>
                </div>

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
