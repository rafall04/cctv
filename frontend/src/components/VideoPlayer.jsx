import { useEffect, useRef, useState, memo } from 'react';
import Hls from 'hls.js';

const VideoPlayer = memo(({ camera, streams, onExpand, isExpanded, enableZoom = false }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('loading'); // loading, playing, error
    const [error, setError] = useState(null);
    const [retryCount, setRetryCount] = useState(0);
    const maxRetries = 3;

    // Zoom & Pan State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (!streams || !videoRef.current) return;

        const video = videoRef.current;
        let hls = null;

        const initPlayer = () => {
            setStatus('loading');
            setError(null);

            // Try HLS first
            if (Hls.isSupported() && streams.hls) {
                hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 90,
                });

                hlsRef.current = hls;

                hls.loadSource(streams.hls);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().then(() => {
                        setStatus('playing');
                        setRetryCount(0);
                    }).catch((err) => {
                        console.error('Play error:', err);
                        setStatus('error');
                        setError('Failed to play video');
                    });
                });

                hls.on(Hls.Events.ERROR, (event, data) => {
                    console.error('HLS error:', data);

                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                setError('Network error - retrying...');
                                if (retryCount < maxRetries) {
                                    setTimeout(() => {
                                        hls.startLoad();
                                        setRetryCount(prev => prev + 1);
                                    }, 2000);
                                } else {
                                    setStatus('error');
                                    setError('Network error - max retries reached');
                                }
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                setError('Media error - recovering...');
                                hls.recoverMediaError();
                                break;
                            default:
                                setStatus('error');
                                setError('Fatal error occurred');
                                hls.destroy();
                                break;
                        }
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl') && streams.hls) {
                // Native HLS support (Safari)
                video.src = streams.hls;
                video.addEventListener('loadedmetadata', () => {
                    video.play().then(() => {
                        setStatus('playing');
                    }).catch((err) => {
                        console.error('Play error:', err);
                        setStatus('error');
                        setError('Failed to play video');
                    });
                });

                video.addEventListener('error', () => {
                    setStatus('error');
                    setError('Video playback error');
                });
            } else {
                setStatus('error');
                setError('HLS not supported in this browser');
            }
        };

        initPlayer();

        // Cleanup
        return () => {
            if (hls) {
                hls.destroy();
                hlsRef.current = null;
            }
            if (video) {
                video.pause();
                video.src = '';
            }
        };
    }, [streams, retryCount]);

    const containerRef = useRef(null);
    const [isFullScreen, setIsFullScreen] = useState(false);

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

    // Zoom Logic
    const handleWheel = (e) => {
        if (!enableZoom) return;
        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY * -0.001;
        const newZoom = Math.min(Math.max(1, zoom + delta), 5);
        setZoom(newZoom);

        // Reset pan if zoomed out completely
        if (newZoom === 1) {
            setPan({ x: 0, y: 0 });
        }
    };

    const handleMouseDown = (e) => {
        if (!enableZoom || zoom <= 1) return;
        setIsDragging(true);
        setDragStart({
            x: e.clientX - pan.x,
            y: e.clientY - pan.y
        });
    };

    const handleMouseMove = (e) => {
        if (!isDragging || !enableZoom || zoom <= 1) return;
        e.preventDefault();

        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;

        // Calculate boundaries to keep video in view
        const bounds = 100 * (zoom - 1);
        const limitedX = Math.min(Math.max(newX, -bounds * 2), bounds * 2);
        const limitedY = Math.min(Math.max(newY, -bounds * 2), bounds * 2);

        setPan({ x: limitedX, y: limitedY });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Touch Handlers for Mobile
    const handleTouchStart = (e) => {
        if (!enableZoom || zoom <= 1) return;
        setIsDragging(true);
        const touch = e.touches[0];
        setDragStart({
            x: touch.clientX - pan.x,
            y: touch.clientY - pan.y
        });
    };

    const handleTouchMove = (e) => {
        if (!isDragging || !enableZoom || zoom <= 1) return;
        // Prevent scrolling while panning
        if (e.cancelable) e.preventDefault();

        const touch = e.touches[0];
        const newX = touch.clientX - dragStart.x;
        const newY = touch.clientY - dragStart.y;

        const bounds = 100 * (zoom - 1);
        const limitedX = Math.min(Math.max(newX, -bounds * 2), bounds * 2);
        const limitedY = Math.min(Math.max(newY, -bounds * 2), bounds * 2);

        setPan({ x: limitedX, y: limitedY });
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
    };

    return (
        <div
            ref={containerRef}
            className="video-container group relative w-full h-full bg-black overflow-hidden rounded-xl select-none"
            style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <video
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
                            : 'bg-red-500/20 border-red-500/30 text-red-400'
                        }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${status === 'playing' ? 'bg-green-500 animate-pulse' :
                            status === 'loading' ? 'bg-yellow-500 animate-bounce' : 'bg-red-500'
                            }`} />
                        <span className="text-[10px] font-bold tracking-wider uppercase">
                            {status === 'playing' ? 'LIVE' : status === 'loading' ? 'CONNECTING' : 'OFFLINE'}
                        </span>
                    </div>
                </div>

                {/* Controls - Bottom Bar */}
                <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-end items-center gap-2 bg-gradient-to-t from-black/80 to-transparent">

                    {/* Zoom Controls */}
                    {enableZoom && isExpanded && (
                        <div className="flex items-center gap-2 mr-4 bg-black/40 backdrop-blur-md rounded-lg p-1 border border-white/10">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const newZoom = Math.max(1, zoom - 0.5);
                                    setZoom(newZoom);
                                    if (newZoom === 1) setPan({ x: 0, y: 0 });
                                }}
                                className="p-1.5 rounded-md hover:bg-white/20 text-white transition-colors"
                                title="Zoom Out"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                            </button>
                            <span className="text-xs font-mono text-white/80 w-8 text-center">{Math.round(zoom * 100)}%</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setZoom(Math.min(5, zoom + 0.5));
                                }}
                                className="p-1.5 rounded-md hover:bg-white/20 text-white transition-colors"
                                title="Zoom In"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>
                            <div className="w-px h-4 bg-white/20 mx-1"></div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setZoom(1);
                                    setPan({ x: 0, y: 0 });
                                }}
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

            {/* Loading state - Simplified */}
            {status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-dark-950/60 z-10">
                    <div className="text-center">
                        <div className="relative w-10 h-10 mb-3 mx-auto">
                            <div className="absolute inset-0 border-2 border-white/10 rounded-full"></div>
                            <div className="absolute inset-0 border-2 border-t-primary-500 rounded-full animate-spin"></div>
                        </div>
                        <p className="text-dark-300 font-bold text-[10px] uppercase tracking-widest">Loading...</p>
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
                        <p className="text-red-400 font-bold text-sm mb-1">Signal Lost</p>
                        <p className="text-dark-400 text-xs mb-4 line-clamp-2">{error}</p>
                        {retryCount < maxRetries && (
                            <button
                                onClick={() => setRetryCount(prev => prev + 1)}
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

export default VideoPlayer;
