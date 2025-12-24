import { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// Icons
const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>,
    Grid: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>,
    Camera: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
    Search: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
    Close: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
    Location: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>,
    Expand: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>,
};

// HLS Cache - prevent reload when already loaded
const hlsCache = new Map();


// Memoized Video Player - prevents reload when props unchanged
const VideoPlayer = memo(({ camera, streams, isExpanded }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const containerRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const mountedRef = useRef(true);

    // Stable stream URL reference
    const streamUrl = streams?.hls;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;

        const video = videoRef.current;
        const cacheKey = `${camera.id}-${streamUrl}`;

        // Check if already loaded in cache
        if (hlsCache.has(cacheKey) && hlsRef.current) {
            return;
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
                    maxMaxBufferLength: 60,
                });

                hlsRef.current = hls;
                hlsCache.set(cacheKey, hls);

                hls.loadSource(streamUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (!mountedRef.current) return;
                    video.play().then(() => {
                        if (mountedRef.current) setStatus('playing');
                    }).catch(() => {
                        if (mountedRef.current) {
                            setStatus('error');
                            setError('Autoplay blocked');
                        }
                    });
                });

                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (!mountedRef.current) return;
                    if (data.fatal) {
                        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                            hls.startLoad();
                        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                            hls.recoverMediaError();
                        } else {
                            setStatus('error');
                            setError('Stream unavailable');
                        }
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari native HLS
                video.src = streamUrl;
                video.addEventListener('loadedmetadata', () => {
                    if (!mountedRef.current) return;
                    video.play().then(() => {
                        if (mountedRef.current) setStatus('playing');
                    }).catch(() => {
                        if (mountedRef.current) setStatus('error');
                    });
                });
            } else {
                setStatus('error');
                setError('Browser not supported');
            }
        };

        initPlayer();

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
                hlsCache.delete(cacheKey);
            }
        };
    }, [streamUrl, camera.id]);

    // Fullscreen handling
    useEffect(() => {
        const handleFSChange = () => setIsFullScreen(!!document.fullscreenElement);
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
            if (!document.fullscreenElement) {
                await (containerRef.current.requestFullscreen?.() || containerRef.current.webkitRequestFullscreen?.());
            } else {
                await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
            }
        } catch (err) { /* ignore */ }
    };

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden rounded-xl group">
            <video
                ref={videoRef}
                className="w-full h-full"
                style={{ objectFit: isExpanded || isFullScreen ? 'contain' : 'cover' }}
                muted
                playsInline
                autoPlay
            />

            {/* Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
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

                {/* Fullscreen Button */}
                <div className="absolute bottom-3 right-3">
                    <button
                        onClick={toggleFullScreen}
                        className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                        <Icons.Expand />
                    </button>
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
                        <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                            <Icons.Close />
                        </div>
                        <p className="text-red-400 text-sm font-medium">{error || 'Stream unavailable'}</p>
                    </div>
                </div>
            )}
        </div>
    );
}, (prev, next) => {
    // Custom comparison - only re-render if these change
    return prev.camera.id === next.camera.id && 
           prev.streams?.hls === next.streams?.hls &&
           prev.isExpanded === next.isExpanded;
});


// Camera Card - memoized to prevent unnecessary re-renders
const CameraCard = memo(({ camera, streams, onClick }) => {
    return (
        <div 
            className="relative aspect-video rounded-xl overflow-hidden cursor-pointer 
                       bg-dark-800 dark:bg-dark-800 light:bg-gray-100
                       shadow-lg hover:shadow-xl transition-shadow duration-300
                       ring-1 ring-white/5 hover:ring-primary-500/30"
            onClick={onClick}
        >
            <VideoPlayer camera={camera} streams={streams} isExpanded={false} />
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
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4">
            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
                <Icons.Close />
            </button>

            {/* Video container - responsive */}
            <div className="w-full h-full max-w-7xl max-h-[90vh] flex items-center justify-center">
                <div className="w-full h-full">
                    <VideoPlayer camera={camera} streams={streams} isExpanded={true} />
                </div>
            </div>

            {/* Camera info */}
            <div className="absolute bottom-4 left-4 text-white">
                <h2 className="text-xl font-bold">{camera.name}</h2>
                {camera.location && (
                    <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
                        <Icons.Location /> {camera.location}
                    </p>
                )}
            </div>
        </div>
    );
});


