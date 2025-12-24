import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// Icons
const Icon = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    Camera: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>,
    Search: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
    X: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>,
    Fullscreen: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>,
    ExitFS: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>,
    MapPin: () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 5v14m-7-7h14"/></svg>,
    Minus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 12h14"/></svg>,
    Reset: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
    Signal: () => <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>,
    Layout: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
    Check: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7"/></svg>,
    Refresh: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
    Clock: () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    ZoomIn: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6m-3-3h6"/></svg>,
    ZoomOut: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/></svg>,
};


// Video Player Component
const VideoPlayer = memo(function VideoPlayer({ camera, streams, showControls = true, isMultiView, onRemove }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const containerRef = useRef(null);
    const [status, setStatus] = useState('connecting');
    const [isFS, setIsFS] = useState(false);

    const url = streams?.hls;

    // HLS Setup
    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;

        setStatus('connecting');
        if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
            hlsRef.current = hls;
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setStatus('live'); });
            hls.on(Hls.Events.ERROR, (_, d) => {
                if (d.fatal) {
                    if (d.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls?.startLoad(), 3000);
                    else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
                    else setStatus('offline');
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); setStatus('live'); });
            video.addEventListener('error', () => setStatus('offline'));
        }
        return () => { if (hls) { hls.destroy(); hlsRef.current = null; } };
    }, [url]);

    // Fullscreen listener
    useEffect(() => {
        const onChange = () => setIsFS(!!document.fullscreenElement || !!document.webkitFullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('webkitfullscreenchange', onChange);
        return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('webkitfullscreenchange', onChange); };
    }, []);

    // Direct fullscreen
    const goFullscreen = async (e) => {
        e?.stopPropagation();
        const el = containerRef.current;
        try {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                await (el.requestFullscreen?.() || el.webkitRequestFullscreen?.());
            } else {
                await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
            }
        } catch {}
    };

    const statusColor = status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-red-500';

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden group">
            <video
                ref={videoRef}
                className="w-full h-full object-cover"
                style={{ objectFit: isFS ? 'contain' : 'cover' }}
                muted playsInline autoPlay
            />

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

            {/* Status badge */}
            {showControls && (
                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${statusColor}`}>
                        <Icon.Signal />
                        {status === 'live' ? 'LIVE' : status === 'connecting' ? '...' : 'OFF'}
                    </span>
                </div>
            )}

            {/* Remove button for multi-view */}
            {isMultiView && onRemove && (
                <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-500 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all">
                    <Icon.X />
                </button>
            )}

            {/* Bottom controls */}
            {showControls && (
                <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-end justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            <h3 className={`text-white font-semibold truncate ${isMultiView ? 'text-xs' : 'text-sm'}`}>{camera.name}</h3>
                            {!isMultiView && camera.location && (
                                <p className="text-white/60 text-[10px] flex items-center gap-1 truncate"><Icon.MapPin />{camera.location}</p>
                            )}
                        </div>
                        <button onClick={goFullscreen} className="p-1.5 bg-white/10 hover:bg-white/25 rounded-lg text-white flex-shrink-0">
                            {isFS ? <Icon.ExitFS /> : <Icon.Fullscreen />}
                        </button>
                    </div>
                </div>
            )}

            {/* Loading */}
            {status === 'connecting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                </div>
            )}

            {/* Offline */}
            {status === 'offline' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <p className="text-white/50 text-xs">Offline</p>
                </div>
            )}
        </div>
    );
});


// Camera Card - video plays here, click opens popup
const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti }) {
    const [visible, setVisible] = useState(false);
    const ref = useRef(null);

    // Lazy load - only render video when visible
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: '100px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            className="relative aspect-video rounded-2xl overflow-hidden bg-gray-900 shadow-xl ring-1 ring-white/5 hover:ring-sky-500/40 transition-all cursor-pointer group/card"
            onClick={onClick}
        >
            {visible ? (
                <VideoPlayer camera={camera} streams={camera.streams} />
            ) : (
                <div className="w-full h-full flex items-center justify-center">
                    <div className="text-gray-700 animate-pulse"><Icon.Camera /></div>
                </div>
            )}

            {/* Add to multi-view button */}
            <button
                onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                disabled={inMulti}
                className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all opacity-0 group-hover/card:opacity-100 z-10 ${
                    inMulti ? 'bg-emerald-500 text-white' : 'bg-black/60 hover:bg-sky-500 text-white'
                }`}
            >
                {inMulti ? <Icon.Check /> : <Icon.Plus />}
            </button>
        </div>
    );
});

