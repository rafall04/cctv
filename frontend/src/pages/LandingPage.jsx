import { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// Icons
const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>,
    Camera: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
    Search: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
    Close: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
    Location: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>,
    Expand: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>,
    ZoomIn: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>,
    ZoomOut: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" /></svg>,
    Reset: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
};

// HLS instance cache to prevent reload
const hlsInstances = new Map();


// Video Player with proper zoom/pan that covers entire video
const VideoPlayer = memo(({ camera, streams, isExpanded, enableZoom = false }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const containerRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const mountedRef = useRef(true);

    // Zoom & Pan state
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    const streamUrl = streams?.hls;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Initialize HLS player
    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;

        const video = videoRef.current;
        const cacheKey = `hls-${camera.id}`;

        // Reuse existing HLS instance if available
        if (hlsInstances.has(cacheKey)) {
            const existingHls = hlsInstances.get(cacheKey);
            if (existingHls && !existingHls.destroyed) {
                existingHls.attachMedia(video);
                hlsRef.current = existingHls;
                video.play().catch(() => {});
                setStatus('playing');
                return;
            }
        }

        const initPlayer = () => {
            if (!mountedRef.current) return;
            setStatus('loading');
            setError(null);

            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 90,
                    maxBufferLength: 30,
                });

                hlsRef.current = hls;
                hlsInstances.set(cacheKey, hls);

                hls.loadSource(streamUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (!mountedRef.current) return;
                    video.play().then(() => {
                        if (mountedRef.current) setStatus('playing');
                    }).catch(() => {
                        if (mountedRef.current) setStatus('playing');
                    });
                });

                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (!mountedRef.current) return;
                    if (data.fatal) {
                        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                            setTimeout(() => hls.startLoad(), 2000);
                        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                            hls.recoverMediaError();
                        } else {
                            setStatus('error');
                            setError('Stream unavailable');
                        }
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = streamUrl;
                video.addEventListener('loadedmetadata', () => {
                    if (!mountedRef.current) return;
                    video.play().then(() => setStatus('playing')).catch(() => setStatus('playing'));
                });
                video.addEventListener('error', () => {
                    if (mountedRef.current) {
                        setStatus('error');
                        setError('Playback error');
                    }
                });
            } else {
                setStatus('error');
                setError('Browser not supported');
            }
        };

        initPlayer();

        return () => {
            // Don't destroy HLS on unmount - keep in cache for reuse
        };
    }, [streamUrl, camera.id]);

    // Fullscreen handling with webkit support
    useEffect(() => {
        const handleFSChange = () => {
            const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
            setIsFullScreen(isFS);
        };
        document.addEventListener('fullscreenchange', handleFSChange);
        document.addEventListener('webkitfullscreenchange', handleFSChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFSChange);
            document.removeEventListener('webkitfullscreenchange', handleFSChange);
        };
    }, []);

    const toggleFullScreen = async (e) => {
        e?.stopPropagation();
        try {
            const elem = containerRef.current;
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                if (elem.requestFullscreen) await elem.requestFullscreen();
                else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
            } else {
                if (document.exitFullscreen) await document.exitFullscreen();
                else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
            }
        } catch (err) { /* ignore */ }
    };

    // Calculate max pan based on zoom level - allows panning to edges
    const getMaxPan = useCallback(() => {
        if (!containerRef.current || !videoRef.current) return { x: 0, y: 0 };
        const container = containerRef.current.getBoundingClientRect();
        // Max pan = (zoomed size - container size) / 2
        const maxX = (container.width * (zoom - 1)) / 2;
        const maxY = (container.height * (zoom - 1)) / 2;
        return { x: maxX, y: maxY };
    }, [zoom]);

    // Mouse wheel zoom
    const handleWheel = useCallback((e) => {
        if (!enableZoom || !isExpanded) return;
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? -0.25 : 0.25;
        setZoom(prev => {
            const newZoom = Math.max(1, Math.min(5, prev + delta));
            if (newZoom === 1) setPan({ x: 0, y: 0 });
            return newZoom;
        });
    }, [enableZoom, isExpanded]);

    // Mouse drag for pan
    const handleMouseDown = useCallback((e) => {
        if (!enableZoom || zoom <= 1 || !isExpanded) return;
        e.preventDefault();
        setIsDragging(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }, [enableZoom, zoom, isExpanded, pan]);

    const handleMouseMove = useCallback((e) => {
        if (!isDragging || !enableZoom || zoom <= 1) return;
        e.preventDefault();
        
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const maxPan = getMaxPan();
        
        setPan({
            x: Math.max(-maxPan.x, Math.min(maxPan.x, dragStartRef.current.panX + dx)),
            y: Math.max(-maxPan.y, Math.min(maxPan.y, dragStartRef.current.panY + dy)),
        });
    }, [isDragging, enableZoom, zoom, getMaxPan]);

    const handleMouseUp = useCallback(() => setIsDragging(false), []);

    // Touch handlers for mobile
    const handleTouchStart = useCallback((e) => {
        if (!enableZoom || zoom <= 1 || !isExpanded) return;
        const touch = e.touches[0];
        setIsDragging(true);
        dragStartRef.current = { x: touch.clientX, y: touch.clientY, panX: pan.x, panY: pan.y };
    }, [enableZoom, zoom, isExpanded, pan]);

    const handleTouchMove = useCallback((e) => {
        if (!isDragging || !enableZoom || zoom <= 1) return;
        if (e.cancelable) e.preventDefault();
        
        const touch = e.touches[0];
        const dx = touch.clientX - dragStartRef.current.x;
        const dy = touch.clientY - dragStartRef.current.y;
        const maxPan = getMaxPan();
        
        setPan({
            x: Math.max(-maxPan.x, Math.min(maxPan.x, dragStartRef.current.panX + dx)),
            y: Math.max(-maxPan.y, Math.min(maxPan.y, dragStartRef.current.panY + dy)),
        });
    }, [isDragging, enableZoom, zoom, getMaxPan]);

    const handleTouchEnd = useCallback(() => setIsDragging(false), []);

    // Zoom controls
    const zoomIn = (e) => {
        e?.stopPropagation();
        setZoom(prev => Math.min(5, prev + 0.5));
    };
    const zoomOut = (e) => {
        e?.stopPropagation();
        const newZoom = Math.max(1, zoom - 0.5);
        setZoom(newZoom);
        if (newZoom === 1) setPan({ x: 0, y: 0 });
    };
    const resetZoom = (e) => {
        e?.stopPropagation();
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    const showZoomControls = enableZoom && isExpanded;

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full bg-black overflow-hidden rounded-xl group select-none"
            style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
            onWheel={handleWheel}
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
                className="w-full h-full"
                style={{
                    objectFit: isExpanded || isFullScreen ? 'contain' : 'cover',
                    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                    transformOrigin: 'center center',
                    cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                }}
                muted
                playsInline
                autoPlay
            />

            {/* Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div className="pointer-events-auto">
                    {/* Camera Info */}
                    <div className="absolute top-3 left-3 right-12">
                        <h3 className="text-sm font-bold text-white truncate">{camera.name}</h3>
                        {camera.location && (
                            <p className="text-xs text-gray-300 truncate flex items-center gap-1 mt-0.5">
                                <Icons.Location /> {camera.location}
                            </p>
                        )}
                    </div>

                    {/* Status */}
                    <div className="absolute top-3 right-3">
                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                            status === 'playing' ? 'bg-green-500/20 text-green-400' :
                            status === 'loading' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                        }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${
                                status === 'playing' ? 'bg-green-500 animate-pulse' :
                                status === 'loading' ? 'bg-yellow-500' : 'bg-red-500'
                            }`} />
                            {status === 'playing' ? 'LIVE' : status === 'loading' ? 'LOADING' : 'OFFLINE'}
                        </div>
                    </div>

                    {/* Bottom Controls */}
                    <div className="absolute bottom-3 left-3 right-3 flex justify-between items-center">
                        {/* Zoom Controls */}
                        {showZoomControls && (
                            <div className="flex items-center gap-1 bg-black/50 backdrop-blur rounded-lg p-1">
                                <button onClick={zoomOut} className="p-1.5 hover:bg-white/20 rounded text-white" title="Zoom Out">
                                    <Icons.ZoomOut />
                                </button>
                                <span className="text-xs text-white/80 w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
                                <button onClick={zoomIn} className="p-1.5 hover:bg-white/20 rounded text-white" title="Zoom In">
                                    <Icons.ZoomIn />
                                </button>
                                <button onClick={resetZoom} className="p-1.5 hover:bg-white/20 rounded text-white ml-1" title="Reset">
                                    <Icons.Reset />
                                </button>
                            </div>
                        )}
                        {!showZoomControls && <div />}

                        {/* Fullscreen Button */}
                        <button
                            onClick={toggleFullScreen}
                            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                            <Icons.Expand />
                        </button>
                    </div>
                </div>
            </div>

            {/* Loading */}
            {status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-primary-500 rounded-full animate-spin" />
                </div>
            )}

            {/* Error */}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <div className="text-center p-4">
                        <p className="text-red-400 text-sm font-medium">{error || 'Stream unavailable'}</p>
                    </div>
                </div>
            )}
        </div>
    );
}, (prev, next) => {
    return prev.camera.id === next.camera.id && 
           prev.streams?.hls === next.streams?.hls &&
           prev.isExpanded === next.isExpanded &&
           prev.enableZoom === next.enableZoom;
});


// Camera Card
const CameraCard = memo(({ camera, streams, onClick }) => {
    return (
        <div 
            className="relative aspect-video rounded-xl overflow-hidden cursor-pointer 
                       bg-dark-800 shadow-lg hover:shadow-xl transition-shadow duration-300
                       ring-1 ring-white/5 hover:ring-primary-500/30"
            onClick={onClick}
        >
            <VideoPlayer camera={camera} streams={streams} isExpanded={false} enableZoom={false} />
        </div>
    );
}, (prev, next) => prev.camera.id === next.camera.id && prev.streams?.hls === next.streams?.hls);

// Expanded View Modal
const ExpandedView = memo(({ camera, streams, onClose }) => {
    useEffect(() => {
        const handleEsc = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', handleEsc);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 bg-black/50">
                <div className="text-white">
                    <h2 className="text-lg font-bold">{camera.name}</h2>
                    {camera.location && (
                        <p className="text-sm text-gray-400 flex items-center gap-1">
                            <Icons.Location /> {camera.location}
                        </p>
                    )}
                </div>
                <button
                    onClick={onClose}
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                    <Icons.Close />
                </button>
            </div>

            {/* Video - fills remaining space */}
            <div className="flex-1 p-4 pt-0">
                <div className="w-full h-full">
                    <VideoPlayer camera={camera} streams={streams} isExpanded={true} enableZoom={true} />
                </div>
            </div>
        </div>
    );
});


// Main Landing Page
function LandingPage() {
    const { theme, toggleTheme } = useTheme();
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCamera, setExpandedCamera] = useState(null);
    const [gridCols, setGridCols] = useState(2);

    // Fetch cameras - using correct method name
    useEffect(() => {
        const fetchCameras = async () => {
            try {
                setLoading(true);
                setError(null);
                const response = await streamService.getAllActiveStreams();
                
                if (response.success && Array.isArray(response.data)) {
                    setCameras(response.data);
                } else {
                    setError('Invalid response from server');
                }
            } catch (err) {
                console.error('Fetch error:', err);
                setError('Failed to load cameras. Please check your connection.');
            } finally {
                setLoading(false);
            }
        };

        fetchCameras();
    }, []);

    // Filter cameras
    const filteredCameras = useMemo(() => {
        if (!searchQuery.trim()) return cameras;
        const query = searchQuery.toLowerCase();
        return cameras.filter(c => 
            c.name?.toLowerCase().includes(query) ||
            c.location?.toLowerCase().includes(query) ||
            c.description?.toLowerCase().includes(query)
        );
    }, [cameras, searchQuery]);

    const handleExpand = useCallback((camera) => setExpandedCamera(camera), []);
    const handleCloseExpand = useCallback(() => setExpandedCamera(null), []);

    const gridClass = useMemo(() => {
        switch (gridCols) {
            case 1: return 'grid-cols-1';
            case 2: return 'grid-cols-1 md:grid-cols-2';
            case 3: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
            default: return 'grid-cols-1 md:grid-cols-2';
        }
    }, [gridCols]);

    // Loading state
    if (loading) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${theme === 'dark' ? 'bg-dark-950' : 'bg-gray-50'}`}>
                <div className="text-center">
                    <div className="w-12 h-12 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className={theme === 'dark' ? 'text-dark-400' : 'text-gray-600'}>Loading cameras...</p>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${theme === 'dark' ? 'bg-dark-950' : 'bg-gray-50'}`}>
                <div className="text-center p-8">
                    <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icons.Close />
                    </div>
                    <p className="text-red-400 text-lg font-medium mb-2">Error</p>
                    <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-dark-400' : 'text-gray-600'}`}>{error}</p>
                    <button 
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen transition-colors duration-300 ${theme === 'dark' ? 'bg-dark-950' : 'bg-gray-50'}`}>
            {/* Header */}
            <header className={`sticky top-0 z-40 backdrop-blur-lg border-b ${
                theme === 'dark' ? 'bg-dark-900/80 border-white/5' : 'bg-white/80 border-gray-200'
            }`}>
                <div className="max-w-7xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                        {/* Logo */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center text-white">
                                <Icons.Camera />
                            </div>
                            <div>
                                <h1 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                    RAF NET CCTV
                                </h1>
                                <p className={`text-xs ${theme === 'dark' ? 'text-dark-400' : 'text-gray-500'}`}>
                                    {cameras.length} camera{cameras.length !== 1 ? 's' : ''} online
                                </p>
                            </div>
                        </div>

                        {/* Search - Desktop */}
                        <div className="flex-1 max-w-md hidden sm:block">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search cameras..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className={`w-full pl-10 pr-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500/50 ${
                                        theme === 'dark' 
                                            ? 'bg-dark-800 text-white placeholder-dark-400 border-white/5' 
                                            : 'bg-gray-100 text-gray-900 placeholder-gray-500 border-gray-200'
                                    }`}
                                />
                                <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-dark-400' : 'text-gray-400'}`}>
                                    <Icons.Search />
                                </div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-2">
                            {/* Grid toggle */}
                            <div className={`hidden sm:flex items-center gap-1 rounded-lg p-1 ${
                                theme === 'dark' ? 'bg-dark-800' : 'bg-gray-100'
                            }`}>
                                {[1, 2, 3].map(cols => (
                                    <button
                                        key={cols}
                                        onClick={() => setGridCols(cols)}
                                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                            gridCols === cols 
                                                ? 'bg-primary-600 text-white' 
                                                : theme === 'dark' ? 'text-dark-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                                        }`}
                                    >
                                        {cols}
                                    </button>
                                ))}
                            </div>

                            {/* Theme toggle */}
                            <button
                                onClick={toggleTheme}
                                className={`p-2 rounded-lg transition-colors ${
                                    theme === 'dark' 
                                        ? 'bg-dark-800 text-dark-400 hover:text-white' 
                                        : 'bg-gray-100 text-gray-500 hover:text-gray-900'
                                }`}
                            >
                                {theme === 'dark' ? <Icons.Sun /> : <Icons.Moon />}
                            </button>
                        </div>
                    </div>

                    {/* Search - Mobile */}
                    <div className="mt-3 sm:hidden">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search cameras..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className={`w-full pl-10 pr-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500/50 ${
                                    theme === 'dark' 
                                        ? 'bg-dark-800 text-white placeholder-dark-400 border-white/5' 
                                        : 'bg-gray-100 text-gray-900 placeholder-gray-500 border-gray-200'
                                }`}
                            />
                            <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-dark-400' : 'text-gray-400'}`}>
                                <Icons.Search />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 py-6">
                {filteredCameras.length === 0 ? (
                    <div className="text-center py-16">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                            theme === 'dark' ? 'bg-dark-800 text-dark-400' : 'bg-gray-100 text-gray-400'
                        }`}>
                            <Icons.Camera />
                        </div>
                        <p className={theme === 'dark' ? 'text-dark-400' : 'text-gray-500'}>
                            {searchQuery ? 'No cameras found matching your search' : 'No cameras available'}
                        </p>
                    </div>
                ) : (
                    <div className={`grid ${gridClass} gap-4`}>
                        {filteredCameras.map(camera => (
                            <CameraCard
                                key={camera.id}
                                camera={camera}
                                streams={camera.streams}
                                onClick={() => handleExpand(camera)}
                            />
                        ))}
                    </div>
                )}
            </main>

            {/* Expanded View */}
            {expandedCamera && (
                <ExpandedView
                    camera={expandedCamera}
                    streams={expandedCamera.streams}
                    onClose={handleCloseExpand}
                />
            )}
        </div>
    );
}

export default LandingPage;
