import { useEffect, useState, useCallback, useRef, memo, createContext, useContext } from 'react';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// ============================================
// ICONS - Optimized SVG Icons
// ============================================
const Icon = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    Camera: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>,
    Search: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
    X: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>,
    Fullscreen: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>,
    ExitFS: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>,
    MapPin: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 5v14m-7-7h14"/></svg>,
    Minus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 12h14"/></svg>,
    Reset: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
    Layout: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
    Grid: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    Check: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7"/></svg>,
    Refresh: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
    Play: () => <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>,
    Download: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3"/></svg>,
    Image: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
    Menu: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 6h16M4 12h16M4 18h16"/></svg>,
    Wifi: () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>,
    WifiOff: () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>,
};

// ============================================
// CAMERA STORE - Simple State Management
// ============================================
const CameraContext = createContext(null);

function useCameraStore() {
    const context = useContext(CameraContext);
    if (!context) throw new Error('useCameraStore must be used within CameraProvider');
    return context;
}

function CameraProvider({ children }) {
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);

    const fetchCameras = useCallback(async () => {
        try {
            setLoading(true);
            const res = await streamService.getAllActiveStreams();
            if (res.success && Array.isArray(res.data)) {
                setCameras(res.data);
                setLastUpdate(new Date());
                setError(null);
            } else {
                setError('No cameras available');
            }
        } catch (e) {
            setError('Connection failed');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchCameras(); }, [fetchCameras]);

    return (
        <CameraContext.Provider value={{ cameras, loading, error, lastUpdate, fetchCameras }}>
            {children}
        </CameraContext.Provider>
    );
}


// ============================================
// SKELETON LOADER
// ============================================
function CameraSkeleton({ dark }) {
    return (
        <div className={`rounded-2xl overflow-hidden animate-pulse ${dark ? 'bg-gray-900' : 'bg-gray-200'}`}>
            <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900" />
            <div className={`p-4 space-y-3 ${dark ? 'bg-gray-900' : 'bg-white'}`}>
                <div className={`h-4 rounded w-3/4 ${dark ? 'bg-gray-800' : 'bg-gray-300'}`} />
                <div className={`h-3 rounded w-1/2 ${dark ? 'bg-gray-800' : 'bg-gray-300'}`} />
                <div className="flex gap-2">
                    <div className={`h-5 w-16 rounded-full ${dark ? 'bg-gray-800' : 'bg-gray-300'}`} />
                    <div className={`h-5 w-12 rounded-full ${dark ? 'bg-gray-800' : 'bg-gray-300'}`} />
                </div>
            </div>
        </div>
    );
}

