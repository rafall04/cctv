/*
 * Purpose: Render the single-camera public live popup with stream playback, controls, ads, and viewer stats.
 * Caller: Landing grid and map camera interactions.
 * Deps: React, HLS/FLV utilities, viewerService, popup state/layout utilities, camera detail/related panels, CameraViewerStatsBadges.
 * MainFuncs: VideoPopup.
 * SideEffects: Starts/stops viewer sessions, reports runtime signals, controls media playback/fullscreen, and may take snapshots.
 */

import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import flvjs from 'flv.js';
import { Icons } from '../ui/Icons.jsx';
import CodecBadge from '../CodecBadge.jsx';
import CameraViewerStatsBadges from '../common/CameraViewerStatsBadges.jsx';
import ZoomableVideo from './ZoomableVideo';
import ZoomableMediaFrame from './ZoomableMediaFrame.jsx';
import { detectDeviceTier } from '../../utils/deviceDetector';
import { shouldDisableAnimations } from '../../utils/animationControl';
import { LoadingStage, createStreamError } from '../../utils/streamLoaderTypes';
import { createFallbackHandler } from '../../utils/fallbackHandler';
import { getHLSConfig } from '../../utils/hlsConfig';
import { preloadHls } from '../../utils/preloadManager';
import { resolveStreamUrl } from '../../utils/directStreamHelper';
import { useStreamTimeout } from '../../hooks/useStreamTimeout';
import { viewerService } from '../../services/viewerService';
import { takeSnapshot as takeSnapshotUtil } from '../../utils/snapshotHelper';
import { useBranding } from '../../contexts/BrandingContext';
import { createCameraSlug } from '../../utils/slugify';
import { buildPublicCameraShareUrl } from '../../utils/publicShareUrl';
import PublicStreamStatusOverlay from '../PublicStreamStatusOverlay.jsx';
import InlineAdSlot from '../ads/InlineAdSlot.jsx';
import CameraDetailPanel from './CameraDetailPanel.jsx';
import RelatedCamerasStrip from './RelatedCamerasStrip.jsx';
import { isAdsMobileViewport, shouldRenderAdSlot } from '../ads/adsConfig.js';
import {
    getPublicPopupBodyStyle,
    getPublicPopupModalStyle,
    getVideoAspectRatio,
} from '../../utils/publicPopupLayout.js';
import {
    getPublicPopupErrorType,
    getPublicPopupInitialStatus,
    getPublicPopupOverlayState,
    getPublicPopupStatusDisplay,
    isPublicPopupPlaybackLocked,
    shouldShowPublicPopupRetry,
} from '../../utils/publicPopupState.js';
import {
    getEffectiveDeliveryType,
    getPopupEmbedUrl,
    getPrimaryExternalUrl,
    getStreamCapabilities,
    isHlsDeliveryType,
} from '../../utils/cameraDelivery.js';
import { getCameraAvailabilityState, isCameraHardOffline } from '../../utils/cameraAvailability.js';

