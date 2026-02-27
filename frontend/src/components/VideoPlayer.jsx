import { useEffect, useRef, useState, memo, useCallback } from 'react';
import { getDeviceCapabilities } from '../utils/deviceDetector';
import { createVisibilityObserver } from '../utils/visibilityObserver';
import { createOrientationObserver, getCurrentOrientation } from '../utils/orientationObserver';
import { LoadingStage, getStageMessage } from '../utils/streamLoaderTypes';
import { useHlsPlayer } from '../hooks/useHlsPlayer';

/**
 * Optimized VideoPlayer Component
 * Integrates device-adaptive HLS configuration, error recovery, visibility-based stream control,
 * loading timeout detection, progressive loading stages, and auto-retry functionality.
 */
const VideoPlayer = memo(({ camera, streams, onExpand, isExpanded, enableZoom = false }) => {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const visibilityObserverRef = useRef(null);
    const orientationObserverRef = useRef(null);
    const pauseTimeoutRef = useRef(null);

    // Device capabilities - detected once on mount
    const [deviceTier, setDeviceTier] = useState('medium');
    const [deviceCapabilities, setDeviceCapabilities] = useState(null);

    const {
        hlsRef,
        status,
        setStatus,
        loadingStage,
        setLoadingStage,
        error,
        showSpinner,
        isAutoRetrying,
        autoRetryCount,
        retryDelay,
        consecutiveFailures,
        showTroubleshooting,
        handleRetry,
    } = useHlsPlayer({
        streams,
        videoRef,
        deviceCapabilities,
        deviceTier,
    });

    // Visibility state
    const [isVisible, setIsVisible] = useState(true);
    const [isPausedByVisibility, setIsPausedByVisibility] = useState(false);

    // Fullscreen state
    const [isFullScreen, setIsFullScreen] = useState(false);

    // Orientation state - **Validates: Requirements 7.4**
    const [orientation, setOrientation] = useState(() => getCurrentOrientation());

    // Zoom & Pan State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    // Detect device capabilities on mount
    useEffect(() => {
        const capabilities = getDeviceCapabilities();
        setDeviceCapabilities(capabilities);
        setDeviceTier(capabilities.tier);
    }, []);

    // Setup orientation observer - **Validates: Requirements 7.4**
    // Handles orientation changes without triggering stream reload
    useEffect(() => {
        if (!deviceCapabilities?.isMobile) return;

        orientationObserverRef.current = createOrientationObserver({
            onOrientationChange: ({ orientation: newOrientation }) => {
                // Update orientation state without reloading stream
                setOrientation(newOrientation);

                // Reset zoom/pan on orientation change for better UX
                if (zoom !== 1) {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                }
            },
            debounceResize: true,
            debounceDelay: 150,
        });

        orientationObserverRef.current.start();

        return () => {
            if (orientationObserverRef.current) {
                orientationObserverRef.current.stop();
                orientationObserverRef.current = null;
            }
        };
    }, [deviceCapabilities?.isMobile, zoom]);

    // Setup visibility observer for pause/resume based on visibility
    // **Property 9: Visibility-based Stream Control**
    useEffect(() => {
        if (!containerRef.current) return;

        visibilityObserverRef.current = createVisibilityObserver({
            threshold: 0.1,
            rootMargin: '50px',
        });

        visibilityObserverRef.current.observe(containerRef.current, (visible) => {
            setIsVisible(visible);

            if (visible) {
                // Clear any pending pause timeout
                if (pauseTimeoutRef.current) {
                    clearTimeout(pauseTimeoutRef.current);
                    pauseTimeoutRef.current = null;
                }

                // Resume if was paused by visibility
                if (isPausedByVisibility && videoRef.current && hlsRef.current) {
                    videoRef.current.play().catch(() => { });
                    setIsPausedByVisibility(false);
                    setStatus('playing');
                    setLoadingStage(LoadingStage.PLAYING);
                }
            } else {
                // Schedule pause after 5 seconds when not visible
                // **Validates: Requirements 4.2, 4.3**
                if (status === 'playing' && !pauseTimeoutRef.current) {
                    pauseTimeoutRef.current = setTimeout(() => {
                        if (videoRef.current && !videoRef.current.paused) {
                            videoRef.current.pause();
                            setIsPausedByVisibility(true);
                            setStatus('paused');
                        }
                        pauseTimeoutRef.current = null;
                    }, 5000);
                }
            }
        });

        return () => {
            if (visibilityObserverRef.current) {
                visibilityObserverRef.current.disconnect();
                visibilityObserverRef.current = null;
            }
            if (pauseTimeoutRef.current) {
                clearTimeout(pauseTimeoutRef.current);
                pauseTimeoutRef.current = null;
            }
        };
    }, [status, isPausedByVisibility, hlsRef, setStatus, setLoadingStage]);

    // Fullscreen handling
    useEffect(() => {
        const handleFullScreenChange = () => {
            setIsFullScreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullScreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
    }, []);

    const toggleFullScreen = async (e) => {
        if (e) e.stopPropagation();
        try {
            if (!document.fullscreenElement) {
                if (containerRef.current.requestFullscreen) {
                    await containerRef.current.requestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                }
            }
        } catch (err) {
            console.error('Error toggling full screen:', err);
        }
    };

    // Zoom Logic - optimized with requestAnimationFrame
    const handleWheel = useCallback((e) => {
        if (!enableZoom) return;
        e.preventDefault();
        e.stopPropagation();

        requestAnimationFrame(() => {
            const delta = e.deltaY * -0.001;
            const newZoom = Math.min(Math.max(1, zoom + delta), 5);
            setZoom(newZoom);

            // Reset pan if zoomed out completely
            if (newZoom === 1) {
                setPan({ x: 0, y: 0 });
            }
        });
    }, [enableZoom, zoom]);

    const handleMouseDown = useCallback((e) => {
        if (!enableZoom || zoom <= 1) return;
        setIsDragging(true);
        setDragStart({
            x: e.clientX - pan.x,
            y: e.clientY - pan.y
        });
    }, [enableZoom, zoom, pan]);

    const handleMouseMove = useCallback((e) => {
        if (!isDragging || !enableZoom || zoom <= 1) return;
        e.preventDefault();

        requestAnimationFrame(() => {
            const newX = e.clientX - dragStart.x;
            const newY = e.clientY - dragStart.y;

            // Calculate boundaries to keep video in view
            const bounds = 100 * (zoom - 1);
            const limitedX = Math.min(Math.max(newX, -bounds * 2), bounds * 2);
            const limitedY = Math.min(Math.max(newY, -bounds * 2), bounds * 2);

            setPan({ x: limitedX, y: limitedY });
        });
    }, [isDragging, enableZoom, zoom, dragStart]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Touch Handlers for Mobile - **Validates: Requirements 7.5**
    // Optimized with passive event listeners where appropriate
    const handleTouchStart = useCallback((e) => {
        if (!enableZoom || zoom <= 1) return;
        setIsDragging(true);
        const touch = e.touches[0];
        setDragStart({
            x: touch.clientX - pan.x,
            y: touch.clientY - pan.y
        });
    }, [enableZoom, zoom, pan]);

    const handleTouchMove = useCallback((e) => {
        if (!isDragging || !enableZoom || zoom <= 1) return;
        // Prevent scrolling while panning - only when zoomed in
        if (e.cancelable && zoom > 1) {
            e.preventDefault();
        }

        requestAnimationFrame(() => {
            const touch = e.touches[0];
            const newX = touch.clientX - dragStart.x;
            const newY = touch.clientY - dragStart.y;

            const bounds = 100 * (zoom - 1);
            const limitedX = Math.min(Math.max(newX, -bounds * 2), bounds * 2);
            const limitedY = Math.min(Math.max(newY, -bounds * 2), bounds * 2);

            setPan({ x: limitedX, y: limitedY });
        });
    }, [isDragging, enableZoom, zoom, dragStart]);

    const handleTouchEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Attach touch event listeners with passive option for better scroll performance
    // **Validates: Requirements 7.5**
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !deviceCapabilities?.isMobile) return;

        // Use passive: true for touchstart and touchend to improve scroll performance
        // touchmove needs passive: false when we need to prevent default (when zoomed)
        const touchStartOptions = { passive: true };
        const touchMoveOptions = { passive: zoom <= 1 }; // passive when not zoomed
        const touchEndOptions = { passive: true };

        container.addEventListener('touchstart', handleTouchStart, touchStartOptions);
        container.addEventListener('touchmove', handleTouchMove, touchMoveOptions);
        container.addEventListener('touchend', handleTouchEnd, touchEndOptions);

        return () => {
            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            container.removeEventListener('touchend', handleTouchEnd);
        };
    }, [deviceCapabilities?.isMobile, zoom, handleTouchStart, handleTouchMove, handleTouchEnd]);

    // Zoom button handlers
    const handleZoomIn = useCallback((e) => {
        e.stopPropagation();
        setZoom(prev => Math.min(5, prev + 0.5));
    }, []);

    const handleZoomOut = useCallback((e) => {
        e.stopPropagation();
        const newZoom = Math.max(1, zoom - 0.5);
        setZoom(newZoom);
        if (newZoom === 1) setPan({ x: 0, y: 0 });
    }, [zoom]);

    const handleZoomReset = useCallback((e) => {
        e.stopPropagation();
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    // Get loading stage message for progressive feedback
    // **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
    const loadingMessage = getStageMessage(loadingStage);

    // Determine if animations should be disabled on low-end devices
    // **Validates: Requirements 5.2**
    const disableAnimations = deviceTier === 'low';

    return (
        <div
            ref={containerRef}
            className="video-container group relative w-full h-full bg-black overflow-hidden rounded-xl select-none"
            style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
        >
            <video
                ref={videoRef}
                onMouseDown={handleMouseDown}
                crossOrigin="anonymous"
                className={`w-full h-full transition-transform duration-100 ease-out ${isExpanded || isFullScreen ? '!object-contain' : 'object-cover'
                    }`}
                ref={videoRef}
                onMouseDown={handleMouseDown}
                className={`w-full h-full transition-transform duration-100 ease-out ${isExpanded || isFullScreen ? '!object-contain' : 'object-cover'
                    }`}
                style={{
                    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                    cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'inherit',
                    objectFit: isExpanded || isFullScreen ? 'contain' : 'cover'
                }}
                muted
                playsInline
                controls={false}
            />

            {/* Overlay - Simplified for performance */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200">

                {/* Camera info */}
                <div className="absolute top-4 left-4 right-16">
                    <h3 className="text-base lg:text-lg font-bold text-white drop-shadow-md truncate font-display tracking-wide">
                        {camera.name}
                    </h3>
                    {camera.location && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <svg className="w-3 h-3 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <p className="text-xs text-dark-200 drop-shadow-md truncate font-medium">
                                {camera.location}
                            </p>
                        </div>
                    )}
                </div>

                {/* Status indicator */}
                <div className="absolute top-4 right-4">
                    <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border shadow-lg ${status === 'playing'
                        ? 'bg-green-500/20 border-green-500/30 text-green-400'
                        : status === 'loading'
                            ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                            : status === 'paused'
                                ? 'bg-blue-500/20 border-blue-500/30 text-blue-400'
                                : status === 'timeout'
                                    ? 'bg-orange-500/20 border-orange-500/30 text-orange-400'
                                    : 'bg-red-500/20 border-red-500/30 text-red-400'
                        }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${status === 'playing' ? `bg-green-500 ${!disableAnimations ? 'animate-pulse' : ''}` :
                            status === 'loading' ? `bg-yellow-500 ${!disableAnimations ? 'animate-bounce' : ''}` :
                                status === 'paused' ? 'bg-blue-500' :
                                    status === 'timeout' ? 'bg-orange-500' : 'bg-red-500'
                            }`} />
                        <span className="text-[10px] font-bold tracking-wider uppercase">
                            {status === 'playing' ? 'LIVE' :
                                status === 'loading' ? 'CONNECTING' :
                                    status === 'paused' ? 'PAUSED' :
                                        status === 'timeout' ? 'TIMEOUT' : 'OFFLINE'}
                        </span>
                    </div>
                </div>

                {/* Controls - Bottom Bar */}
                <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-end items-center gap-2 bg-gradient-to-t from-black/80 to-transparent">

                    {/* Zoom Controls */}
                    {enableZoom && isExpanded && (
                        <div className="flex items-center gap-2 mr-4 bg-black/40 backdrop-blur-md rounded-lg p-1 border border-white/10">
                            <button
                                onClick={handleZoomOut}
                                className="p-1.5 rounded-md hover:bg-white/20 text-white transition-colors"
                                title="Zoom Out"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                            </button>
                            <span className="text-xs font-mono text-white/80 w-8 text-center">{Math.round(zoom * 100)}%</span>
                            <button
                                onClick={handleZoomIn}
                                className="p-1.5 rounded-md hover:bg-white/20 text-white transition-colors"
                                title="Zoom In"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>
                            <div className="w-px h-4 bg-white/20 mx-1"></div>
                            <button
                                onClick={handleZoomReset}
                                className="p-1.5 rounded-md hover:bg-white/20 text-white transition-colors"
                                title="Reset Zoom"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
                        </div>
                    )}

                    <button
                        onClick={(!isExpanded && onExpand) ? onExpand : toggleFullScreen}
                        className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all duration-200 border border-white/10 shadow-lg"
                        title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
                    >
                        {isFullScreen ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Loading state with progressive feedback - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5** */}
            {status === 'loading' && showSpinner && (
                <div className="absolute inset-0 flex items-center justify-center bg-dark-950/60 z-10">
                    <div className="text-center">
                        <div className="relative w-10 h-10 mb-3 mx-auto">
                            <div className="absolute inset-0 border-2 border-white/10 rounded-full"></div>
                            {/* Disable animation on low-end devices - **Validates: Requirements 5.2** */}
                            <div className={`absolute inset-0 border-2 border-t-primary-500 rounded-full ${!disableAnimations ? 'animate-spin' : ''}`}></div>
                        </div>
                        <p className="text-dark-300 font-bold text-[10px] uppercase tracking-widest">{loadingMessage}</p>
                        {isAutoRetrying && (
                            <p className="text-yellow-400 text-[9px] mt-1">
                                Retry {autoRetryCount}/3 in {Math.ceil(retryDelay / 1000)}s
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Buffering indicator - Only show after 2s */}
            {status === 'playing' && showSpinner && (
                <div className="absolute inset-0 flex items-center justify-center bg-dark-950/40 z-10">
                    <div className="text-center">
                        <div className="relative w-8 h-8 mb-2 mx-auto">
                            <div className="absolute inset-0 border-2 border-white/10 rounded-full"></div>
                            <div className={`absolute inset-0 border-2 border-t-primary-500 rounded-full ${!disableAnimations ? 'animate-spin' : ''}`}></div>
                        </div>
                        <p className="text-dark-300 font-bold text-[10px] uppercase tracking-widest">Buffering...</p>
                    </div>
                </div>
            )}

            {/* Paused by visibility indicator */}
            {status === 'paused' && isPausedByVisibility && (
                <div className="absolute inset-0 flex items-center justify-center bg-dark-950/60 z-10">
                    <div className="text-center">
                        <div className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-3 ring-1 ring-blue-500/20">
                            <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <p className="text-blue-400 font-bold text-xs">Stream Paused</p>
                        <p className="text-dark-400 text-[10px] mt-1">Scroll back to resume</p>
                    </div>
                </div>
            )}

            {/* Timeout state - **Validates: Requirements 1.2, 1.4** */}
            {status === 'timeout' && (
                <div className="absolute inset-0 flex items-center justify-center bg-dark-950/90 backdrop-blur-sm z-10">
                    <div className="text-center px-6 py-8 w-full max-w-[280px]">
                        <div className="w-12 h-12 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto mb-4 ring-1 ring-orange-500/20">
                            <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <p className="text-orange-400 font-bold text-sm mb-1">Loading Timeout</p>
                        <p className="text-dark-400 text-xs mb-4 line-clamp-2">{error}</p>

                        {/* Troubleshooting suggestion after 3 failures - **Validates: Requirements 1.4** */}
                        {showTroubleshooting && (
                            <div className="bg-dark-800/50 rounded-lg p-3 mb-4 text-left">
                                <p className="text-dark-300 text-[10px] font-medium mb-2">Troubleshooting:</p>
                                <ul className="text-dark-400 text-[9px] space-y-1">
                                    <li>• Check your network connection</li>
                                    <li>• Verify the camera is online</li>
                                    <li>• Try refreshing the page</li>
                                </ul>
                            </div>
                        )}

                        {/* Diagnostic info - **Validates: Requirements 8.1, 8.2, 8.3** */}
                        <div className="text-dark-500 text-[9px] mb-3">
                            Device: {deviceTier} | Failures: {consecutiveFailures}
                        </div>

                        <button
                            onClick={handleRetry}
                            className="w-full py-2 px-4 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                            Retry Connection
                        </button>
                    </div>
                </div>
            )}

            {/* Error state */}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-dark-950/90 backdrop-blur-sm z-10">
                    <div className="text-center px-6 py-8 w-full max-w-[280px]">
                        <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4 ring-1 ring-red-500/20">
                            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <p className="text-red-400 font-bold text-sm mb-1">
                            {error?.includes('H.265') ? 'Codec Error' : 'Signal Lost'}
                        </p>
                        <p className="text-dark-400 text-xs mb-4">{error}</p>
                        <p className="text-dark-400 text-xs mb-4 line-clamp-2">{error}</p>

                        {/* Auto-retry status */}
                        {isAutoRetrying && (
                            <p className="text-yellow-400 text-[10px] mb-3">
                                Auto-retry {autoRetryCount}/3 in {Math.ceil(retryDelay / 1000)}s...
                            </p>
                        )}

                        {/* Diagnostic info - **Validates: Requirements 8.1, 8.2, 8.3** */}
                        <div className="text-dark-500 text-[9px] mb-3">
                            Stage: {loadingStage} | Device: {deviceTier}
                        </div>

                        {!isAutoRetrying && (
                            <button
                                onClick={handleRetry}
                                className="w-full py-2 px-4 bg-dark-800 hover:bg-dark-700 text-white text-xs font-medium rounded-lg transition-colors border border-white/5"
                            >
                                Reconnect
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