// Popup Modal - smaller, centered, with zoom controls
function PopupModal({ camera, onClose }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

    const url = camera.streams?.hls;

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose]);

    // HLS for popup
    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;

        if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
            hlsRef.current = hls;
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
            hls.on(Hls.Events.ERROR, (_, d) => {
                if (d.fatal) {
                    if (d.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls?.startLoad(), 3000);
                    else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.play().catch(() => {});
        }
        return () => { if (hls) { hls.destroy(); hlsRef.current = null; } };
    }, [url]);

    // Zoom/Pan
    const maxPan = 200 * (zoom - 1);
    const onWheel = (e) => { e.preventDefault(); setZoom(z => { const nz = Math.max(1, Math.min(4, z + (e.deltaY > 0 ? -0.2 : 0.2))); if (nz === 1) setPan({ x: 0, y: 0 }); return nz; }); };
    const onPointerDown = (e) => { if (zoom <= 1) return; e.preventDefault(); setDragging(true); dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; };
    const onPointerMove = (e) => { if (!dragging) return; setPan({ x: Math.max(-maxPan, Math.min(maxPan, dragRef.current.px + (e.clientX - dragRef.current.x))), y: Math.max(-maxPan, Math.min(maxPan, dragRef.current.py + (e.clientY - dragRef.current.y))) }); };
    const onPointerUp = () => setDragging(false);

    const zoomIn = () => setZoom(z => Math.min(4, z + 0.5));
    const zoomOut = () => { const nz = Math.max(1, zoom - 0.5); setZoom(nz); if (nz === 1) setPan({ x: 0, y: 0 }); };
    const zoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="relative w-full max-w-4xl bg-gray-900 rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-white/10">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-white font-bold truncate">{camera.name}</h2>
                        {camera.location && (
                            <p className="text-gray-400 text-xs flex items-center gap-1 truncate">
                                <Icon.MapPin /> {camera.location}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-white ml-3">
                        <Icon.X />
                    </button>
                </div>

                {/* Video with zoom */}
                <div
                    className="relative aspect-video bg-black overflow-hidden"
                    style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
                    onWheel={onWheel}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                >
                    <video
                        ref={videoRef}
                        onPointerDown={onPointerDown}
                        className="w-full h-full object-contain"
                        style={{
                            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                            cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
                        }}
                        muted playsInline autoPlay
                    />
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center justify-center gap-2 p-3 border-t border-white/10">
                    <button onClick={zoomOut} disabled={zoom <= 1} className="p-2 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded-lg text-white transition-colors">
                        <Icon.ZoomOut />
                    </button>
                    <span className="text-white text-sm font-medium w-16 text-center">{Math.round(zoom * 100)}%</span>
                    <button onClick={zoomIn} disabled={zoom >= 4} className="p-2 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded-lg text-white transition-colors">
                        <Icon.ZoomIn />
                    </button>
                    {zoom > 1 && (
                        <button onClick={zoomReset} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors ml-2">
                            <Icon.Reset />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}


// Multi-View Panel
function MultiViewPanel({ selectedIds, allCameras, onRemove, onClear, onClose }) {
    const selected = selectedIds.map(id => allCameras.find(c => c.id === id)).filter(Boolean);
    const count = selected.length;

    const getLayoutClass = () => {
        if (count === 1) return 'grid-cols-1';
        if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
        return 'grid-cols-1 sm:grid-cols-2';
    };

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-white/10">
                <div className="flex items-center gap-2 text-white">
                    <Icon.Layout />
                    <span className="font-semibold text-sm">Multi-View</span>
                    <span className="text-xs text-gray-500">({count}/3)</span>
                </div>
                <div className="flex items-center gap-2">
                    {count > 0 && <button onClick={onClear} className="px-2.5 py-1 text-xs bg-white/10 hover:bg-red-500/30 text-white rounded-lg">Clear</button>}
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-white"><Icon.X /></button>
                </div>
            </div>

            <div className="flex-1 p-2 sm:p-3 overflow-auto">
                {count === 0 ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center px-4">
                            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3 text-gray-600"><Icon.Layout /></div>
                            <p className="text-gray-400 text-sm">No cameras selected</p>
                            <p className="text-gray-600 text-xs mt-1">Tap + on cameras to add</p>
                        </div>
                    </div>
                ) : (
                    <div className={`grid ${getLayoutClass()} gap-2 sm:gap-3 h-full auto-rows-fr`}>
                        {selected.map((cam, i) => (
                            <div key={cam.id} className={`rounded-xl overflow-hidden ${count === 3 && i === 2 ? 'sm:col-span-2' : ''}`}>
                                <VideoPlayer camera={cam} streams={cam.streams} isMultiView onRemove={() => onRemove(cam.id)} />
                            </div>
                        ))}
                    </div>
                )}
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
    const [popup, setPopup] = useState(null);
    const [cols, setCols] = useState(2);
    const [showMulti, setShowMulti] = useState(false);
    const [multiIds, setMultiIds] = useState([]);
    const [lastUpdate, setLastUpdate] = useState(null);

    const dark = theme === 'dark';

    const fetchCameras = useCallback(async () => {
        try {
            const res = await streamService.getAllActiveStreams();
            if (res.success && Array.isArray(res.data)) {
                setCameras(res.data);
                setLastUpdate(new Date());
                setError(null);
            } else setError('No cameras');
        } catch { setError('Connection failed'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchCameras(); }, [fetchCameras]);

    const addToMulti = (id) => { if (multiIds.length < 3 && !multiIds.includes(id)) setMultiIds([...multiIds, id]); };
    const removeFromMulti = (id) => setMultiIds(multiIds.filter(i => i !== id));

    const filtered = search.trim()
        ? cameras.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()) || c.location?.toLowerCase().includes(search.toLowerCase()))
        : cameras;

    const gridCls = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

    if (loading) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <div className="text-center">
                    <div className="w-10 h-10 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mx-auto mb-3" />
                    <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-600'}`}>Loading...</p>
                </div>
            </div>
        );
    }

    if (error && cameras.length === 0) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <div className="text-center px-6">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${dark ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-500'}`}>
                        <Icon.Camera />
                    </div>
                    <p className={`text-sm mb-4 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{error}</p>
                    <button onClick={fetchCameras} className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-xl">Retry</button>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* Header */}
            <header className={`sticky top-0 z-40 backdrop-blur-xl border-b ${dark ? 'bg-gray-950/80 border-white/5' : 'bg-white/80 border-gray-200'}`}>
                <div className="max-w-7xl mx-auto px-3 sm:px-6">
                    <div className="h-14 flex items-center justify-between gap-2 sm:gap-4">
                        {/* Logo */}
                        <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
                                <Icon.Camera />
                            </div>
                            <div className="hidden sm:block">
                                <h1 className={`text-sm font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>RAF NET</h1>
                                <p className={`text-[10px] ${dark ? 'text-gray-500' : 'text-gray-500'}`}>{cameras.length} cameras</p>
                            </div>
                        </div>

                        {/* Search */}
                        <div className="flex-1 max-w-[180px] sm:max-w-xs">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className={`w-full h-9 pl-8 pr-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                                        dark ? 'bg-white/5 text-white placeholder-gray-500 border border-white/10' : 'bg-gray-100 text-gray-900 placeholder-gray-500'
                                    }`}
                                />
                                <div className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}><Icon.Search /></div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-1 sm:gap-1.5">
                            {/* Multi-View */}
                            <button
                                onClick={() => setShowMulti(true)}
                                className={`h-9 px-2 sm:px-3 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all ${
                                    multiIds.length > 0 ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : dark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                <Icon.Layout />
                                <span className="hidden sm:inline">Multi</span>
                                {multiIds.length > 0 && <span className="w-5 h-5 rounded-full bg-white/20 text-xs flex items-center justify-center">{multiIds.length}</span>}
                            </button>

                            {/* Grid - desktop */}
                            <div className={`hidden sm:flex items-center rounded-xl p-0.5 ${dark ? 'bg-white/5' : 'bg-gray-100'}`}>
                                {[1, 2, 3].map(n => (
                                    <button key={n} onClick={() => setCols(n)} className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all ${cols === n ? 'bg-sky-500 text-white' : dark ? 'text-gray-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                                        {n}
                                    </button>
                                ))}
                            </div>

                            {/* Refresh */}
                            <button onClick={fetchCameras} className={`w-9 h-9 rounded-xl flex items-center justify-center ${dark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`} title={lastUpdate ? `Updated: ${lastUpdate.toLocaleTimeString()}` : 'Refresh'}>
                                <Icon.Refresh />
                            </button>

                            {/* Theme */}
                            <button onClick={toggleTheme} className={`w-9 h-9 rounded-xl flex items-center justify-center ${dark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                {dark ? <Icon.Sun /> : <Icon.Moon />}
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Stats */}
            <div className={`max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center gap-4 text-xs ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />{cameras.length} Online</span>
                {lastUpdate && <span className="flex items-center gap-1"><Icon.Clock />{lastUpdate.toLocaleTimeString()}</span>}
                {multiIds.length > 0 && <span className="text-sky-400">{multiIds.length} in Multi-View</span>}
            </div>

            {/* Content */}
            <main className="max-w-7xl mx-auto px-3 sm:px-6 pb-6">
                {filtered.length === 0 ? (
                    <div className="text-center py-16">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ${dark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-400'}`}><Icon.Camera /></div>
                        <p className={dark ? 'text-gray-500' : 'text-gray-600'}>{search ? 'No results' : 'No cameras'}</p>
                        {search && <button onClick={() => setSearch('')} className="mt-2 text-sm text-sky-500">Clear</button>}
                    </div>
                ) : (
                    <div className={`grid ${gridCls} gap-3 sm:gap-4`}>
                        {filtered.map((cam) => (
                            <CameraCard key={cam.id} camera={cam} inMulti={multiIds.includes(cam.id)} onClick={() => setPopup(cam)} onAddMulti={() => addToMulti(cam.id)} />
                        ))}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className={`py-4 text-center text-xs ${dark ? 'text-gray-700' : 'text-gray-400'}`}>© 2025 RAF NET</footer>

            {/* Modals */}
            {popup && <PopupModal camera={popup} onClose={() => setPopup(null)} />}
            {showMulti && <MultiViewPanel selectedIds={multiIds} allCameras={cameras} onRemove={removeFromMulti} onClear={() => setMultiIds([])} onClose={() => setShowMulti(false)} />}
        </div>
    );
}

export default LandingPage;
