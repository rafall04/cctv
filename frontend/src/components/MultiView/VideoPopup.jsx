import { useRef, useState, useEffect, useCallback, memo } from 'react';
import Hls from 'hls.js';
import { Icons } from '../ui/Icons.jsx';
import CodecBadge from '../CodecBadge.jsx';
import ZoomableVideo from './ZoomableVideo';
import { detectDeviceTier } from '../../utils/deviceDetector';
import { shouldDisableAnimations } from '../../utils/animationControl';
import { LoadingStage, getStageMessage, createStreamError } from '../../utils/streamLoaderTypes';
import { createFallbackHandler } from '../../utils/fallbackHandler';
import { getHLSConfig } from '../../utils/hlsConfig';
import { useStreamTimeout } from '../../hooks/useStreamTimeout';
import { viewerService } from '../../services/viewerService';
import { takeSnapshot as takeSnapshotUtil } from '../../utils/snapshotHelper';
import { useBranding } from '../../contexts/BrandingContext';

// ============================================
// VIDEO POPUP - Optimized with fullscreen detection, timeout handler, progressive stages, and auto-retry
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.3, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3**
// ============================================
function VideoPopup({ camera, onClose }) {
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const modalRef = useRef(null);
    const outerWrapperRef = useRef(null); // Add ref for outer wrapper
    const hlsRef = useRef(null);
    const fallbackHandlerRef = useRef(null);
    const abortControllerRef = useRef(null);
    const { branding } = useBranding(); // ← FIX: Add branding context

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
        onClose();
    };

    // Check camera status first
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
    const [errorType, setErrorType] = useState(null); // 'codec', 'network', 'timeout', 'media', 'unknown'
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [retryKey, setRetryKey] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [autoRetryCount, setAutoRetryCount] = useState(0);
    const [isAutoRetrying, setIsAutoRetrying] = useState(false);
    const [consecutiveFailures, setConsecutiveFailures] = useState(0);
    const [showTroubleshooting, setShowTroubleshooting] = useState(false);

    const url = camera.streams?.hls;
    const deviceTier = detectDeviceTier();

    // Error messages berdasarkan tipe - sama seperti MapView
    const getErrorInfo = () => {
        switch (errorType) {
            case 'codec':
                return {
                    title: 'Codec Tidak Didukung',
                    desc: 'Browser Anda tidak mendukung codec H.265/HEVC yang digunakan kamera ini. Coba gunakan browser lain seperti Safari.',
                    color: 'yellow',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                    )
                };
            case 'network':
                return {
                    title: 'Koneksi Gagal',
                    desc: 'Tidak dapat terhubung ke server stream. Periksa koneksi internet Anda atau coba lagi nanti.',
                    color: 'orange',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                        </svg>
                    )
                };
            case 'timeout':
                return {
                    title: 'Waktu Habis',
                    desc: 'Stream terlalu lama merespons. Kamera mungkin sedang offline atau jaringan lambat.',
                    color: 'gray',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    )
                };
            case 'media':
                return {
                    title: 'Error Media',
                    desc: 'Terjadi kesalahan saat memutar video. Format stream mungkin tidak kompatibel dengan browser.',
                    color: 'purple',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    )
                };
            default:
                return {
                    title: 'CCTV Tidak Terkoneksi',
                    desc: 'Kamera sedang offline atau terjadi kesalahan. Coba lagi nanti.',
                    color: 'red',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    )
                };
        }
    };

    const errorColorClasses = {
        yellow: 'bg-yellow-500/20 text-yellow-400',
        orange: 'bg-orange-500/20 text-orange-400',
        gray: 'bg-gray-500/20 text-gray-400',
        purple: 'bg-purple-500/20 text-purple-400',
        red: 'bg-red-500/20 text-red-400',
    };

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

    // Viewer session tracking - track when user starts/stops watching
    useEffect(() => {
        // Don't track if camera is offline or in maintenance
        if (isMaintenance || isOffline) return;

        let sessionId = null;

        // Start viewer session
        const startTracking = async () => {
            try {
                sessionId = await viewerService.startSession(camera.id);
            } catch (error) {
                console.error('[VideoPopup] Failed to start viewer session:', error);
            }
        };

        startTracking();

        // Cleanup: stop session when popup closes
        return () => {
            if (sessionId) {
                viewerService.stopSession(sessionId).catch(err => {
                    console.error('[VideoPopup] Failed to stop viewer session:', err);
                });
            }
        };
    }, [camera.id, isMaintenance, isOffline]);

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
        onTimeout: (stage) => {
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
            onAutoRetry: ({ attempt, maxAttempts, delay }) => {
                setIsAutoRetrying(true);
                setAutoRetryCount(attempt);
            },
            onAutoRetryExhausted: ({ totalAttempts }) => {
                setIsAutoRetrying(false);
                setAutoRetryCount(totalAttempts);
            },
            onNetworkRestore: () => {
                // Note: We don't auto-retry on network restore in popup
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
        let playbackCheckInterval = null;
        let isLive = false; // Flag to prevent setState after live

        abortControllerRef.current = new AbortController();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);

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
            resetFailures();
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.reset();
            }
            setAutoRetryCount(0);
            setConsecutiveFailures(0);
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
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('error', handleError);

        // Direct HLS.js usage - no lazy loading needed
        if (cancelled) return;

        // Update loading stage - **Validates: Requirements 4.2**
        setLoadingStage(LoadingStage.LOADING);
        updateStreamStage(LoadingStage.LOADING);

        if (Hls.isSupported()) {
            const deviceTier = detectDeviceTier();
            const hlsConfig = getHLSConfig(deviceTier, {
                isMobile: false,
                mobileDeviceType: null,
            });
            hls = new Hls(hlsConfig);
            hlsRef.current = hls;

            // Load source first, then attach media with small delay
            // This helps prevent media errors on some browsers
            hls.loadSource(url);
            setTimeout(() => {
                if (!cancelled && hlsRef.current) {
                    hls.attachMedia(video);
                    startPlaybackCheck();
                }
            }, 50);

            // Start playback check early - don't wait for events that may not fire
            startPlaybackCheck();

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (cancelled || isLive) return; // Skip if already live
                // Update to buffering stage
                setLoadingStage(LoadingStage.BUFFERING);
                updateStreamStage(LoadingStage.BUFFERING);
                video.play().catch(() => { });
            });

            // FRAG_LOADED fires when first fragment is loaded - more reliable than MANIFEST_PARSED
            hls.on(Hls.Events.FRAG_LOADED, () => {
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
                    video.play().catch(() => { });
                }
            });

            hls.on(Hls.Events.FRAG_BUFFERED, () => {
                if (cancelled || isLive) return; // Skip if already live
                // Langsung set PLAYING dan status live setelah buffered
                handlePlaying(); // Use handlePlaying to set isLive flag
            });

            hls.on(Hls.Events.ERROR, (_, d) => {
                if (cancelled || isLive) return; // Don't handle errors if already playing

                // For non-fatal errors, just continue
                if (!d.fatal) return;

                // Clear loading timeout
                clearStreamTimeout();

                // Check for codec incompatibility - NOT recoverable
                if (d.details === 'manifestIncompatibleCodecsError' ||
                    d.details === 'fragParsingError' ||
                    d.details === 'bufferAppendError' ||
                    d.reason?.includes('codec') ||
                    d.reason?.includes('HEVC') ||
                    d.reason?.includes('h265')) {
                    console.error('Browser tidak support codec H.265/HEVC. Ubah setting kamera ke H.264.');
                    setStatus('error');
                    setErrorType('codec');
                    setLoadingStage(LoadingStage.ERROR);
                    return;
                }

                const detectedErrorType = d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' :
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
                        type: detectedErrorType,
                        message: d.details || 'Stream error',
                        stage: loadingStage,
                        deviceTier,
                        retryCount: autoRetryCount,
                    });

                    const result = fallbackHandlerRef.current.handleError(streamError, () => {
                        if (!cancelled && hls) {
                            setLoadingStage(LoadingStage.CONNECTING);
                            hls.destroy();
                            const newHlsConfig = getHLSConfig(deviceTier, {
                                isMobile: false,
                                mobileDeviceType: null,
                            });
                            const newHls = new Hls(newHlsConfig);
                            hlsRef.current = newHls;
                            newHls.loadSource(url);
                            newHls.attachMedia(video);

                            newHls.on(Hls.Events.MANIFEST_PARSED, () => {
                                if (cancelled) return;
                                setLoadingStage(LoadingStage.BUFFERING);
                                video.play().catch(() => { });
                            });

                            newHls.on(Hls.Events.ERROR, (_, d2) => {
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
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => video.play().catch(() => { }));
        }

        return () => {
            cancelled = true;
            clearInterval(playbackCheckInterval);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('error', handleError);
            cleanupResources();
            if (hls) { hls.destroy(); hlsRef.current = null; }
        };
    }, [url, retryKey, deviceTier, cleanupResources]);

    const handleRetry = useCallback(() => {
        cleanupResources();
        setStatus('connecting');
        setErrorType(null);
        setLoadingStage(LoadingStage.CONNECTING);
        setAutoRetryCount(0);
        setIsAutoRetrying(false);
        setShowTroubleshooting(false);
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
                await outerWrapperRef.current?.requestFullscreen?.();

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

    // Get status display info - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    const getStatusDisplay = () => {
        if (status === 'live') return { label: 'LIVE', color: 'bg-emerald-500/20 text-emerald-400', dotColor: 'bg-emerald-400' };
        if (status === 'maintenance') return { label: 'PERBAIKAN', color: 'bg-red-500/20 text-red-400', dotColor: 'bg-red-400' };
        if (status === 'offline') return { label: 'OFFLINE', color: 'bg-gray-500/20 text-gray-400', dotColor: 'bg-gray-400' };
        if (status === 'timeout') return { label: 'TIMEOUT', color: 'bg-amber-500/20 text-amber-400', dotColor: 'bg-amber-400' };
        if (status === 'error') return { label: 'ERROR', color: 'bg-red-500/20 text-red-400', dotColor: 'bg-red-400' };
        // Connecting states with progressive messages
        return { label: getStageMessage(loadingStage), color: 'bg-amber-500/20 text-amber-400', dotColor: 'bg-amber-400' };
    };

    const statusDisplay = getStatusDisplay();

    // Check if animations should be disabled on low-end devices - **Validates: Requirements 5.2**
    const disableAnimations = shouldDisableAnimations();

    return (
        <div ref={outerWrapperRef} className={`fixed inset-0 z-[9999] ${isFullscreen ? 'bg-black dark:bg-black' : 'flex items-center justify-center bg-black/95 dark:bg-black/95 p-2 sm:p-4'}`} onClick={onClose}>
            <div ref={modalRef} className={`relative bg-white dark:bg-gray-900 overflow-hidden shadow-2xl flex flex-col ${isFullscreen ? 'w-full h-full' : 'w-full max-w-5xl rounded-2xl border border-gray-200 dark:border-gray-800'}`} style={isFullscreen ? {} : { maxHeight: 'calc(100vh - 16px)' }} onClick={(e) => e.stopPropagation()}>

                {/* Header Info - di atas video (hide in fullscreen) */}
                {!isFullscreen && (
                    <div className="p-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <h3 className="text-gray-900 dark:text-white font-bold text-sm sm:text-base truncate">{camera.name}</h3>
                                {camera.video_codec && (
                                    <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                                )}
                            </div>
                            {/* Status badges */}
                            <div className="flex items-center gap-1 shrink-0">
                                {isMaintenance ? (
                                    <span className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold">Perbaikan</span>
                                ) : isOffline ? (
                                    <span className="px-1.5 py-0.5 rounded bg-gray-500 text-white text-[10px] font-bold">Offline</span>
                                ) : (
                                    <>
                                        <span className={`w-1.5 h-1.5 rounded-full bg-red-500 ${disableAnimations ? '' : 'animate-pulse'}`} />
                                        <span className={`px-1.5 py-0.5 rounded text-white text-[10px] font-bold ${camera.is_tunnel ? 'bg-orange-500' : 'bg-emerald-500'}`}>
                                            {camera.is_tunnel ? 'Tunnel' : 'Stabil'}
                                        </span>
                                    </>
                                )}
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
                    </div>
                )}

                {/* Video - expand to full screen in fullscreen mode */}
                <div ref={wrapperRef} className={`relative bg-gray-100 dark:bg-black overflow-hidden ${isFullscreen ? 'flex-1' : 'flex-1 min-h-0'}`} onDoubleClick={toggleFS}>
                    <ZoomableVideo videoRef={videoRef} maxZoom={4} onZoomChange={setZoom} isFullscreen={isFullscreen} />

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
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {status === 'live' && <button onClick={takeSnapshot} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10"><Icons.Image /></button>}
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

                            <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1 bg-gray-200/90 dark:bg-gray-900/80 rounded-xl p-1 pointer-events-auto">
                                <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded-lg text-gray-900 dark:text-white"><Icons.ZoomOut /></button>
                                <span className="text-gray-900 dark:text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                                <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 4} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded-lg text-gray-900 dark:text-white"><Icons.ZoomIn /></button>
                                {zoom > 1 && <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 rounded-lg text-gray-900 dark:text-white ml-1"><Icons.Reset /></button>}
                            </div>
                        </>
                    )}

                    {/* Maintenance Overlay */}
                    {status === 'maintenance' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/80">
                            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
                                </svg>
                            </div>
                            <h3 className="text-red-300 font-bold text-xl mb-2">Dalam Perbaikan</h3>
                            <p className="text-gray-400 text-sm text-center max-w-md px-4">Kamera ini sedang dalam masa perbaikan/maintenance</p>
                        </div>
                    )}

                    {/* Offline Overlay */}
                    {status === 'offline' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-gray-900/90">
                            <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                                </svg>
                            </div>
                            <h3 className="text-gray-300 font-bold text-xl mb-2">Kamera Offline</h3>
                            <p className="text-gray-500 text-sm text-center max-w-md px-4">Kamera ini sedang tidak tersedia atau tidak dapat dijangkau</p>
                        </div>
                    )}

                    {/* Progressive Loading Overlay - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 5.2** */}
                    {status === 'connecting' && (
                        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 flex flex-col items-center justify-center">
                            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
                                <div className={`w-8 h-8 border-2 border-white/30 border-t-primary rounded-full ${disableAnimations ? '' : 'animate-spin'}`} />
                            </div>
                            <p className="text-white font-medium mb-1">{getStageMessage(loadingStage)}</p>
                            <p className="text-gray-400 text-sm">Please wait...</p>
                        </div>
                    )}

                    {/* Timeout Error Overlay - **Validates: Requirements 1.2, 1.4** */}
                    {status === 'timeout' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-black/90">
                            <div className="text-center p-6">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                                    <Icons.Clock />
                                </div>
                                <h3 className="text-white font-semibold text-lg mb-2">Loading Timeout</h3>
                                <p className="text-gray-400 text-sm mb-2">Stream took too long to load</p>
                                {consecutiveFailures >= 3 && showTroubleshooting && (
                                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-left max-w-sm mx-auto">
                                        <p className="text-amber-400 text-xs font-medium mb-1">Troubleshooting Tips:</p>
                                        <ul className="text-gray-400 text-xs list-disc list-inside space-y-1">
                                            <li>Check your internet connection</li>
                                            <li>Camera may be offline</li>
                                            <li>Try refreshing the page</li>
                                        </ul>
                                    </div>
                                )}
                                <button
                                    onClick={handleRetry}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-600 text-white rounded-lg font-medium transition-colors"
                                >
                                    <Icons.Reset />
                                    Coba Lagi
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Error Overlay */}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-black/90">
                            <div className="text-center p-6">
                                {(() => {
                                    const info = getErrorInfo();
                                    const colorClass = errorColorClasses[info.color] || errorColorClasses.red;
                                    return (
                                        <>
                                            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${colorClass} flex items-center justify-center`}>
                                                {info.icon}
                                            </div>
                                            <h3 className="text-white font-semibold text-lg mb-2">{info.title}</h3>
                                            <p className="text-gray-400 text-sm mb-4 max-w-md">{info.desc}</p>
                                        </>
                                    );
                                })()}
                                <button
                                    onClick={handleRetry}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-600 text-white rounded-lg font-medium transition-colors"
                                >
                                    <Icons.Reset />
                                    Coba Lagi
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Controls Panel + Codec Description - hide in fullscreen */}
                <div className={`shrink-0 border-t border-gray-200 dark:border-gray-800 ${isFullscreen ? 'hidden' : ''}`}>
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

                        {/* Zoom Controls */}
                        <div className="flex items-center gap-1 shrink-0">
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

                            {/* Screenshot Button */}
                            {status === 'live' && (
                                <button onClick={takeSnapshot} className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors" title="Ambil Screenshot">
                                    <Icons.Image />
                                </button>
                            )}

                            {/* Fullscreen Button */}
                            <button onClick={toggleFS} className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors" title={isFullscreen ? "Keluar Fullscreen" : "Fullscreen"}>
                                <Icons.Fullscreen />
                            </button>

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
            </div>
        </div>
    );
}
export default VideoPopup;