// ============================================
// CAMERA CARD - No video, just info + thumbnail
// ============================================
const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti, dark }) {
    return (
        <div
            className={`relative rounded-2xl overflow-hidden cursor-pointer group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${
                dark ? 'bg-gray-900 ring-1 ring-white/10 hover:ring-sky-500/50' : 'bg-white ring-1 ring-gray-200 hover:ring-sky-500 shadow-lg'
            }`}
            onClick={onClick}
        >
            {/* Thumbnail */}
            <div className="aspect-video bg-gradient-to-br from-gray-800 via-gray-900 to-black flex items-center justify-center relative overflow-hidden">
                {/* Animated background */}
                <div className="absolute inset-0 opacity-30">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.1),transparent_50%)]" />
                </div>
                
                {/* Camera icon */}
                <div className="text-gray-700/40 transform group-hover:scale-110 transition-transform">
                    <svg className="w-20 h-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>

                {/* Play overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all">
                    <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all duration-300 shadow-2xl border border-white/20">
                        <Icon.Play />
                    </div>
                </div>

                {/* Status chip */}
                <div className="absolute top-3 left-3">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-[10px] font-bold shadow-lg backdrop-blur-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        ONLINE
                    </div>
                </div>

                {/* Multi-view button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                    className={`absolute top-3 right-3 p-2.5 rounded-xl transition-all opacity-0 group-hover:opacity-100 shadow-lg backdrop-blur-sm ${
                        inMulti ? 'bg-emerald-500 text-white' : 'bg-black/50 hover:bg-sky-500 text-white border border-white/10'
                    }`}
                    title={inMulti ? 'In Multi-View' : 'Add to Multi-View'}
                >
                    {inMulti ? <Icon.Check /> : <Icon.Plus />}
                </button>
            </div>

            {/* Info */}
            <div className={`p-4 ${dark ? '' : ''}`}>
                <h3 className={`font-bold text-base truncate ${dark ? 'text-white' : 'text-gray-900'}`}>
                    {camera.name}
                </h3>
                
                {camera.location && (
                    <p className={`text-sm flex items-center gap-1.5 mt-1.5 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                        <Icon.MapPin />
                        <span className="truncate">{camera.location}</span>
                    </p>
                )}
                
                {camera.description && (
                    <p className={`text-xs mt-2 line-clamp-2 leading-relaxed ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {camera.description}
                    </p>
                )}

                {/* Tags */}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${dark ? 'bg-sky-500/15 text-sky-400' : 'bg-sky-100 text-sky-600'}`}>
                        HD Stream
                    </span>
                    {camera.area_name && (
                        <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${dark ? 'bg-purple-500/15 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>
                            {camera.area_name}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});


// ============================================
// VIDEO PLAYER - With Intersection Observer
// ============================================
const VideoPlayer = memo(function VideoPlayer({ camera, onSnapshot, compact = false }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('idle');
    const [isVisible, setIsVisible] = useState(false);
    const [isFS, setIsFS] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const [latency, setLatency] = useState(null);
    const maxRetries = 3;

    const url = camera.streams?.hls;

    // Intersection Observer - only load when visible
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        
        const observer = new IntersectionObserver(
            ([entry]) => setIsVisible(entry.isIntersecting),
            { threshold: 0.1, rootMargin: '50px' }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // HLS Setup - only when visible
    useEffect(() => {
        if (!isVisible || !url || !videoRef.current) return;
        
        const video = videoRef.current;
        let hls = null;
        const startTime = Date.now();

        setStatus('connecting');

        if (Hls.isSupported()) {
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 30,
                maxBufferLength: 10,
                maxMaxBufferLength: 30,
            });
            hlsRef.current = hls;
            hls.loadSource(url);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                const loadTime = Date.now() - startTime;
                setLatency(loadTime);
                video.play().catch(() => {});
                setStatus('live');
                setRetryCount(0);
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCount < maxRetries) {
                        setStatus('reconnecting');
                        setTimeout(() => {
                            hls?.startLoad();
                            setRetryCount(r => r + 1);
                        }, 2000 * (retryCount + 1)); // Exponential backoff
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hls?.recoverMediaError();
                    } else {
                        setStatus('error');
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => {
                setLatency(Date.now() - startTime);
                video.play().catch(() => {});
                setStatus('live');
            });
            video.addEventListener('error', () => setStatus('error'));
        }

        return () => {
            if (hls) {
                hls.destroy();
                hlsRef.current = null;
            }
        };
    }, [isVisible, url, retryCount]);

    // Fullscreen
    useEffect(() => {
        const onChange = () => setIsFS(!!document.fullscreenElement || !!document.webkitFullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('webkitfullscreenchange', onChange);
        return () => {
            document.removeEventListener('fullscreenchange', onChange);
            document.removeEventListener('webkitfullscreenchange', onChange);
        };
    }, []);

    const toggleFS = async () => {
        const el = containerRef.current;
        try {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                await (el.requestFullscreen?.() || el.webkitRequestFullscreen?.());
            } else {
                await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
            }
        } catch {}
    };

    // Snapshot
    const takeSnapshot = () => {
        if (!videoRef.current || status !== 'live') return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        
        const link = document.createElement('a');
        link.download = `${camera.name}-${new Date().toISOString()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        onSnapshot?.();
    };

    const retry = () => {
        setRetryCount(0);
        setStatus('connecting');
    };

    const statusConfig = {
        idle: { color: 'bg-gray-500', text: 'IDLE' },
        connecting: { color: 'bg-amber-500', text: 'CONNECTING' },
        reconnecting: { color: 'bg-orange-500', text: `RETRY ${retryCount}/${maxRetries}` },
        live: { color: 'bg-emerald-500', text: 'LIVE' },
        error: { color: 'bg-red-500', text: 'OFFLINE' },
    };

    const { color, text } = statusConfig[status] || statusConfig.idle;

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden group" onDoubleClick={toggleFS}>
            <video
                ref={videoRef}
                className="w-full h-full"
                style={{ objectFit: isFS ? 'contain' : 'cover' }}
                muted playsInline autoPlay
            />

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

            {/* Status + Latency */}
            <div className="absolute top-2 left-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold text-white ${color} shadow-lg`}>
                    <span className={`w-1.5 h-1.5 rounded-full bg-white ${status === 'live' ? 'animate-pulse' : ''}`} />
                    {text}
                </span>
                {latency && status === 'live' && (
                    <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium text-white bg-black/50 backdrop-blur-sm">
                        <Icon.Wifi />
                        {latency}ms
                    </span>
                )}
            </div>

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-end justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <h3 className={`text-white font-semibold truncate ${compact ? 'text-xs' : 'text-sm'}`}>{camera.name}</h3>
                        {!compact && camera.location && (
                            <p className="text-white/60 text-[10px] flex items-center gap-1 truncate">
                                <Icon.MapPin />{camera.location}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {status === 'live' && (
                            <button onClick={takeSnapshot} className="p-1.5 bg-white/10 hover:bg-white/25 rounded-lg text-white" title="Take Snapshot">
                                <Icon.Image />
                            </button>
                        )}
                        <button onClick={toggleFS} className="p-1.5 bg-white/10 hover:bg-white/25 rounded-lg text-white" title="Fullscreen">
                            {isFS ? <Icon.ExitFS /> : <Icon.Fullscreen />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Loading */}
            {(status === 'connecting' || status === 'reconnecting') && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="text-center">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-white/60 text-xs">{status === 'reconnecting' ? `Retrying... (${retryCount}/${maxRetries})` : 'Connecting...'}</p>
                    </div>
                </div>
            )}

            {/* Error with retry */}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                    <div className="text-center">
                        <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-3">
                            <Icon.WifiOff />
                        </div>
                        <p className="text-white/80 text-sm font-medium mb-3">Connection Failed</p>
                        <button onClick={retry} className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium rounded-lg transition-colors">
                            Retry Connection
                        </button>
                    </div>
                </div>
            )}

            {/* Not visible placeholder */}
            {!isVisible && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                    <div className="text-gray-700"><Icon.Camera /></div>
                </div>
            )}
        </div>
    );
});


