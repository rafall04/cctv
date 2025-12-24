import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// Simple Icons
const SunIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
);

const MoonIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
);

const CameraIcon = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const SearchIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

const CloseIcon = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const ExpandIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
);

const LocationIcon = () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    </svg>
);

const PlusIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
);

const MinusIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
    </svg>
);

const ResetIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
);


// Video Player Component
const VideoPlayer = memo(function VideoPlayer({ camera, streams, isExpanded, enableZoom }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const containerRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [isFullScreen, setIsFullScreen] = useState(false);

    // Zoom state
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    const streamUrl = streams?.hls;

    // Initialize HLS
    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;

        const video = videoRef.current;
        let hls = null;

        if (Hls.isSupported()) {
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90,
            });
            hlsRef.current = hls;
            hls.loadSource(streamUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play().then(() => setStatus('playing')).catch(() => setStatus('playing'));
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        setTimeout(() => hls.startLoad(), 2000);
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hls.recoverMediaError();
                    } else {
                        setStatus('error');
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', () => {
                video.play().then(() => setStatus('playing')).catch(() => setStatus('playing'));
            });
        }

        return () => {
            if (hls) {
                hls.destroy();
                hlsRef.current = null;
            }
        };
    }, [streamUrl]);

    // Fullscreen
    useEffect(() => {
        const onFSChange = () => setIsFullScreen(!!document.fullscreenElement || !!document.webkitFullscreenElement);
        document.addEventListener('fullscreenchange', onFSChange);
        document.addEventListener('webkitfullscreenchange', onFSChange);
        return () => {
            document.removeEventListener('fullscreenchange', onFSChange);
            document.removeEventListener('webkitfullscreenchange', onFSChange);
        };
    }, []);

    const toggleFullScreen = async (e) => {
        e?.stopPropagation();
        const el = containerRef.current;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (el.requestFullscreen) await el.requestFullscreen();
            else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        } else {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        }
    };

    // Zoom handlers
    const handleWheel = (e) => {
        if (!enableZoom) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.3 : 0.3;
        setZoom(z => {
            const newZ = Math.max(1, Math.min(5, z + delta));
            if (newZ === 1) setPan({ x: 0, y: 0 });
            return newZ;
        });
    };

    const handleMouseDown = (e) => {
        if (!enableZoom || zoom <= 1) return;
        e.preventDefault();
        setIsDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    };

    const handleMouseMove = (e) => {
        if (!isDragging || zoom <= 1) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        const maxPan = 150 * (zoom - 1);
        setPan({
            x: Math.max(-maxPan, Math.min(maxPan, dragStart.current.panX + dx)),
            y: Math.max(-maxPan, Math.min(maxPan, dragStart.current.panY + dy)),
        });
    };

    const handleMouseUp = () => setIsDragging(false);

    // Touch handlers
    const handleTouchStart = (e) => {
        if (!enableZoom || zoom <= 1) return;
        const t = e.touches[0];
        setIsDragging(true);
        dragStart.current = { x: t.clientX, y: t.clientY, panX: pan.x, panY: pan.y };
    };

    const handleTouchMove = (e) => {
        if (!isDragging || zoom <= 1) return;
        if (e.cancelable) e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - dragStart.current.x;
        const dy = t.clientY - dragStart.current.y;
        const maxPan = 150 * (zoom - 1);
        setPan({
            x: Math.max(-maxPan, Math.min(maxPan, dragStart.current.panX + dx)),
            y: Math.max(-maxPan, Math.min(maxPan, dragStart.current.panY + dy)),
        });
    };

    const zoomIn = (e) => { e?.stopPropagation(); setZoom(z => Math.min(5, z + 0.5)); };
    const zoomOut = (e) => { e?.stopPropagation(); setZoom(z => { const nz = Math.max(1, z - 0.5); if (nz === 1) setPan({ x: 0, y: 0 }); return nz; }); };
    const resetZoom = (e) => { e?.stopPropagation(); setZoom(1); setPan({ x: 0, y: 0 }); };

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full bg-black overflow-hidden rounded-xl group"
            style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
            onWheel={handleWheel}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleMouseUp}
        >
            <video
                ref={videoRef}
                onMouseDown={handleMouseDown}
                className="w-full h-full"
                style={{
                    objectFit: isExpanded || isFullScreen ? 'contain' : 'cover',
                    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                    cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                }}
                muted
                playsInline
                autoPlay
            />

            {/* Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Info */}
                <div className="absolute top-3 left-3 right-12">
                    <h3 className="text-sm font-bold text-white truncate">{camera.name}</h3>
                    {camera.location && (
                        <p className="text-xs text-gray-300 flex items-center gap-1 mt-0.5">
                            <LocationIcon /> <span className="truncate">{camera.location}</span>
                        </p>
                    )}
                </div>

                {/* Status */}
                <div className="absolute top-3 right-3">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                        status === 'playing' ? 'bg-green-500/30 text-green-400' :
                        status === 'loading' ? 'bg-yellow-500/30 text-yellow-400' : 'bg-red-500/30 text-red-400'
                    }`}>
                        {status === 'playing' ? '● LIVE' : status === 'loading' ? 'LOADING' : 'OFFLINE'}
                    </span>
                </div>

                {/* Controls */}
                <div className="absolute bottom-3 left-3 right-3 flex justify-between items-center">
                    {enableZoom && isExpanded ? (
                        <div className="flex items-center gap-1 bg-black/60 rounded-lg p-1">
                            <button onClick={zoomOut} className="p-1.5 hover:bg-white/20 rounded text-white"><MinusIcon /></button>
                            <span className="text-xs text-white w-10 text-center">{Math.round(zoom * 100)}%</span>
                            <button onClick={zoomIn} className="p-1.5 hover:bg-white/20 rounded text-white"><PlusIcon /></button>
                            <button onClick={resetZoom} className="p-1.5 hover:bg-white/20 rounded text-white ml-1"><ResetIcon /></button>
                        </div>
                    ) : <div />}
                    <button onClick={toggleFullScreen} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white">
                        <ExpandIcon />
                    </button>
                </div>
            </div>

            {/* Loading */}
            {status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin" />
                </div>
            )}

            {/* Error */}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <p className="text-red-400 text-sm">Stream unavailable</p>
                </div>
            )}
        </div>
    );
});


// Camera Card
const CameraCard = memo(function CameraCard({ camera, onClick }) {
    return (
        <div
            className="aspect-video rounded-xl overflow-hidden cursor-pointer bg-gray-900 shadow-lg hover:shadow-xl transition-shadow ring-1 ring-white/10 hover:ring-sky-500/50"
            onClick={onClick}
        >
            <VideoPlayer camera={camera} streams={camera.streams} isExpanded={false} enableZoom={false} />
        </div>
    );
});

// Expanded Modal
function ExpandedView({ camera, onClose }) {
    useEffect(() => {
        const onEsc = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onEsc);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onEsc);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4">
                <div className="text-white">
                    <h2 className="text-lg font-bold">{camera.name}</h2>
                    {camera.location && (
                        <p className="text-sm text-gray-400 flex items-center gap-1">
                            <LocationIcon /> {camera.location}
                        </p>
                    )}
                </div>
                <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
                    <CloseIcon />
                </button>
            </div>
            {/* Video */}
            <div className="flex-1 p-4 pt-0">
                <VideoPlayer camera={camera} streams={camera.streams} isExpanded={true} enableZoom={true} />
            </div>
        </div>
    );
}


// Main Page
function LandingPage() {
    const { theme, toggleTheme } = useTheme();
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState(null);
    const [cols, setCols] = useState(2);

    const isDark = theme === 'dark';

    // Fetch
    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true);
                const res = await streamService.getAllActiveStreams();
                if (res.success && Array.isArray(res.data)) {
                    setCameras(res.data);
                } else {
                    setError('No cameras found');
                }
            } catch (e) {
                setError('Failed to load cameras');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    // Filter
    const filtered = search.trim()
        ? cameras.filter(c =>
            c.name?.toLowerCase().includes(search.toLowerCase()) ||
            c.location?.toLowerCase().includes(search.toLowerCase())
        )
        : cameras;

    const gridClass = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

    // Loading
    if (loading) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-gray-950' : 'bg-gray-100'}`}>
                <div className="text-center">
                    <div className="w-10 h-10 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mx-auto mb-3" />
                    <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Loading cameras...</p>
                </div>
            </div>
        );
    }

    // Error
    if (error) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-gray-950' : 'bg-gray-100'}`}>
                <div className="text-center p-6">
                    <p className="text-red-400 text-lg mb-4">{error}</p>
                    <button onClick={() => window.location.reload()} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen ${isDark ? 'bg-gray-950' : 'bg-gray-100'}`}>
            {/* Header */}
            <header className={`sticky top-0 z-40 backdrop-blur-md border-b ${isDark ? 'bg-gray-900/80 border-gray-800' : 'bg-white/80 border-gray-200'}`}>
                <div className="max-w-7xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                        {/* Logo */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-sky-700 rounded-xl flex items-center justify-center text-white">
                                <CameraIcon />
                            </div>
                            <div>
                                <h1 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>RAF NET CCTV</h1>
                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{cameras.length} camera{cameras.length !== 1 ? 's' : ''}</p>
                            </div>
                        </div>

                        {/* Search Desktop */}
                        <div className="flex-1 max-w-md hidden sm:block">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className={`w-full pl-10 pr-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                                        isDark ? 'bg-gray-800 text-white border-gray-700 placeholder-gray-500' : 'bg-white text-gray-900 border-gray-300 placeholder-gray-400'
                                    }`}
                                />
                                <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                    <SearchIcon />
                                </div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-2">
                            <div className={`hidden sm:flex items-center gap-1 rounded-lg p-1 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}>
                                {[1, 2, 3].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setCols(n)}
                                        className={`px-3 py-1 rounded text-sm font-medium ${cols === n ? 'bg-sky-600 text-white' : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={toggleTheme}
                                className={`p-2 rounded-lg ${isDark ? 'bg-gray-800 text-gray-400 hover:text-white' : 'bg-gray-200 text-gray-600 hover:text-gray-900'}`}
                            >
                                {isDark ? <SunIcon /> : <MoonIcon />}
                            </button>
                        </div>
                    </div>

                    {/* Search Mobile */}
                    <div className="mt-3 sm:hidden">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className={`w-full pl-10 pr-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                                    isDark ? 'bg-gray-800 text-white border-gray-700 placeholder-gray-500' : 'bg-white text-gray-900 border-gray-300 placeholder-gray-400'
                                }`}
                            />
                            <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                <SearchIcon />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-7xl mx-auto px-4 py-6">
                {filtered.length === 0 ? (
                    <div className="text-center py-16">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-400'}`}>
                            <CameraIcon />
                        </div>
                        <p className={isDark ? 'text-gray-500' : 'text-gray-600'}>
                            {search ? 'No cameras match your search' : 'No cameras available'}
                        </p>
                    </div>
                ) : (
                    <div className={`grid ${gridClass} gap-4`}>
                        {filtered.map(cam => (
                            <CameraCard key={cam.id} camera={cam} onClick={() => setExpanded(cam)} />
                        ))}
                    </div>
                )}
            </main>

            {/* Expanded */}
            {expanded && <ExpandedView camera={expanded} onClose={() => setExpanded(null)} />}
        </div>
    );
}

export default LandingPage;
