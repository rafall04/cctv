import { useRef, useState, useEffect, useCallback, memo } from 'react';
import Hls from 'hls.js';
import { Icons } from '../ui/Icons';
import CodecBadge from '../CodecBadge';
import ZoomableVideo from './ZoomableVideo';
import { detectDeviceTier } from '../../utils/deviceDetector';
import { shouldDisableAnimations } from '../../utils/animationControl';
import { LoadingStage, getStageMessage, createStreamError } from '../../utils/streamLoaderTypes';
import { createFallbackHandler } from '../../utils/fallbackHandler';
import { getHLSConfig } from '../../utils/hlsConfig';
import { shouldUseQueuedInit, getGlobalStreamInitQueue } from '../../utils/streamInitQueue';
import { viewerService } from '../../services/viewerService';
import { takeSnapshot as takeSnapshotUtil } from '../../utils/snapshotHelper';
import { useBranding } from '../../contexts/BrandingContext';
import { useStreamTimeout } from '../../hooks/useStreamTimeout';

// Now handles offline/maintenance cameras properly
// **Validates: Requirements 1.1, 1.2, 1.3, 2.3, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3**
// ============================================
function MultiViewVideoItem({ camera, onRemove, onError, onStatusChange, initDelay = 0 }) {
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const fallbackHandlerRef = useRef(null);
    const abortControllerRef = useRef(null);

    // Handle close with fullscreen exit
    const handleClose = async () => {
        if (document.fullscreenElement) {
            try {
                await document.exitFullscreen?.();
                // Wait for fullscreen transition to complete
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error('Error exiting fullscreen:', error);
            }
        }
        onRemove();
    };

    // Check camera status first - same as VideoPopup
    const isMaintenance = camera.status === 'maintenance';
    const isOffline = camera.is_online === 0;

    // Set initial status based on camera state
    const getInitialStatus = () => {
        if (isMaintenance) return 'maintenance';
        if (isOffline) return 'offline';
        return 'connecting';
    };

    const [status, setStatus] = useState(getInitialStatus);
    const [loadingStage, setLoadingStage] = useState(LoadingStage.CONNECTING);
    const [zoom, setZoom] = useState(1);
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const [retryKey, setRetryKey] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [autoRetryCount, setAutoRetryCount] = useState(0);
    const [isAutoRetrying, setIsAutoRetrying] = useState(false);

    const url = camera.streams?.hls;
    const deviceTier = detectDeviceTier();

    // Track fullscreen state to disable animations and unlock orientation on exit
    useEffect(() => {
        const handleFullscreenChange = () => {
            const isNowFullscreen = !!document.fullscreenElement;
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
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
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

    // Viewer session tracking - track when user starts/stops watching this camera
    useEffect(() => {
        // Don't track if camera is offline or in maintenance
        if (isMaintenance || isOffline) return;

        let sessionId = null;

        // Start viewer session with delay (staggered init)
        const startTracking = async () => {
            // Wait for init delay before starting session
            if (initDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, initDelay));
            }

            try {
                sessionId = await viewerService.startSession(camera.id);
            } catch (error) {
                console.error('[MultiViewVideoItem] Failed to start viewer session:', error);
            }
        };

        startTracking();

        // Cleanup: stop session when component unmounts
        return () => {
            if (sessionId) {
                viewerService.stopSession(sessionId).catch(err => {
                    console.error('[MultiViewVideoItem] Failed to stop viewer session:', err);
                });
            }
        };
    }, [camera.id, isMaintenance, isOffline, initDelay]);

    // Notify parent of status changes
    useEffect(() => {
        onStatusChange?.(camera.id, status);
    }, [status, camera.id, onStatusChange]);

    // Stream Timeout Hook - **Validates: Requirements 1.1, 1.2, 1.3**
    const {
        startTimeout,
        clearTimeout: clearStreamTimeout,
        updateStage: updateStreamStage,
        resetFailures,
    } = useStreamTimeout({
        deviceTier,
        onTimeout: (stage) => {
            cleanupResources();
            setStatus('timeout');
            setLoadingStage(LoadingStage.TIMEOUT);
            onError?.(camera.id, new Error(`Loading timeout at ${stage} stage`));
        },
        onMaxFailures: () => {
            onError?.(camera.id, new Error('Max consecutive failures reached'));
        },
    });

    // Initialize FallbackHandler for auto-retry - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    useEffect(() => {
        fallbackHandlerRef.current = createFallbackHandler({
            maxAutoRetries: 3,
            onAutoRetry: ({ attempt }) => {
                setIsAutoRetrying(true);
                setAutoRetryCount(attempt);
            },
            onAutoRetryExhausted: ({ totalAttempts }) => {
                setIsAutoRetrying(false);
                setAutoRetryCount(totalAttempts);
            },
            onNetworkRestore: () => {
                // Note: We don't auto-retry on network restore in multi-view
                // User can manually retry if needed
            },
            onManualRetryRequired: () => {
                setIsAutoRetrying(false);
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
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
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
    }, []);

    useEffect(() => {
        // Skip HLS loading if camera is in maintenance or offline
        if (isMaintenance || isOffline) return;

        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        let cancelled = false;
        let initTimeout = null;
        let isLive = false; // Flag to prevent setState after live

        abortControllerRef.current = new AbortController();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);
        let playbackCheckInterval = null;

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
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.reset();
            }
            setAutoRetryCount(0);
        };

        // Fallback: Check video state periodically
        const startPlaybackCheck = () => {
            playbackCheckInterval = setInterval(() => {
                if (cancelled || isLive) {
                    clearInterval(playbackCheckInterval);
                    playbackCheckInterval = null;
                    return;
                }
                if (video.readyState >= 3 && video.buffered.length > 0) {
                    if (!video.paused || video.currentTime > 0) {
                        handlePlaying();
                    } else {
                        video.play().catch(() => { });
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
            // Notify parent of error for isolation tracking
            onError?.(camera.id, new Error('Video playback error'));
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('error', handleError);

        // Core initialization logic
        const performInit = async () => {
            if (cancelled) return;

            // Start loading timeout - **Validates: Requirements 1.1**
            startTimeout(LoadingStage.CONNECTING);

            // HLS.js already imported directly

            if (cancelled) return;

            // Update loading stage - **Validates: Requirements 4.2**
            setLoadingStage(LoadingStage.LOADING);
            if (hlsRef.current) {
                startTimeout(LoadingStage.LOADING);
            }

            if (Hls.isSupported()) {
                const deviceTier = detectDeviceTier();
                const hlsConfig = getHLSConfig(deviceTier, {
                    isMobile: false,
                    mobileDeviceType: null,
                });
                hls = new Hls(hlsConfig);
                hlsRef.current = hls;

                // Load source first, then attach media with small delay
                hls.loadSource(url);
                await new Promise(r => setTimeout(r, 50));
                if (cancelled) return;
                hls.attachMedia(video);

                // Start playback check early - don't wait for events that may not fire
                startPlaybackCheck();

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    setLoadingStage(LoadingStage.BUFFERING);
                if (hlsRef.current) {
                    updateStreamStage(LoadingStage.BUFFERING);
                }
                    video.play().catch(() => { });
                });

                // FRAG_LOADED fires when first fragment is loaded
                hls.on(Hls.Events.FRAG_LOADED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    setLoadingStage(prev => {
                        if (prev === LoadingStage.LOADING || prev === LoadingStage.CONNECTING) {
                            updateStreamStage(LoadingStage.BUFFERING);
                            return LoadingStage.BUFFERING;
                        }
                        return prev;
                    });
                    if (video.paused) {
                        video.play().catch(() => { });
                    }
                });

                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    // Langsung set live setelah buffered
                    handlePlaying(); // Use handlePlaying to set isLive flag
                });

                hls.on(Hls.Events.ERROR, (_, d) => {
                    if (cancelled || isLive) return; // Don't handle errors if already playing

                    // For non-fatal errors, just continue
                    if (!d.fatal) return;

                    // Clear loading timeout
                    clearStreamTimeout();

                    // Check for codec incompatibility - NOT recoverable
                    if (d.details === 'manifestIncompatibleCodecsError') {
                        console.error('Browser tidak support codec H.265/HEVC. Ubah setting kamera ke H.264.');
                        setStatus('error');
                        setLoadingStage(LoadingStage.ERROR);
                        onError?.(camera.id, new Error('Codec tidak didukung browser'));
                        return;
                    }

                    const errorType = d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' :
                        d.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'unknown';

                    // For media errors, try recovery (max 2 times)
                    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
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
                            type: errorType,
                            message: d.details || 'Stream error',
                            stage: loadingStage,
                            deviceTier,
                            retryCount: autoRetryCount,
                        });

                        const result = fallbackHandlerRef.current.handleError(streamError, () => {
                            if (!cancelled && hls) {
                                setLoadingStage(LoadingStage.CONNECTING);
                                if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
                                    hls.startLoad();
                                } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
                                    hls.recoverMediaError();
                                }
                            }
                        });

                        if (result.action === 'manual-retry-required') {
                            setStatus('error');
                            setLoadingStage(LoadingStage.ERROR);
                            onError?.(camera.id, new Error(`HLS fatal error: ${d.type}`));
                        }
                    } else {
                        setStatus('error');
                        setLoadingStage(LoadingStage.ERROR);
                        onError?.(camera.id, new Error(`HLS fatal error: ${d.type}`));
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                video.addEventListener('loadedmetadata', () => video.play().catch(() => { }));
            }
        };

        // Staggered initialization with queue support for low-end devices
        // **Validates: Requirements 5.4**
        const initStream = async () => {
            // Wait for initDelay first (staggered initialization)
            if (initDelay > 0) {
                await new Promise(resolve => {
                    initTimeout = setTimeout(resolve, initDelay);
                });
            }

            if (cancelled) return;

            // On low-end devices, use queue to limit concurrent initializations
            // **Validates: Requirements 5.4**
            if (shouldUseQueuedInit()) {
                const queue = getGlobalStreamInitQueue();
                try {
                    await queue.enqueue(performInit, camera.id);
                } catch (error) {
                    if (!cancelled) {
                        console.warn(`Stream ${camera.id} init cancelled:`, error.message);
                    }
                }
            } else {
                // Medium/High devices: initialize directly
                await performInit();
            }
        };

        initStream();

        // Cleanup function - ensures proper resource release
        return () => {
            cancelled = true;
            clearInterval(playbackCheckInterval);
            if (initTimeout) clearTimeout(initTimeout);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('error', handleError);
            cleanupResources();
            if (hls) {
                hls.destroy();
                hlsRef.current = null;
            }
        };
    }, [url, retryKey, initDelay, camera.id, onError, deviceTier, cleanupResources, isMaintenance, isOffline]);

    const handleRetry = useCallback(() => {
        cleanupResources();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);
        setAutoRetryCount(0);
        setIsAutoRetrying(false);
        resetFailures();
        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.reset();
        }
        setRetryKey(k => k + 1);
    }, [cleanupResources]);

    const toggleFS = async () => {
        try {
            if (!document.fullscreenElement) {
                // Enter fullscreen
                await containerRef.current?.requestFullscreen?.();

                // Reset zoom to 1.0 when entering fullscreen to avoid "auto zoom" effect
                const wrapper = getZoomableWrapper();
                if (wrapper && wrapper._reset) {
                    wrapper._reset();
                }

                // Lock to landscape orientation on mobile
                if (screen.orientation && screen.orientation.lock) {
                    try {
                        await screen.orientation.lock('landscape').catch(() => {
                            screen.orientation.lock('landscape-primary').catch(() => { });
                        });
                    } catch (err) {
                        console.log('Orientation lock not supported');
                    }
                }
            } else {
                // Exit fullscreen
                await document.exitFullscreen?.();

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
        if (!videoRef.current || status !== 'live') return;

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

    // Get status display info for multi-view - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    const getStatusBadge = () => {
        if (status === 'live') return { label: 'LIVE', color: 'bg-emerald-500' };
        if (status === 'maintenance') return { label: 'PERBAIKAN', color: 'bg-red-500' };
        if (status === 'offline') return { label: 'OFFLINE', color: 'bg-gray-500' };
        if (status === 'timeout') return { label: 'TIMEOUT', color: 'bg-amber-500' };
        if (status === 'error') return { label: 'OFF', color: 'bg-red-500' };
        // Connecting - show abbreviated stage
        return { label: '...', color: 'bg-amber-500' };
    };

    const statusBadge = getStatusBadge();

    // Check if animations should be disabled on low-end devices - **Validates: Requirements 5.2**
    const disableAnimations = shouldDisableAnimations();

    return (
        <div ref={containerRef} className={`relative w-full h-full bg-gray-100 dark:bg-black rounded-xl overflow-hidden group ${isFullscreen ? 'rounded-none' : ''}`}>
            <div ref={wrapperRef} className="w-full h-full">
                <ZoomableVideo videoRef={videoRef} status={status} maxZoom={3} onZoomChange={setZoom} isFullscreen={isFullscreen} />
            </div>

            {/* Snapshot Notification */}
            {snapshotNotification && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                    <div className={`px-4 py-2 rounded-lg shadow-xl border ${snapshotNotification.type === 'success'
                        ? 'bg-green-500 border-green-400'
                        : 'bg-red-500 border-red-400'
                        } text-white text-xs font-semibold`}>
                        {snapshotNotification.message}
                    </div>
                </div>
            )}

            {/* Status badge - disable pulse animation in fullscreen and on low-end devices */}
            <div className="absolute top-2 left-2 z-10 pointer-events-none">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold text-white shadow ${statusBadge.color}`}>
                    <span className={`w-1 h-1 rounded-full bg-white ${status === 'live' && !isFullscreen && !disableAnimations ? 'animate-pulse' : ''}`} />
                    {statusBadge.label}
                </span>
                {isAutoRetrying && (
                    <span className="ml-1 text-[8px] text-amber-400">retry {autoRetryCount}/3</span>
                )}
            </div>
            <button onClick={handleClose} className={`absolute top-2 right-2 z-10 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg text-white shadow ${isFullscreen ? 'hidden' : ''}`}><Icons.X /></button>
            {/* Overlay controls - render only on hover, no transition in fullscreen, hide in fullscreen */}
            <div className={`absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 z-10 ${isFullscreen ? 'hidden' : 'transition-opacity'}`}>
                <div className="flex items-center justify-between gap-2">
                    <p className="text-white text-xs font-medium truncate flex-1">{camera.name}</p>
                    <div className="flex items-center gap-1">
                        <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomOut /></button>
                        <span className="text-white/70 text-[10px] w-8 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 3} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomIn /></button>
                        {zoom > 1 && <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Reset /></button>}
                        <div className="w-px h-4 bg-white/20 mx-1" />
                        {status === 'live' && <button onClick={takeSnapshot} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Fullscreen /></button>
                    </div>
                </div>
            </div>

            {/* Floating controls for fullscreen mode - Always visible on mobile */}
            {isFullscreen && (
                <div className="absolute inset-0 z-50 pointer-events-none">
                    {/* Top bar with camera name and exit - Always visible */}
                    <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold text-white shadow ${statusBadge.color}`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                                    {statusBadge.label}
                                </span>
                                <p className="text-white text-sm font-medium">{camera.name}</p>
                            </div>
                            <button onClick={toggleFS} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10"><Icons.Fullscreen /></button>
                        </div>
                    </div>

                    {/* Bottom controls - Always visible on mobile */}
                    <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-gray-200/90 dark:bg-gray-900/80 rounded-xl p-1 pointer-events-auto">
                        <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded text-gray-900 dark:text-white"><Icons.ZoomOut /></button>
                        <span className="text-gray-900 dark:text-white text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 3} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded text-gray-900 dark:text-white"><Icons.ZoomIn /></button>
                        {zoom > 1 && <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 rounded text-gray-900 dark:text-white"><Icons.Reset /></button>}
                        {status === 'live' && (
                            <>
                                <div className="w-px h-4 bg-gray-400 dark:bg-white/20 mx-1" />
                                <button onClick={takeSnapshot} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 rounded text-gray-900 dark:text-white"><Icons.Image /></button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Progressive Loading Overlay - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.2** */}
            {status === 'connecting' && (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 flex flex-col items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center mb-2">
                        <div className={`w-5 h-5 border-2 border-white/30 border-t-primary rounded-full ${disableAnimations ? '' : 'animate-spin'}`} />
                    </div>
                    <p className="text-white text-xs font-medium">{getStageMessage(loadingStage)}</p>
                </div>
            )}

            {/* Timeout Overlay */}
            {status === 'timeout' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-black/90">
                    <div className="text-center p-4">
                        <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-amber-500/20 flex items-center justify-center">
                            <Icons.Clock />
                        </div>
                        <p className="text-white text-xs font-medium mb-1">Timeout</p>
                        <p className="text-gray-400 text-[10px] mb-3">Loading terlalu lama</p>
                        <button
                            onClick={handleRetry}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-600 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                            <Icons.Reset />
                            Coba Lagi
                        </button>
                    </div>
                </div>
            )}

            {/* Error Overlay - dengan deteksi codec H265 */}
            {status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-black/90">
                    <div className="text-center p-4 max-w-xs">
                        <div className={`w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center ${errorType === 'codec' ? 'bg-yellow-500/20' : 'bg-red-500/20'
                            }`}>
                            {errorType === 'codec' ? (
                                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            )}
                        </div>
                        {errorType === 'codec' ? (
                            <>
                                <p className="text-yellow-400 text-xs font-medium mb-1">Codec Tidak Didukung</p>
                                <p className="text-gray-400 text-[10px] mb-2 leading-relaxed">
                                    Browser Anda tidak mendukung codec H.265/HEVC. Gunakan Safari untuk hasil terbaik.
                                </p>
                                <div className="text-[9px] text-gray-500 mb-3">
                                    Atau hubungi admin untuk mengubah codec kamera ke H.264
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-white text-xs font-medium mb-1">Tidak Terkoneksi</p>
                                <p className="text-gray-400 text-[10px] mb-3">Kamera offline atau jaringan bermasalah</p>
                            </>
                        )}
                        <button
                            onClick={handleRetry}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-600 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                            <Icons.Reset />
                            Coba Lagi
                        </button>
                    </div>
                </div>
            )}

            {/* Maintenance Overlay */}
            {status === 'maintenance' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/90">
                    <div className="text-center p-4">
                        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-500/20 flex items-center justify-center">
                            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
                            </svg>
                        </div>
                        <p className="text-red-300 text-sm font-bold mb-1">Dalam Perbaikan</p>
                        <p className="text-gray-400 text-[10px]">Kamera sedang maintenance</p>
                    </div>
                </div>
            )}

            {/* Offline Overlay */}
            {status === 'offline' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-gray-900/95">
                    <div className="text-center p-4">
                        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-700 flex items-center justify-center">
                            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829" />
                            </svg>
                        </div>
                        <p className="text-gray-300 text-sm font-bold mb-1">Kamera Offline</p>
                        <p className="text-gray-500 text-[10px]">Tidak dapat dijangkau</p>
                    </div>
                </div>
            )}
        </div>
    );
}
export default MultiViewVideoItem;