// ============================================
// VIDEO POPUP MODAL
// ============================================
function VideoPopup({ camera, onClose }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('connecting');
    const [isFS, setIsFS] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const [latency, setLatency] = useState(null);
    const dragRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

    const url = camera.streams?.hls;

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && !isFS && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose, isFS]);

    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        const startTime = Date.now();

        if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
            hlsRef.current = hls;
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                setLatency(Date.now() - startTime);
                video.play().catch(() => {});
                setStatus('live');
            });
            hls.on(Hls.Events.ERROR, (_, d) => {
                if (d.fatal) {
                    if (d.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls?.startLoad(), 3000);
                    else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
                    else setStatus('error');
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => { setLatency(Date.now() - startTime); video.play().catch(() => {}); setStatus('live'); });
            video.addEventListener('error', () => setStatus('error'));
        }
        return () => { if (hls) { hls.destroy(); hlsRef.current = null; } };
    }, [url]);

    useEffect(() => {
        const onChange = () => setIsFS(!!document.fullscreenElement || !!document.webkitFullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('webkitfullscreenchange', onChange);
        return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('webkitfullscreenchange', onChange); };
    }, []);

    const toggleFS = async () => {
        const el = containerRef.current;
        try {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) await (el.requestFullscreen?.() || el.webkitRequestFullscreen?.());
            else await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
        } catch {}
    };

    const takeSnapshot = () => {
        if (!videoRef.current || status !== 'live') return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        const link = document.createElement('a');
        link.download = `${camera.name}-${new Date().toISOString()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    // Zoom/Pan
    const maxPan = 250 * (zoom - 1);
    const onWheel = (e) => { e.preventDefault(); setZoom(z => { const nz = Math.max(1, Math.min(5, z + (e.deltaY > 0 ? -0.25 : 0.25))); if (nz === 1) setPan({ x: 0, y: 0 }); return nz; }); };
    const onPointerDown = (e) => { if (zoom <= 1) return; setDragging(true); dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; };
    const onPointerMove = (e) => { if (!dragging) return; setPan({ x: Math.max(-maxPan, Math.min(maxPan, dragRef.current.px + (e.clientX - dragRef.current.x))), y: Math.max(-maxPan, Math.min(maxPan, dragRef.current.py + (e.clientY - dragRef.current.y))) }); };
    const onPointerUp = () => setDragging(false);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-8 bg-black/90 backdrop-blur-md" onClick={onClose}>
            <div ref={containerRef} className="relative w-full max-w-6xl bg-gray-950 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 flex flex-col max-h-[95vh]" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-3 sm:p-4 border-b border-white/10 bg-gray-900/80">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-white font-bold text-base sm:text-lg truncate">{camera.name}</h2>
                            <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                status === 'live' ? 'bg-emerald-500/20 text-emerald-400' : status === 'connecting' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-emerald-400 animate-pulse' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
                                {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
                            </span>
                            {latency && status === 'live' && (
                                <span className="text-[10px] text-gray-500 flex items-center gap-1">
                                    <Icon.Wifi /> {latency}ms
                                </span>
                            )}
                        </div>
                        {camera.location && <p className="text-gray-400 text-xs sm:text-sm flex items-center gap-1.5 mt-1 truncate"><Icon.MapPin /> {camera.location}</p>}
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2">
                        {status === 'live' && (
                            <button onClick={takeSnapshot} className="p-2 hover:bg-white/10 rounded-xl text-white transition-colors" title="Take Snapshot">
                                <Icon.Image />
                            </button>
                        )}
                        <button onClick={toggleFS} className="p-2 hover:bg-white/10 rounded-xl text-white transition-colors" title="Fullscreen">
                            {isFS ? <Icon.ExitFS /> : <Icon.Fullscreen />}
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white transition-colors">
                            <Icon.X />
                        </button>
                    </div>
                </div>

                {/* Video */}
                <div className="relative bg-black flex-1 min-h-0 aspect-video" style={{ touchAction: zoom > 1 ? 'none' : 'auto' }} onWheel={onWheel} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onDoubleClick={toggleFS}>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <video ref={videoRef} onPointerDown={onPointerDown} className="max-w-full max-h-full w-auto h-auto" style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }} muted playsInline autoPlay />
                    </div>
                    {status === 'connecting' && <div className="absolute inset-0 flex items-center justify-center bg-black/60"><div className="w-10 h-10 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin" /></div>}
                    {status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-black/80"><p className="text-red-400">Stream Unavailable</p></div>}
                </div>

                {/* Footer */}
                <div className="p-3 sm:p-4 border-t border-white/10 bg-gray-900/80">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            {camera.description && <p className="text-gray-400 text-xs sm:text-sm line-clamp-1">{camera.description}</p>}
                            <div className="flex items-center gap-2 mt-1">
                                {camera.area_name && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">{camera.area_name}</span>}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400">HD Stream</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
                            <button onClick={() => { const nz = Math.max(1, zoom - 0.5); setZoom(nz); if (nz === 1) setPan({ x: 0, y: 0 }); }} disabled={zoom <= 1} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icon.Minus /></button>
                            <span className="text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                            <button onClick={() => setZoom(z => Math.min(5, z + 0.5))} disabled={zoom >= 5} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icon.Plus /></button>
                            {zoom > 1 && <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-2 hover:bg-white/10 rounded-lg text-white ml-1"><Icon.Reset /></button>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


// ============================================
// MULTI-VIEW PANEL
// ============================================
function MultiViewPanel({ selectedIds, allCameras, onRemove, onClear, onClose }) {
    const selected = selectedIds.map(id => allCameras.find(c => c.id === id)).filter(Boolean);
    const count = selected.length;

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose]);

    // Responsive grid: 1 col mobile, 2 col tablet+
    const layoutClass = count === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2';

    return (
        <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-white/10 bg-gray-900/50">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400">
                        <Icon.Layout />
                    </div>
                    <div>
                        <h2 className="text-white font-bold">Multi-View</h2>
                        <p className="text-gray-500 text-xs">{count} of 3 cameras</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {count > 0 && (
                        <button onClick={onClear} className="px-3 py-2 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-colors">
                            Clear All
                        </button>
                    )}
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white transition-colors">
                        <Icon.X />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 p-2 sm:p-4 overflow-auto">
                {count === 0 ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center max-w-xs">
                            <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4 text-gray-600">
                                <Icon.Layout />
                            </div>
                            <p className="text-white font-medium mb-2">No Cameras Selected</p>
                            <p className="text-gray-500 text-sm">Tap the + button on camera cards to add them to multi-view (max 3)</p>
                        </div>
                    </div>
                ) : (
                    <div className={`grid ${layoutClass} gap-2 sm:gap-4 h-full auto-rows-fr`}>
                        {selected.map((cam, i) => (
                            <div key={cam.id} className={`relative rounded-xl overflow-hidden bg-black ${count === 3 && i === 2 ? 'sm:col-span-2' : ''}`}>
                                <VideoPlayer camera={cam} compact />
                                <button
                                    onClick={() => onRemove(cam.id)}
                                    className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-red-500 rounded-lg text-white opacity-0 hover:opacity-100 transition-all z-10"
                                >
                                    <Icon.X />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================
// LAYOUT SWITCHER (Floating)
// ============================================
function LayoutSwitcher({ value, onChange, dark }) {
    const layouts = [
        { cols: 1, label: '1×1', icon: '▢' },
        { cols: 2, label: '2×2', icon: '▦' },
        { cols: 3, label: '3×3', icon: '▩' },
    ];

    return (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 p-1 rounded-2xl shadow-2xl backdrop-blur-xl ${
            dark ? 'bg-gray-900/90 ring-1 ring-white/10' : 'bg-white/90 ring-1 ring-gray-200'
        }`}>
            {layouts.map(({ cols, label }) => (
                <button
                    key={cols}
                    onClick={() => onChange(cols)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        value === cols
                            ? 'bg-sky-500 text-white shadow-lg'
                            : dark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}


// ============================================
// MAIN LANDING PAGE COMPONENT
// ============================================
function LandingPageContent() {
    const { cameras, loading, error, fetchCameras } = useCameraStore();
    const { dark, toggleTheme } = useTheme();
    const [search, setSearch] = useState('');
    const [cols, setCols] = useState(2);
    const [popup, setPopup] = useState(null);
    const [multiIds, setMultiIds] = useState([]);
    const [showMulti, setShowMulti] = useState(false);
    const [mobileMenu, setMobileMenu] = useState(false);

    // Filter cameras
    const filtered = cameras.filter(c =>
        c.name?.toLowerCase().includes(search.toLowerCase()) ||
        c.location?.toLowerCase().includes(search.toLowerCase()) ||
        c.area_name?.toLowerCase().includes(search.toLowerCase())
    );

    // Multi-view handlers
    const toggleMulti = (id) => {
        setMultiIds(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            if (prev.length >= 3) return prev;
            return [...prev, id];
        });
    };

    // Grid columns based on selection
    const gridCols = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 sm:grid-cols-2',
        3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    };

    return (
        <div className={`min-h-screen transition-colors duration-300 ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* Navbar */}
            <nav className={`sticky top-0 z-40 backdrop-blur-xl border-b transition-colors ${
                dark ? 'bg-gray-950/80 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="flex items-center justify-between h-16">
                        {/* Logo */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/25">
                                <Icon.Camera />
                            </div>
                            <div className="hidden sm:block">
                                <h1 className={`font-bold text-lg ${dark ? 'text-white' : 'text-gray-900'}`}>RAF NET</h1>
                                <p className={`text-[10px] -mt-0.5 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>CCTV Hub</p>
                            </div>
                        </div>

                        {/* Desktop Search */}
                        <div className="hidden md:flex flex-1 max-w-md mx-8">
                            <div className={`relative w-full ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                                <Icon.Search />
                                <input
                                    type="text"
                                    placeholder="Search cameras..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-sm transition-all ${
                                        dark
                                            ? 'bg-white/5 text-white placeholder-gray-500 focus:bg-white/10 focus:ring-2 focus:ring-sky-500/50'
                                            : 'bg-gray-100 text-gray-900 placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-sky-500'
                                    } outline-none`}
                                />
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                    <Icon.Search />
                                </div>
                            </div>
                        </div>

                        {/* Desktop Actions */}
                        <div className="hidden md:flex items-center gap-2">
                            {multiIds.length > 0 && (
                                <button
                                    onClick={() => setShowMulti(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-sky-500/25"
                                >
                                    <Icon.Layout />
                                    Multi-View ({multiIds.length})
                                </button>
                            )}
                            <button
                                onClick={fetchCameras}
                                className={`p-2.5 rounded-xl transition-colors ${
                                    dark ? 'hover:bg-white/10 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'
                                }`}
                                title="Refresh"
                            >
                                <Icon.Refresh />
                            </button>
                            <button
                                onClick={toggleTheme}
                                className={`p-2.5 rounded-xl transition-colors ${
                                    dark ? 'hover:bg-white/10 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'
                                }`}
                            >
                                {dark ? <Icon.Sun /> : <Icon.Moon />}
                            </button>
                        </div>

                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setMobileMenu(!mobileMenu)}
                            className={`md:hidden p-2 rounded-xl ${dark ? 'text-white' : 'text-gray-900'}`}
                        >
                            {mobileMenu ? <Icon.X /> : <Icon.Menu />}
                        </button>
                    </div>

                    {/* Mobile Menu */}
                    {mobileMenu && (
                        <div className={`md:hidden py-4 border-t ${dark ? 'border-white/10' : 'border-gray-200'}`}>
                            {/* Mobile Search */}
                            <div className="relative mb-4">
                                <input
                                    type="text"
                                    placeholder="Search cameras..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className={`w-full pl-10 pr-4 py-3 rounded-xl text-sm ${
                                        dark
                                            ? 'bg-white/5 text-white placeholder-gray-500'
                                            : 'bg-gray-100 text-gray-900 placeholder-gray-400'
                                    } outline-none`}
                                />
                                <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                                    <Icon.Search />
                                </div>
                            </div>

                            {/* Mobile Actions */}
                            <div className="flex flex-col gap-2">
                                {multiIds.length > 0 && (
                                    <button
                                        onClick={() => { setShowMulti(true); setMobileMenu(false); }}
                                        className="flex items-center justify-center gap-2 px-4 py-3 bg-sky-500 text-white font-medium rounded-xl"
                                    >
                                        <Icon.Layout />
                                        Open Multi-View ({multiIds.length})
                                    </button>
                                )}
                                <div className="flex gap-2">
                                    <button
                                        onClick={fetchCameras}
                                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl ${
                                            dark ? 'bg-white/5 text-white' : 'bg-gray-100 text-gray-900'
                                        }`}
                                    >
                                        <Icon.Refresh />
                                        Refresh
                                    </button>
                                    <button
                                        onClick={toggleTheme}
                                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl ${
                                            dark ? 'bg-white/5 text-white' : 'bg-gray-100 text-gray-900'
                                        }`}
                                    >
                                        {dark ? <><Icon.Sun /> Light</> : <><Icon.Moon /> Dark</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </nav>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className={`text-xl sm:text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>
                            Live Cameras
                        </h2>
                        <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                            {loading ? 'Loading...' : `${filtered.length} camera${filtered.length !== 1 ? 's' : ''} available`}
                        </p>
                    </div>
                </div>

                {/* Error State */}
                {error && !loading && (
                    <div className={`text-center py-16 rounded-2xl ${dark ? 'bg-red-500/10' : 'bg-red-50'}`}>
                        <div className="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                            <Icon.WifiOff />
                        </div>
                        <p className={`font-medium mb-2 ${dark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
                        <button
                            onClick={fetchCameras}
                            className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-xl transition-colors"
                        >
                            Try Again
                        </button>
                    </div>
                )}

                {/* Loading Skeletons */}
                {loading && (
                    <div className={`grid ${gridCols[cols]} gap-4 sm:gap-6`}>
                        {[...Array(6)].map((_, i) => (
                            <CameraSkeleton key={i} dark={dark} />
                        ))}
                    </div>
                )}

                {/* Camera Grid */}
                {!loading && !error && (
                    <>
                        {filtered.length === 0 ? (
                            <div className="text-center py-16">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${dark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-400'}`}>
                                    <Icon.Camera />
                                </div>
                                <p className={`font-medium ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {search ? 'No cameras match your search' : 'No cameras available'}
                                </p>
                            </div>
                        ) : (
                            <div className={`grid ${gridCols[cols]} gap-4 sm:gap-6`}>
                                {filtered.map(camera => (
                                    <CameraCard
                                        key={camera.id}
                                        camera={camera}
                                        onClick={() => setPopup(camera)}
                                        onAddMulti={() => toggleMulti(camera.id)}
                                        inMulti={multiIds.includes(camera.id)}
                                        dark={dark}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* Layout Switcher */}
            {!loading && filtered.length > 0 && (
                <LayoutSwitcher value={cols} onChange={setCols} dark={dark} />
            )}

            {/* Video Popup */}
            {popup && <VideoPopup camera={popup} onClose={() => setPopup(null)} />}

            {/* Multi-View Panel */}
            {showMulti && (
                <MultiViewPanel
                    selectedIds={multiIds}
                    allCameras={cameras}
                    onRemove={(id) => setMultiIds(prev => prev.filter(x => x !== id))}
                    onClear={() => setMultiIds([])}
                    onClose={() => setShowMulti(false)}
                />
            )}
        </div>
    );
}

// Wrap with Provider
function LandingPage() {
    return (
        <CameraProvider>
            <LandingPageContent />
        </CameraProvider>
    );
}

export default LandingPage;