// Main Landing Page Component
function LandingPage() {
    const { theme, toggleTheme } = useTheme();
    const [cameras, setCameras] = useState([]);
    const [streamsMap, setStreamsMap] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCamera, setExpandedCamera] = useState(null);
    const [gridCols, setGridCols] = useState(2);

    // Fetch cameras
    useEffect(() => {
        const fetchCameras = async () => {
            try {
                setLoading(true);
                const response = await streamService.getAllStreams();
                if (response.success && response.data) {
                    const cameraList = response.data.map(item => ({
                        id: item.camera.id,
                        name: item.camera.name,
                        location: item.camera.location || item.camera.description,
                    }));
                    setCameras(cameraList);

                    // Build streams map
                    const streams = {};
                    response.data.forEach(item => {
                        streams[item.camera.id] = item.streams;
                    });
                    setStreamsMap(streams);
                }
            } catch (err) {
                setError('Failed to load cameras');
            } finally {
                setLoading(false);
            }
        };

        fetchCameras();
    }, []);

    // Filter cameras by search
    const filteredCameras = useMemo(() => {
        if (!searchQuery.trim()) return cameras;
        const query = searchQuery.toLowerCase();
        return cameras.filter(c => 
            c.name.toLowerCase().includes(query) ||
            c.location?.toLowerCase().includes(query)
        );
    }, [cameras, searchQuery]);

    // Handle expand
    const handleExpand = useCallback((camera) => {
        setExpandedCamera(camera);
    }, []);

    const handleCloseExpand = useCallback(() => {
        setExpandedCamera(null);
    }, []);

    // Grid columns class
    const gridClass = useMemo(() => {
        switch (gridCols) {
            case 1: return 'grid-cols-1';
            case 2: return 'grid-cols-1 md:grid-cols-2';
            case 3: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
            default: return 'grid-cols-1 md:grid-cols-2';
        }
    }, [gridCols]);

    if (loading) {
        return (
            <div className="min-h-screen bg-dark-950 dark:bg-dark-950 light:bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-dark-400 dark:text-dark-400 light:text-gray-600">Loading cameras...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-dark-950 dark:bg-dark-950 light:bg-gray-50 flex items-center justify-center">
                <div className="text-center p-8">
                    <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icons.Close />
                    </div>
                    <p className="text-red-400 text-lg font-medium">{error}</p>
                    <button 
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-dark-950 dark:bg-dark-950 light:bg-gray-50 transition-colors duration-300">
            {/* Header */}
            <header className="sticky top-0 z-40 bg-dark-900/80 dark:bg-dark-900/80 light:bg-white/80 backdrop-blur-lg border-b border-white/5 dark:border-white/5 light:border-gray-200">
                <div className="max-w-7xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                        {/* Logo */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center">
                                <Icons.Camera />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-white dark:text-white light:text-gray-900">RAF NET CCTV</h1>
                                <p className="text-xs text-dark-400 dark:text-dark-400 light:text-gray-500">{cameras.length} cameras online</p>
                            </div>
                        </div>

                        {/* Search */}
                        <div className="flex-1 max-w-md hidden sm:block">
                            <div className="relative">
                                <Icons.Search />
                                <input
                                    type="text"
                                    placeholder="Search cameras..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 bg-dark-800 dark:bg-dark-800 light:bg-gray-100 
                                             text-white dark:text-white light:text-gray-900
                                             placeholder-dark-400 dark:placeholder-dark-400 light:placeholder-gray-500
                                             rounded-lg border border-white/5 dark:border-white/5 light:border-gray-200
                                             focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                                />
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400">
                                    <Icons.Search />
                                </div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-2">
                            {/* Grid toggle */}
                            <div className="hidden sm:flex items-center gap-1 bg-dark-800 dark:bg-dark-800 light:bg-gray-100 rounded-lg p-1">
                                {[1, 2, 3].map(cols => (
                                    <button
                                        key={cols}
                                        onClick={() => setGridCols(cols)}
                                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                            gridCols === cols 
                                                ? 'bg-primary-600 text-white' 
                                                : 'text-dark-400 hover:text-white dark:hover:text-white light:hover:text-gray-900'
                                        }`}
                                    >
                                        {cols}
                                    </button>
                                ))}
                            </div>

                            {/* Theme toggle */}
                            <button
                                onClick={toggleTheme}
                                className="p-2 rounded-lg bg-dark-800 dark:bg-dark-800 light:bg-gray-100 
                                         text-dark-400 hover:text-white dark:hover:text-white light:hover:text-gray-900
                                         transition-colors"
                            >
                                {theme === 'dark' ? <Icons.Sun /> : <Icons.Moon />}
                            </button>
                        </div>
                    </div>

                    {/* Mobile search */}
                    <div className="mt-3 sm:hidden">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search cameras..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-dark-800 dark:bg-dark-800 light:bg-gray-100 
                                         text-white dark:text-white light:text-gray-900
                                         placeholder-dark-400 rounded-lg border border-white/5
                                         focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400">
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
                        <Icons.Camera />
                        <p className="text-dark-400 dark:text-dark-400 light:text-gray-500 mt-4">
                            {searchQuery ? 'No cameras found' : 'No cameras available'}
                        </p>
                    </div>
                ) : (
                    <div className={`grid ${gridClass} gap-4`}>
                        {filteredCameras.map(camera => (
                            <CameraCard
                                key={camera.id}
                                camera={camera}
                                streams={streamsMap[camera.id]}
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
                    streams={streamsMap[expandedCamera.id]}
                    onClose={handleCloseExpand}
                />
            )}
        </div>
    );
}

export default LandingPage;