// ============================================
// VIDEO POPUP - Optimized with fullscreen detection, timeout handler, progressive stages, and auto-retry
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.3, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3**
// ============================================
function VideoPopup({
    camera,
    onClose,
    adsConfig = null,
    modalTestId = 'grid-popup-modal',
    bodyTestId = 'grid-video-body',
    relatedCameras = [],
    onRelatedCameraClick,
    isFavorite,
    onToggleFavorite,
}) {
    const [searchParams] = useSearchParams();
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const modalRef = useRef(null);
    const outerWrapperRef = useRef(null); // Add ref for outer wrapper
    const headerRef = useRef(null);
    const footerRef = useRef(null);
    const hlsRef = useRef(null);
    const flvRef = useRef(null);
    const fallbackHandlerRef = useRef(null);
    const abortControllerRef = useRef(null);
    const loadingStageRef = useRef(LoadingStage.CONNECTING);
    const autoRetryCountRef = useRef(0);
    const internalWarmupRetryCountRef = useRef(0);
    const internalWarmupRetryTimeoutRef = useRef(null);
    const { branding } = useBranding(); // ← FIX: Add branding context

    // Handle close with fullscreen exit
    const handleClose = async () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            try {
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    await document.webkitExitFullscreen();
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error('Error exiting fullscreen:', error);
            }
        }
        onClose();
    };

    // Share camera URL
    const handleShare = useCallback(async () => {
        const url = buildPublicCameraShareUrl({
            searchParams,
            camera: createCameraSlug(camera),
        });

        if (navigator.share) {
            try {
                await navigator.share({
                    title: `${camera.name} - Live CCTV`,
                    text: `Lihat live streaming CCTV ${camera.name}`,
                    url: url
                });
                return;
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.log('Share cancelled or failed:', err);
                }
            }
        }

        // Fallback: Copy to clipboard
        try {
            await navigator.clipboard.writeText(url);
            alert('Link kamera berhasil disalin!\n\n' + url);
        } catch (err) {
            console.error('Failed to copy:', err);
            prompt('Salin link ini:', url);
        }
    }, [camera, searchParams]);

    // Check camera status first
    const isMaintenance = camera.status === 'maintenance';
    const availabilityState = getCameraAvailabilityState(camera);
    const isOffline = isCameraHardOffline(camera);
    const isMobileAdsViewport = isAdsMobileViewport();

    const [status, setStatus] = useState(() => getPublicPopupInitialStatus(camera));
    const [loadingStage, setLoadingStage] = useState(LoadingStage.CONNECTING);
    const [errorType, setErrorType] = useState(null); // 'codec', 'network', 'timeout', 'media', 'unknown'
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [retryKey, setRetryKey] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [autoRetryCount, setAutoRetryCount] = useState(0);
    const [consecutiveFailures, setConsecutiveFailures] = useState(0);
    const [showTroubleshooting, setShowTroubleshooting] = useState(false);
    const [forceProxyFallback, setForceProxyFallback] = useState(false);
    const [videoAspectRatio, setVideoAspectRatio] = useState(null);
    const [flvPlaybackSupported, setFlvPlaybackSupported] = useState(() => (
        typeof window !== 'undefined' ? flvjs.isSupported() : false
    ));
    const [popupTopAdHeight, setPopupTopAdHeight] = useState(0);
    const [popupBottomAdHeight, setPopupBottomAdHeight] = useState(0);
    const [layoutMetrics, setLayoutMetrics] = useState(() => ({
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
        headerHeight: 0,
        footerHeight: 0,
    }));

    const deliveryType = getEffectiveDeliveryType(camera);
    const streamCapabilities = getStreamCapabilities(camera);
    const isHlsCamera = isHlsDeliveryType(deliveryType);
    const popupEmbedUrl = getPopupEmbedUrl(camera);
    const fallbackExternalUrl = getPrimaryExternalUrl(camera);
    const flvUrl = deliveryType === 'external_flv'
        ? (camera.external_stream_url || camera.external_hls_url || null)
        : null;
    const officialSourceUrl = popupEmbedUrl || (/^https?:\/\//i.test((deliveryType === 'external_flv' ? flvUrl : fallbackExternalUrl) || '') ? (deliveryType === 'external_flv' ? flvUrl : fallbackExternalUrl) : null);
    const url = camera.streams?.hls;
    const deviceTier = detectDeviceTier();
    const isExternal = deliveryType === 'external_hls';
    const { targetUrl: resolvedUrl, proxyFallbackUrl, isDirectStream } = resolveStreamUrl(camera, { forceProxy: forceProxyFallback });
    const effectiveUrl = isHlsCamera
        ? (resolvedUrl || url)
        : (deliveryType === 'external_flv' ? flvUrl : (popupEmbedUrl || fallbackExternalUrl));
    const passiveSignalUrl = (deliveryType === 'external_flv' ? flvUrl : null) || officialSourceUrl || effectiveUrl || null;
    const shouldTrackManualViewerSession = streamCapabilities.popup && (!isHlsCamera || isDirectStream);

    const reportRuntimeSuccess = useCallback((signalType) => {
        if (camera.stream_source !== 'external') {
            return;
        }

        viewerService.reportRuntimeSignal(camera.id, {
            targetUrl: passiveSignalUrl,
            signalType,
            success: true,
        });
    }, [camera.id, camera.stream_source, passiveSignalUrl]);

    const reportRuntimeFailure = useCallback((signalType) => {
        if (camera.stream_source !== 'external') {
            return;
        }

        viewerService.reportRuntimeSignal(camera.id, {
            targetUrl: passiveSignalUrl,
            signalType,
            success: false,
        });
    }, [camera.id, camera.stream_source, passiveSignalUrl]);

    useEffect(() => {
        if (
            (deliveryType !== 'external_mjpeg' && deliveryType !== 'external_flv')
            || isMaintenance
            || isOffline
            || status === 'error'
            || !effectiveUrl
        ) {
            return undefined;
        }

        const intervalId = setInterval(() => {
            if (status !== 'error') {
                reportRuntimeSuccess(deliveryType === 'external_flv' ? 'external_flv_live_tick' : 'external_mjpeg_live_tick');
            }
        }, 25000);

        return () => {
            clearInterval(intervalId);
        };
    }, [deliveryType, effectiveUrl, isMaintenance, isOffline, reportRuntimeSuccess, status]);

    useEffect(() => {
        loadingStageRef.current = loadingStage;
    }, [loadingStage]);

    useEffect(() => {
        autoRetryCountRef.current = autoRetryCount;
    }, [autoRetryCount]);

    const clearInternalWarmupRetry = useCallback(() => {
        if (internalWarmupRetryTimeoutRef.current) {
            clearTimeout(internalWarmupRetryTimeoutRef.current);
            internalWarmupRetryTimeoutRef.current = null;
        }
    }, []);

    useEffect(() => {
        internalWarmupRetryCountRef.current = 0;
        clearInternalWarmupRetry();
    }, [camera.id, effectiveUrl, clearInternalWarmupRetry]);

    useEffect(() => {
        if (isMaintenance || isOffline) {
            return;
        }

        if (!isHlsCamera && deliveryType !== 'external_flv' && streamCapabilities.popup) {
            setStatus(availabilityState === 'degraded' ? 'degraded' : (effectiveUrl ? 'playing' : 'error'));
            setLoadingStage(LoadingStage.BUFFERING);
            setErrorType(effectiveUrl ? null : 'unknown');
        }
    }, [availabilityState, deliveryType, effectiveUrl, isHlsCamera, isMaintenance, isOffline, streamCapabilities.popup]);

    useEffect(() => {
        setFlvPlaybackSupported(typeof window !== 'undefined' ? flvjs.isSupported() : false);
    }, [camera.id]);

    const syncVideoAspectRatio = useCallback(() => {
        const nextAspectRatio = getVideoAspectRatio(videoRef.current);
        if (nextAspectRatio) {
            setVideoAspectRatio(nextAspectRatio);
        }
    }, []);
    const requestVideoPlay = useCallback((target = videoRef.current) => {
        if (!target?.play) return;
        try {
            const playAttempt = target.play();
            if (playAttempt?.catch) {
                playAttempt.catch(() => { });
            }
        } catch {
            // Ignore autoplay/runtime failures; popup state machine handles recoverable errors separately.
        }
    }, []);

    // Track fullscreen state to disable animations and unlock orientation on exit
    useEffect(() => {
        const handleFullscreenChange = () => {
            const isNowFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
            setIsFullscreen(isNowFullscreen);

            // Unlock orientation when exiting fullscreen (e.g., via ESC key)
            if (!isNowFullscreen && screen.orientation && screen.orientation.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (err) {
                    // Ignore unlock errors
                }
            }
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            // Cleanup: unlock orientation on unmount
            if (screen.orientation && screen.orientation.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (err) {
                    // Ignore unlock errors
                }
            }
        };
    }, []);

    // Viewer session tracking - track when user starts/stops watching
    useEffect(() => {
        // Proxied HLS is tracked by the HLS proxy; direct/external streams still need frontend-owned sessions.
        if (isMaintenance || isOffline || !shouldTrackManualViewerSession) return;

        let isActive = true;
        let sessionId = null;

        // Start viewer session
        const startTracking = async () => {
            const nextSessionId = await viewerService.startSession(camera.id);

            if (!isActive) {
                if (nextSessionId) {
                    Promise.resolve(viewerService.stopSession(nextSessionId)).catch(() => { });
                }
                return;
            }

            sessionId = nextSessionId;
        };

        startTracking();

        // Cleanup: stop session when popup closes
        return () => {
            isActive = false;
            if (sessionId) {
                Promise.resolve(viewerService.stopSession(sessionId)).catch(err => {
                    console.error('[VideoPopup] Failed to stop viewer session:', err);
                });
            }
        };
    }, [camera.id, isMaintenance, isOffline, shouldTrackManualViewerSession]);

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose]);
    // Stream Timeout Hook - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
    const {
        startTimeout,
        clearTimeout: clearStreamTimeout,
        updateStage: updateStreamStage,
        resetFailures,
        getConsecutiveFailures,
     } = useStreamTimeout({
        deviceTier,
        onTimeout: () => {
            cleanupResources();
            setStatus('timeout');
            setErrorType('timeout');
            setLoadingStage(LoadingStage.TIMEOUT);
            setConsecutiveFailures(getConsecutiveFailures());
        },
        onMaxFailures: (failures) => {
            setShowTroubleshooting(true);
            setConsecutiveFailures(failures);
        }
    });

    // Initialize FallbackHandler for auto-retry - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    useEffect(() => {
        fallbackHandlerRef.current = createFallbackHandler({
            maxAutoRetries: 3,
            onAutoRetry: ({ attempt }) => {
                setAutoRetryCount(attempt);
            },
            onAutoRetryExhausted: ({ totalAttempts }) => {
                setAutoRetryCount(totalAttempts);
            },
            onNetworkRestore: () => {
                // Note: We don't auto-retry on network restore in popup
                // User can manually retry if needed
            },
            onManualRetryRequired: () => {
            },
        });

        return () => {
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.destroy();
                fallbackHandlerRef.current = null;
            }
        };
    }, []);

    // Cleanup resources function - **Validates: Requirements 7.1, 7.2, 7.3**
    const cleanupResources = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        clearInternalWarmupRetry();
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (flvRef.current) {
            flvRef.current.destroy();
            flvRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = '';
            videoRef.current.load();
        }
        clearStreamTimeout();
        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.clearPendingRetry();
        }
    }, [clearInternalWarmupRetry, clearStreamTimeout]);

    useEffect(() => {
        // Skip HLS loading if camera is in maintenance or offline
        if (isMaintenance || isOffline || !isHlsCamera) return;
        if (!effectiveUrl || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        let HlsClass = null;
        let cancelled = false;
        let playbackCheckInterval = null;
        let isLive = false; // Flag to prevent setState after live

        abortControllerRef.current = new AbortController();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);
        setVideoAspectRatio(null);

        // Start loading timeout - **Validates: Requirements 1.1**
        startTimeout(LoadingStage.CONNECTING);

        // Only change to 'live' once video starts playing - don't revert on buffering
        const handlePlaying = () => {
            if (cancelled || isLive) return; // Skip if already live
            isLive = true; // Set flag to prevent future setState
            clearInterval(playbackCheckInterval);
            playbackCheckInterval = null;
            setStatus('live');
            setLoadingStage(LoadingStage.PLAYING);
            // Clear timeout on success
            clearStreamTimeout();
            syncVideoAspectRatio();
            resetFailures();
            internalWarmupRetryCountRef.current = 0;
            clearInternalWarmupRetry();
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.reset();
            }
            setAutoRetryCount(0);
            setConsecutiveFailures(0);
            reportRuntimeSuccess('external_hls_runtime_playing');
        };

        // Fallback: Check video state periodically
        // Some browsers don't fire 'playing' event reliably
        const startPlaybackCheck = () => {
            playbackCheckInterval = setInterval(() => {
                if (cancelled || isLive) {
                    clearInterval(playbackCheckInterval);
                    playbackCheckInterval = null;
                    return;
                }
                // Check if video is actually playing (has time progress or buffered data)
                if (video.readyState >= 3 && video.buffered.length > 0) {
                    // Video has enough data - consider it playing
                    if (!video.paused || video.currentTime > 0) {
                        handlePlaying();
                    } else {
                        // Try to play again
                        requestVideoPlay(video);
                    }
                }
            }, 500);
        };

        const handleError = () => {
            if (cancelled || isLive) return; // Don't show error if already playing
            clearInterval(playbackCheckInterval);
            playbackCheckInterval = null;
            setStatus('error');
            setLoadingStage(LoadingStage.ERROR);
            reportRuntimeFailure('external_hls_runtime_error');
        };

        const handleLoadedMetadata = () => {
            if (cancelled) return;
            syncVideoAspectRatio();
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('error', handleError);

        // Live Edge Synchronization Fix
        const handlePlaySync = () => {
            if (cancelled || !hls || !isExternal) return;
            if (hls.liveSyncPosition) {
                const latency = hls.liveSyncPosition - video.currentTime;
                // If we are more than 10 seconds behind live edge, sync it
                if (latency > 10) {
                    console.log(`[VideoPopup] Stale buffer detected (Latency: ${latency.toFixed(1)}s). Syncing to live edge...`);
                    video.currentTime = hls.liveSyncPosition;
                }
            }
        };
        video.addEventListener('play', handlePlaySync);

        // Direct HLS.js usage - no lazy loading needed
        if (cancelled) return;

        // Update loading stage - **Validates: Requirements 4.2**
        setLoadingStage(LoadingStage.LOADING);
        updateStreamStage(LoadingStage.LOADING);

        const initNative = () => {
            video.src = effectiveUrl;
            video.addEventListener('loadedmetadata', () => requestVideoPlay(video));
        };

        const initHls = async () => {
            HlsClass = await preloadHls();
            if (cancelled || !HlsClass) return;

            const deviceTier = detectDeviceTier();
            const hlsConfig = getHLSConfig(deviceTier, {
                isMobile: false,
                mobileDeviceType: null,
            });
            hls = new HlsClass(hlsConfig);
            hlsRef.current = hls;

            // Load source first, then attach media with small delay
            // This helps prevent media errors on some browsers
            hls.loadSource(effectiveUrl);
            setTimeout(() => {
                if (!cancelled && hlsRef.current) {
                    hls.attachMedia(video);
                    startPlaybackCheck();
                }
            }, 50);

            // Start playback check early - don't wait for events that may not fire
            startPlaybackCheck();

            hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
                if (cancelled || isLive) return; // Skip if already live
                // Update to buffering stage
                setLoadingStage(LoadingStage.BUFFERING);
                updateStreamStage(LoadingStage.BUFFERING);
                requestVideoPlay(video);
            });

            // FRAG_LOADED fires when first fragment is loaded - more reliable than MANIFEST_PARSED
            hls.on(HlsClass.Events.FRAG_LOADED, () => {
                if (cancelled || isLive) return; // Skip if already live
                // If still in LOADING stage, move to BUFFERING
                setLoadingStage(prev => {
                    if (prev === LoadingStage.LOADING || prev === LoadingStage.CONNECTING) {
                        updateStreamStage(LoadingStage.BUFFERING);
                        return LoadingStage.BUFFERING;
                    }
                    return prev;
                });
                // Try to play
                if (video.paused) {
                    requestVideoPlay(video);
                }
            });

            hls.on(HlsClass.Events.FRAG_BUFFERED, () => {
                if (cancelled || isLive) return; // Skip if already live
                // Langsung set PLAYING dan status live setelah buffered
                handlePlaying(); // Use handlePlaying to set isLive flag
            });

            hls.on(HlsClass.Events.ERROR, (_, d) => {
                if (cancelled || isLive) return; // Don't handle errors if already playing

                // For non-fatal errors, just continue
                if (!d.fatal) return;

                // Clear loading timeout
                clearStreamTimeout();
                const detectedErrorType = getPublicPopupErrorType({
                    hlsError: {
                        ...d,
                        type: d.type === HlsClass.ErrorTypes.NETWORK_ERROR
                            ? 'networkError'
                            : d.type === HlsClass.ErrorTypes.MEDIA_ERROR
                                ? 'mediaError'
                                : 'unknownError',
                    },
                    streamSource: camera.stream_source,
                });

                const isInternalManifestWarmup404 =
                    !isExternal &&
                    d.type === HlsClass.ErrorTypes.NETWORK_ERROR &&
                    d.response?.code === 404 &&
                    (
                        d.details === 'manifestLoadError' ||
                        d.details === 'levelLoadError'
                    );

                if (isInternalManifestWarmup404 && internalWarmupRetryCountRef.current < 3) {
                    internalWarmupRetryCountRef.current += 1;
                    setStatus('connecting');
                    setErrorType(null);
                    setLoadingStage(LoadingStage.CONNECTING);
                    updateStreamStage(LoadingStage.CONNECTING);
                    clearInternalWarmupRetry();
                    internalWarmupRetryTimeoutRef.current = setTimeout(() => {
                        internalWarmupRetryTimeoutRef.current = null;
                        if (!cancelled) {
                            setRetryKey((current) => current + 1);
                        }
                    }, 1200);
                    return;
                }

                // Aggressive network error recovery for external streams
                if (isExternal && d.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
                    if (!hls._networkErrorRecoveryCount) hls._networkErrorRecoveryCount = 0;
                    hls._networkErrorRecoveryCount++;

                    if (hls._networkErrorRecoveryCount <= 5) {
                        console.log(`[VideoPopup] Recovering external stream network error (${hls._networkErrorRecoveryCount}/5)`);
                        hls.startLoad();

                        // Jump to live sync directly on network error recovery to avoid 404s
                        if (hls.liveSyncPosition) {
                            video.currentTime = hls.liveSyncPosition;
                        }

                        requestVideoPlay(video);
                        return;
                    }

                    // CORS Fallback: if direct stream failed after 5 retries, switch to proxy
                    if (isDirectStream && proxyFallbackUrl) {
                        console.log('[VideoPopup] Direct stream failed, falling back to proxy');
                        setForceProxyFallback(true);
                        return;
                    }
                }
                // For media errors, try recovery (max 2 times)
                if (d.type === HlsClass.ErrorTypes.MEDIA_ERROR) {
                    if (!hls._mediaErrorRecoveryCount) hls._mediaErrorRecoveryCount = 0;
                    hls._mediaErrorRecoveryCount++;

                    if (hls._mediaErrorRecoveryCount <= 2) {
                        hls.recoverMediaError();
                        return;
                    }
                }

                // Try auto-retry with FallbackHandler
                if (fallbackHandlerRef.current) {
                    const streamError = createStreamError({
                        type: detectedErrorType,
                        message: d.details || 'Stream error',
                        stage: loadingStageRef.current,
                        deviceTier,
                        retryCount: autoRetryCountRef.current,
                    });

                    const result = fallbackHandlerRef.current.handleError(streamError, () => {
                        if (!cancelled && hls) {
                            setLoadingStage(LoadingStage.CONNECTING);
                            hls.destroy();
                            const newHlsConfig = getHLSConfig(deviceTier, {
                                isMobile: false,
                                mobileDeviceType: null,
                            });
                            const newHls = new HlsClass(newHlsConfig);
                            hlsRef.current = newHls;
                            newHls.loadSource(effectiveUrl);
                            newHls.attachMedia(video);

                            newHls.on(HlsClass.Events.MANIFEST_PARSED, () => {
                                if (cancelled) return;
                                setLoadingStage(LoadingStage.BUFFERING);
                                requestVideoPlay(video);
                            });

                            newHls.on(HlsClass.Events.ERROR, (_, d2) => {
                                if (cancelled) return;
                                if (d2.fatal) {
                                    setStatus('error');
                                    setErrorType(detectedErrorType);
                                    setLoadingStage(LoadingStage.ERROR);
                                }
                            });
                        }
                    });

                    if (result.action === 'manual-retry-required') {
                        setStatus('error');
                        setErrorType(detectedErrorType);
                        setLoadingStage(LoadingStage.ERROR);
                    }
                } else {
                    setStatus('error');
                    setErrorType(detectedErrorType);
                    setLoadingStage(LoadingStage.ERROR);
                }
            });
        };

        // Standard priority for internal streams and external streams alike
        const initializePlayback = async () => {
            const loadedHls = await preloadHls();
            if (cancelled) return;
            HlsClass = loadedHls;

            if (HlsClass?.isSupported()) {
                await initHls();
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                initNative();
            }
        };

        initializePlayback();

        return () => {
            cancelled = true;
            clearInterval(playbackCheckInterval);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('error', handleError);
            video.removeEventListener('play', handlePlaySync);
            cleanupResources();
            if (hls) { hls.destroy(); hlsRef.current = null; }
        };
    }, [camera.id, camera.stream_source, cleanupResources, clearInternalWarmupRetry, clearStreamTimeout, deviceTier, isExternal, isHlsCamera, isMaintenance, isOffline, requestVideoPlay, resetFailures, retryKey, startTimeout, syncVideoAspectRatio, updateStreamStage, effectiveUrl, forceProxyFallback, isDirectStream, proxyFallbackUrl, reportRuntimeFailure, reportRuntimeSuccess]);

    useEffect(() => {
        if (isMaintenance || isOffline || deliveryType !== 'external_flv') return;
        if (!videoRef.current) return;

        if (!flvjs.isSupported()) {
            setFlvPlaybackSupported(false);
            setStatus(popupEmbedUrl ? 'playing' : 'error');
            setLoadingStage(popupEmbedUrl ? LoadingStage.BUFFERING : LoadingStage.ERROR);
            setErrorType(popupEmbedUrl ? null : 'media');
            return;
        }

        if (!effectiveUrl) {
            setStatus('error');
            setLoadingStage(LoadingStage.ERROR);
            setErrorType('unknown');
            return;
        }

        setFlvPlaybackSupported(true);
        const video = videoRef.current;
        let cancelled = false;
        const player = flvjs.createPlayer({
            type: 'flv',
            isLive: true,
            url: effectiveUrl,
        }, {
            enableStashBuffer: false,
            stashInitialSize: 128,
            autoCleanupSourceBuffer: true,
        });
        flvRef.current = player;

        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);
        setErrorType(null);
        setVideoAspectRatio(null);

        const handlePlaying = () => {
            if (cancelled) return;
            setStatus('live');
            setLoadingStage(LoadingStage.PLAYING);
            syncVideoAspectRatio();
            reportRuntimeSuccess('external_flv_runtime_playing');
        };

        const handleLoadedMetadata = () => {
            if (cancelled) return;
            syncVideoAspectRatio();
            setLoadingStage(LoadingStage.BUFFERING);
            requestVideoPlay(video);
        };

        const handleFatalError = () => {
            if (cancelled) return;
            setStatus(popupEmbedUrl ? 'playing' : 'error');
            setLoadingStage(popupEmbedUrl ? LoadingStage.BUFFERING : LoadingStage.ERROR);
            setErrorType(popupEmbedUrl ? null : 'media');
            reportRuntimeFailure('external_flv_runtime_error');
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('error', handleFatalError);
        player.on(flvjs.Events.ERROR, handleFatalError);

        try {
            player.attachMediaElement(video);
            player.load();
            requestVideoPlay(video);
        } catch {
            handleFatalError();
        }

        return () => {
            cancelled = true;
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('error', handleFatalError);
            if (flvRef.current) {
                flvRef.current.destroy();
                flvRef.current = null;
            }
        };
    }, [deliveryType, effectiveUrl, isMaintenance, isOffline, popupEmbedUrl, reportRuntimeFailure, reportRuntimeSuccess, requestVideoPlay, syncVideoAspectRatio]);

    const handleRetry = useCallback(() => {
        cleanupResources();
        setStatus('connecting');
        setErrorType(null);
        setLoadingStage(LoadingStage.CONNECTING);
        setAutoRetryCount(0);
        setShowTroubleshooting(false);
        internalWarmupRetryCountRef.current = 0;
        resetFailures();
        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.reset();
        }
        setRetryKey(k => k + 1);
    }, [cleanupResources, resetFailures]);

    const toggleFS = async () => {
        try {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                // Enter fullscreen
                if (outerWrapperRef.current?.requestFullscreen) {
                    await outerWrapperRef.current.requestFullscreen();
                } else if (outerWrapperRef.current?.webkitRequestFullscreen) {
                    await outerWrapperRef.current.webkitRequestFullscreen();
                }

                // Reset zoom to 1.0 when entering fullscreen to avoid "auto zoom" effect
                const wrapper = getZoomableWrapper();
                if (wrapper && wrapper._reset) {
                    wrapper._reset();
                }

                // Lock to landscape orientation on mobile
                if (screen.orientation && screen.orientation.lock) {
                    try {
                        await screen.orientation.lock('landscape').catch(() => {
                            // Fallback: try landscape-primary if landscape fails
                            screen.orientation.lock('landscape-primary').catch(() => { });
                        });
                    } catch (err) {
                        // Orientation lock not supported or failed, continue anyway
                        console.log('Orientation lock not supported');
                    }
                }
            } else {
                // Exit fullscreen
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    await document.webkitExitFullscreen();
                }

                // Reset zoom when exiting fullscreen
                const wrapper = getZoomableWrapper();
                if (wrapper && wrapper._reset) {
                    wrapper._reset();
                }

                // Unlock orientation
                if (screen.orientation && screen.orientation.unlock) {
                    try {
                        screen.orientation.unlock();
                    } catch (err) {
                        // Ignore unlock errors
                    }
                }
            }
        } catch (err) {
            console.error('Fullscreen error:', err);
        }
    };

    const takeSnapshot = async () => {
        if (!isHlsCamera || !videoRef.current || status !== 'live') {
            setSnapshotNotification({
                type: 'error',
                message: 'Snapshot hanya tersedia untuk stream video yang didukung'
            });
            setTimeout(() => setSnapshotNotification(null), 3000);
            return;
        }

        const result = await takeSnapshotUtil(videoRef.current, {
            branding,
            cameraName: camera.name,
            watermarkEnabled: branding.watermark_enabled === 'true',
            watermarkText: branding.watermark_text,
            watermarkPosition: branding.watermark_position || 'bottom-right',
            watermarkOpacity: parseFloat(branding.watermark_opacity || 0.9)
        });

        setSnapshotNotification({
            type: result.success ? 'success' : 'error',
            message: result.message
        });

        setTimeout(() => setSnapshotNotification(null), 3000);
    };

    // Get wrapper ref for zoom controls - directly access ZoomableVideo wrapper
    const getZoomableWrapper = () => {
        // ZoomableVideo is the first child of wrapperRef
        return wrapperRef.current?.firstElementChild;
    };

    // Get status display info - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    const statusDisplay = getPublicPopupStatusDisplay({
        status,
        loadingStage,
        errorType,
        isTunnel: camera.is_tunnel === 1 || camera.is_tunnel === true,
    });
    const overlayState = getPublicPopupOverlayState({ status, loadingStage, errorType });
    const isPlaybackLocked = isPublicPopupPlaybackLocked(status);
    const canRetry = shouldShowPublicPopupRetry({ status, errorType });
    const popupAdsEnabled = adsConfig?.popup?.enabled !== false;
    const popupMaxHeight = isMobileAdsViewport
        ? (adsConfig?.popup?.maxHeight?.mobile || 220)
        : (adsConfig?.popup?.maxHeight?.desktop || 160);
    const popupTopEligible =
        popupAdsEnabled &&
        !isFullscreen &&
        shouldRenderAdSlot(adsConfig, 'popupTopBanner', isMobileAdsViewport);
    const popupBottomEligible =
        popupAdsEnabled &&
        !isFullscreen &&
        shouldRenderAdSlot(adsConfig, 'popupBottomNative', isMobileAdsViewport);
    const showPopupBottomNative = popupBottomEligible;
    const showPopupTopBanner = popupTopEligible && (isMobileAdsViewport || !showPopupBottomNative);
    const bodyMinHeightClass = showPopupBottomNative
        ? 'min-h-[180px] sm:min-h-[220px] md:min-h-[280px]'
        : 'min-h-[220px] sm:min-h-[280px] md:min-h-[340px]';
    const bodyStyle = getPublicPopupBodyStyle({
        isFullscreen,
        isPlaybackLocked,
        videoAspectRatio,
    });
    const modalStyle = getPublicPopupModalStyle({
        isFullscreen,
        isPlaybackLocked,
        videoAspectRatio,
        viewportWidth: layoutMetrics.viewportWidth,
        viewportHeight: layoutMetrics.viewportHeight,
        headerHeight: layoutMetrics.headerHeight,
        footerHeight: layoutMetrics.footerHeight,
        topAdHeight: popupTopAdHeight,
        bottomAdHeight: popupBottomAdHeight,
        maxDesktopWidth: 1024,
    });

    // Check if animations should be disabled on low-end devices - **Validates: Requirements 5.2**
    const disableAnimations = shouldDisableAnimations();
    const isVideoActive = status === 'live';

    useLayoutEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const updateLayoutMetrics = () => {
            setLayoutMetrics({
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                headerHeight: headerRef.current?.offsetHeight || 0,
                footerHeight: footerRef.current?.offsetHeight || 0,
            });
        };

        updateLayoutMetrics();
        window.addEventListener('resize', updateLayoutMetrics);
        return () => window.removeEventListener('resize', updateLayoutMetrics);
    }, [
        isFullscreen,
        isPlaybackLocked,
        isVideoActive,
        status,
        loadingStage,
        errorType,
        videoAspectRatio,
        popupTopAdHeight,
        popupBottomAdHeight,
    ]);

    return (
        <div ref={outerWrapperRef} className={`fixed inset-0 z-[1000000] ${isFullscreen ? 'bg-black dark:bg-black' : 'flex items-center justify-center bg-black/95 dark:bg-black/95 p-2 sm:p-4'}`} onClick={onClose}>
            <div ref={modalRef} data-testid={modalTestId} className={`relative bg-white dark:bg-gray-900 shadow-2xl flex flex-col ${isFullscreen ? 'w-full h-full overflow-hidden' : 'w-full max-w-5xl overflow-x-hidden overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-800'}`} style={modalStyle} onClick={(e) => e.stopPropagation()}>

                {showPopupTopBanner && (
                    <InlineAdSlot
                        slotKey="popup-top-banner"
                        label="Sponsored"
                        script={adsConfig.slots.popupTopBanner.script}
                        variant="popup-inline"
                        className="border-b border-gray-200 bg-white/90 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/90"
                        minHeightClassName="min-h-[96px]"
                        maxHeight={popupMaxHeight}
                        onHeightChange={setPopupTopAdHeight}
                    />
                )}

                {/* Header Info - di atas video (hide in fullscreen) */}
                {!isFullscreen && (
                    <div ref={headerRef} className="p-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <h3 className="text-gray-900 dark:text-white font-bold text-sm sm:text-base truncate">{camera.name}</h3>
                                {camera.video_codec && (
                                    <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                                )}
                            </div>
                            {/* Status badges */}
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={handleShare}
                                    className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                                    title="Bagikan link kamera"
                                >
                                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                    </svg>
                                </button>
                                <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${statusDisplay.color}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${statusDisplay.dotColor} ${status === 'live' && !disableAnimations ? 'animate-pulse' : ''}`} />
                                    {statusDisplay.label}
                                </span>
                            </div>
                        </div>
                        {/* Location + Area */}
                        {(camera.location || camera.area_name) && (
                            <div className="flex items-center gap-2 mt-1.5">
                                {camera.location && (
                                    <span className="text-gray-600 dark:text-gray-400 text-xs flex items-center gap-1 truncate">
                                        <Icons.MapPin />
                                        <span className="truncate">{camera.location}</span>
                                    </span>
                                )}
                                {camera.area_name && (
                                    <span className="px-1.5 py-0.5 bg-primary/20 text-primary-600 dark:text-primary-400 rounded text-[10px] font-medium shrink-0">
                                        {camera.area_name}
                                    </span>
                                )}
                            </div>
                        )}
                        <CameraViewerStatsBadges camera={camera} className="mt-2" />
                    </div>
                )}

                {!isFullscreen && (
                    <CameraDetailPanel
                        camera={camera}
                        isFavorite={Boolean(isFavorite?.(camera.id))}
                        onShare={handleShare}
                        onToggleFavorite={onToggleFavorite}
                    />
                )}

                {/* Video - expand to full screen in fullscreen mode */}
                <div
                    ref={wrapperRef}
                    data-testid={bodyTestId}
                    className={`relative bg-gray-100 dark:bg-black overflow-hidden ${isFullscreen ? 'flex-1 min-h-0' : `w-full ${!isVideoActive ? bodyMinHeightClass : ''}`}`}
                    style={bodyStyle}
                    onDoubleClick={toggleFS}
                >
                    {isHlsCamera || (deliveryType === 'external_flv' && flvPlaybackSupported) ? (
                        <ZoomableVideo videoRef={videoRef} maxZoom={4} onZoomChange={setZoom} isFullscreen={isFullscreen} />
                    ) : deliveryType === 'external_mjpeg' && effectiveUrl ? (
                        <ZoomableMediaFrame maxZoom={4} onZoomChange={setZoom}>
                            <img
                                src={effectiveUrl}
                                alt={camera.name}
                                data-testid="external-mjpeg-body"
                                className="w-full h-full object-contain bg-black pointer-events-none"
                                onLoad={() => {
                                    setStatus('live');
                                    setLoadingStage(LoadingStage.PLAYING);
                                    reportRuntimeSuccess('external_mjpeg_open');
                                }}
                                onError={() => {
                                    setStatus('error');
                                    setLoadingStage(LoadingStage.ERROR);
                                    reportRuntimeFailure('external_mjpeg_image_error');
                                }}
                            />
                        </ZoomableMediaFrame>
                    ) : popupEmbedUrl ? (
                        <ZoomableMediaFrame maxZoom={3} onZoomChange={setZoom}>
                            <iframe
                                src={popupEmbedUrl}
                                title={camera.name}
                                data-testid="external-embed-body"
                                className="w-full h-full border-0 bg-black"
                                allow="autoplay; fullscreen"
                                referrerPolicy="strict-origin-when-cross-origin"
                                onLoad={() => {
                                    setStatus('live');
                                    setLoadingStage(LoadingStage.PLAYING);
                                    reportRuntimeSuccess('external_embed_frame_load');
                                }}
                            />
                        </ZoomableMediaFrame>
                    ) : effectiveUrl ? (
                        <ZoomableMediaFrame maxZoom={2} onZoomChange={setZoom}>
                            <div data-testid="external-source-fallback" className="absolute inset-0 flex items-center justify-center bg-black p-6">
                                <div className="max-w-md text-center text-white space-y-4">
                                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                                        <Icons.Play />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold">Sumber Eksternal</h3>
                                        <p className="mt-2 text-sm text-gray-300">
                                            Format stream ini tidak diputar langsung oleh player internal. Buka sumber resmi untuk melihat CCTV dari penyedia asal.
                                        </p>
                                    </div>
                                    {officialSourceUrl ? (
                                        <a
                                            href={officialSourceUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
                                        >
                                            Buka Sumber Resmi
                                        </a>
                                    ) : (
                                        <p className="text-xs text-gray-400 break-all">{effectiveUrl}</p>
                                    )}
                                </div>
                            </div>
                        </ZoomableMediaFrame>
                    ) : null}

                    {/* Snapshot Notification */}
                    {snapshotNotification && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                            <div className={`px-5 py-3 rounded-xl shadow-2xl border-2 ${snapshotNotification.type === 'success'
                                ? 'bg-green-500 border-green-400'
                                : 'bg-red-500 border-red-400'
                                } text-white animate-slide-down`}>
                                <div className="flex items-center gap-3">
                                    {snapshotNotification.type === 'success' ? (
                                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    <p className="font-semibold text-sm">{snapshotNotification.message}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Floating controls for fullscreen mode - Always visible on mobile */}
                    {isFullscreen && (
                        <>
                            <div className="absolute top-0 left-0 right-0 z-50 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h2 className="text-white font-bold text-lg">{camera.name}</h2>
                                        {camera.video_codec && (
                                            <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                                        )}
                                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${statusDisplay.color}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${statusDisplay.dotColor}`} />
                                            {statusDisplay.label}
                                        </span>
                                        <CameraViewerStatsBadges camera={camera} tone="overlay" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleShare}
                                            className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 rounded-xl text-white"
                                            title="Bagikan link kamera"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                            </svg>
                                        </button>
                                        {status === 'live' && isHlsCamera && <button onClick={takeSnapshot} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10"><Icons.Image /></button>}
                                        <button onClick={toggleFS} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                                            </svg>
                                        </button>
                                        <button onClick={handleClose} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10"><Icons.X /></button>
                                    </div>
                                </div>
                                {/* Codec info detail - fullscreen mode */}
                                {camera.video_codec && (
                                    <div className="mt-2 flex items-center gap-2 text-xs">
                                        <span className="text-gray-300">
                                            Codec: <strong className="text-white">{camera.video_codec.toUpperCase()}</strong>
                                        </span>
                                        {camera.video_codec === 'h265' && (
                                            <span className="text-yellow-400 text-[10px]">
                                                ⚠ Terbaik di Safari
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {!isPlaybackLocked && (
                                <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1 bg-gray-200/90 dark:bg-gray-900/80 rounded-xl p-1 pointer-events-auto">
                                    <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded-lg text-gray-900 dark:text-white"><Icons.ZoomOut /></button>
                                    <span className="text-gray-900 dark:text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                                    <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 4} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded-lg text-gray-900 dark:text-white"><Icons.ZoomIn /></button>
                                    {zoom > 1 && <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 rounded-lg text-gray-900 dark:text-white ml-1"><Icons.Reset /></button>}
                                </div>
                            )}
                        </>
                    )}
                    <PublicStreamStatusOverlay
                        state={overlayState}
                        onRetry={canRetry ? handleRetry : null}
                        showTroubleshooting={showTroubleshooting}
                        consecutiveFailures={consecutiveFailures}
                        disableAnimations={disableAnimations}
                    />
                </div>

                {/* Controls Panel + Codec Description - hide in fullscreen */}
                <div ref={footerRef} className={`shrink-0 border-t border-gray-200 dark:border-gray-800 ${isFullscreen ? 'hidden' : ''}`}>
                    <RelatedCamerasStrip
                        cameras={relatedCameras}
                        onCameraClick={onRelatedCameraClick}
                    />

                    {/* Controls */}
                    <div className="p-3 flex items-center justify-between">
                        {/* Camera Description - Kiri Bawah */}
                        <div className="text-xs text-gray-600 dark:text-gray-400 flex-1 min-w-0 mr-3">
                            {camera.description ? (
                                <span className="line-clamp-2">{camera.description}</span>
                            ) : (
                                <span className="text-gray-500 dark:text-gray-500 italic">Tidak ada deskripsi</span>
                            )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                            {!isPlaybackLocked && (
                                <>
                                    <div className="flex items-center gap-0.5 bg-gray-200/90 dark:bg-gray-800 rounded-lg p-0.5">
                                        <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 disabled:opacity-30 rounded text-gray-900 dark:text-white transition-colors" title="Zoom Out">
                                            <Icons.ZoomOut />
                                        </button>
                                        <span className="text-gray-900 dark:text-white text-[10px] font-medium w-8 text-center">{Math.round(zoom * 100)}%</span>
                                        <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 4} className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 disabled:opacity-30 rounded text-gray-900 dark:text-white transition-colors" title="Zoom In">
                                            <Icons.ZoomIn />
                                        </button>
                                        {zoom > 1 && (
                                            <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded text-gray-900 dark:text-white transition-colors" title="Reset Zoom">
                                                <Icons.Reset />
                                            </button>
                                        )}
                                    </div>

                                    {status === 'live' && isHlsCamera && (
                                        <button onClick={takeSnapshot} className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors" title="Ambil Screenshot">
                                            <Icons.Image />
                                        </button>
                                    )}

                                    <button onClick={toggleFS} className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors" title={isFullscreen ? "Keluar Fullscreen" : "Fullscreen"}>
                                        <Icons.Fullscreen />
                                    </button>
                                </>
                            )}

                            {canRetry && (
                                <button onClick={handleRetry} className="p-1.5 bg-primary/90 hover:bg-primary text-white rounded-lg transition-colors" title="Coba Lagi">
                                    <Icons.Reset />
                                </button>
                            )}

                            {/* Close Button */}
                            <button onClick={onClose} className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors" title="Tutup">
                                <Icons.X />
                            </button>
                        </div>
                    </div>

                    {/* Codec Description - Simpel dan Jelas */}
                    {camera.video_codec && camera.video_codec === 'h265' && (
                        <div className="px-3 pb-3">
                            <div className="flex items-start gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div className="flex-1 text-xs text-yellow-400">
                                    <strong>Codec H.265:</strong> Terbaik di Safari. Chrome/Edge tergantung hardware device.
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {showPopupBottomNative && (
                    <InlineAdSlot
                        slotKey="popup-bottom-native"
                        label="Sponsored"
                        script={adsConfig.slots.popupBottomNative.script}
                        variant="popup-inline"
                        className="border-t border-gray-200 bg-white/90 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/90"
                        minHeightClassName="min-h-[96px]"
                        maxHeight={popupMaxHeight}
                        onHeightChange={setPopupBottomAdHeight}
                        suppressWhenOversize={false}
                    />
                )}
            </div>
        </div>
    );
}
export default VideoPopup;
