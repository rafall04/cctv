import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// Lightweight SVG Icons - inline for performance
const Icon = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    Camera: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>,
    Search: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
    X: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>,
    Expand: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>,
    Shrink: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>,
    MapPin: () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 5v14m-7-7h14"/></svg>,
    Minus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 12h14"/></svg>,
    RotateCcw: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
    Grid2: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    Signal: () => <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>,
};


// Optimized Video Player - minimal re-renders
const VideoPlayer = memo(function VideoPlayer({ camera, streams, expanded, onToggleExpand }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const containerRef = useRef(null);
    const [status, setStatus] = useState('connecting');
    const [fullscreen, setFullscreen] = useState(false);
    
    // Zoom/Pan for expanded view
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

    const url = streams?.hls;

    // HLS Setup
    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;

        const init = () => {
            setStatus('connecting');
            if (Hls.isSupported()) {
                hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
                hlsRef.current = hls;
                hls.loadSource(url);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().catch(() => {});
                    setStatus('live');
                });
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
        };
        init();
        return () => { if (hls) { hls.destroy(); hlsRef.current = null; } };
    }, [url]);

    // Fullscreen
    useEffect(() => {
        const onChange = () => setFullscreen(!!document.fullscreenElement || !!document.webkitFullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('webkitfullscreenchange', onChange);
        return () => {
            document.removeEventListener('fullscreenchange', onChange);
            document.removeEventListener('webkitfullscreenchange', onChange);
        };
    }, []);

    const toggleFS = async (e) => {
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

    // Zoom handlers (only when expanded)
    const canZoom = expanded || fullscreen;
    const maxPan = 200 * (zoom - 1);

    const onWheel = (e) => {
        if (!canZoom) return;
        e.preventDefault();
        setZoom(z => {
            const nz = Math.max(1, Math.min(4, z + (e.deltaY > 0 ? -0.2 : 0.2)));
            if (nz === 1) setPan({ x: 0, y: 0 });
            return nz;
        });
    };

    const onPointerDown = (e) => {
        if (!canZoom || zoom <= 1) return;
        e.preventDefault();
        setDragging(true);
        dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        e.target.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragRef.current.x;
        const dy = e.clientY - dragRef.current.y;
        setPan({
            x: Math.max(-maxPan, Math.min(maxPan, dragRef.current.px + dx)),
            y: Math.max(-maxPan, Math.min(maxPan, dragRef.current.py + dy)),
        });
    };

    const onPointerUp = (e) => {
        setDragging(false);
        e.target.releasePointerCapture?.(e.pointerId);
    };

    const zoomIn = (e) => { e?.stopPropagation(); setZoom(z => Math.min(4, z + 0.5)); };
    const zoomOut = (e) => { e?.stopPropagation(); setZoom(z => { const nz = Math.max(1, z - 0.5); if (nz === 1) setPan({ x: 0, y: 0 }); return nz; }); };
    const zoomReset = (e) => { e?.stopPropagation(); setZoom(1); setPan({ x: 0, y: 0 }); };

    const statusColor = status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-red-500';
    const statusText = status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE';

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full bg-black overflow-hidden ${expanded ? 'rounded-none' : 'rounded-2xl'} group`}
            style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
            onWheel={onWheel}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
        >
            {/* Video */}
            <video
                ref={videoRef}
                onPointerDown={onPointerDown}
                className="w-full h-full"
                style={{
                    objectFit: expanded || fullscreen ? 'contain' : 'cover',
                    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                    cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
                    willChange: dragging ? 'transform' : 'auto',
                }}
                muted
                playsInline
                autoPlay
            />

            {/* Gradient Overlay */}
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            {/* Top Bar - Status */}
            <div className="absolute top-0 left-0 right-0 p-3 flex items-start justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="flex items-center gap-2">
                    <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold tracking-wide text-white ${statusColor}/90 backdrop-blur-sm`}>
                        <Icon.Signal />
                        {statusText}
                    </span>
                </div>
            </div>

            {/* Bottom Bar - Info & Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="flex items-end justify-between gap-3">
                    {/* Camera Info */}
                    <div className="flex-1 min-w-0">
                        <h3 className="text-white font-semibold text-sm truncate drop-shadow-lg">{camera.name}</h3>
                        {camera.location && (
                            <p className="text-white/70 text-xs flex items-center gap-1 mt-0.5 truncate">
                                <Icon.MapPin />
                                <span className="truncate">{camera.location}</span>
                            </p>
                        )}
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-1.5">
                        {/* Zoom Controls - only in expanded/fullscreen */}
                        {canZoom && (
                            <div className="flex items-center gap-0.5 bg-black/50 backdrop-blur-sm rounded-lg p-0.5 mr-1">
                                <button onClick={zoomOut} className="p-1.5 hover:bg-white/20 rounded-md text-white/80 hover:text-white transition-colors"><Icon.Minus /></button>
                                <span className="text-[10px] text-white/70 w-8 text-center font-medium">{Math.round(zoom * 100)}%</span>
                                <button onClick={zoomIn} className="p-1.5 hover:bg-white/20 rounded-md text-white/80 hover:text-white transition-colors"><Icon.Plus /></button>
                                {zoom > 1 && <button onClick={zoomReset} className="p-1.5 hover:bg-white/20 rounded-md text-white/80 hover:text-white transition-colors ml-0.5"><Icon.RotateCcw /></button>}
                            </div>
                        )}

                        {/* Expand/Fullscreen */}
                        {!expanded && (
                            <button
                                onClick={onToggleExpand}
                                className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-lg text-white transition-all duration-200 hover:scale-105"
                            >
                                <Icon.Expand />
                            </button>
                        )}
                        <button
                            onClick={toggleFS}
                            className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-lg text-white transition-all duration-200 hover:scale-105"
                        >
                            {fullscreen ? <Icon.Shrink /> : <Icon.Expand />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Loading State */}
            {status === 'connecting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        <span className="text-white/60 text-xs font-medium">Connecting...</span>
                    </div>
                </div>
            )}

            {/* Error State */}
            {status === 'offline' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <div className="text-center">
                        <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-2">
                            <Icon.Camera />
                        </div>
                        <p className="text-white/60 text-xs">Stream Unavailable</p>
                    </div>
                </div>
            )}
        </div>
    );
});


// Camera Card - optimized with lazy loading
const CameraCard = memo(function CameraCard({ camera, onExpand, index }) {
    const [visible, setVisible] = useState(false);
    const ref = useRef(null);

    // Intersection Observer for lazy loading
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
            { rootMargin: '100px', threshold: 0.1 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            className="aspect-video rounded-2xl overflow-hidden cursor-pointer bg-gray-900 shadow-xl ring-1 ring-white/5 hover:ring-white/20 transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] transform-gpu"
            onClick={onExpand}
            style={{ animationDelay: `${index * 50}ms` }}
        >
            {visible ? (
                <VideoPlayer camera={camera} streams={camera.streams} expanded={false} onToggleExpand={onExpand} />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-900">
                    <div className="text-gray-600 animate-pulse"><Icon.Camera /></div>
                </div>
            )}
        </div>
    );
});

// Expanded Modal - fullscreen experience
function ExpandedModal({ camera, onClose }) {
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm animate-fadeIn">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
                <div className="text-white">
                    <h2 className="text-lg font-bold">{camera.name}</h2>
                    {camera.location && (
                        <p className="text-sm text-white/60 flex items-center gap-1.5 mt-0.5">
                            <Icon.MapPin /> {camera.location}
                        </p>
                    )}
                </div>
                <button
                    onClick={onClose}
                    className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all duration-200 hover:rotate-90"
                >
                    <Icon.X />
                </button>
            </div>

            {/* Video */}
            <div className="absolute inset-0 pt-16 pb-4 px-4">
                <VideoPlayer camera={camera} streams={camera.streams} expanded={true} />
            </div>
        </div>
    );
}


// Main Landing Page
function LandingPage() {
    const { theme, toggleTheme } = useTheme();
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState(null);
    const [cols, setCols] = useState(2);

    const dark = theme === 'dark';

    // Fetch cameras
    useEffect(() => {
        (async () => {
            try {
                const res = await streamService.getAllActiveStreams();
                if (res.success && Array.isArray(res.data)) setCameras(res.data);
                else setError('No cameras available');
            } catch { setError('Connection failed'); }
            finally { setLoading(false); }
        })();
    }, []);

    // Filter
    const filtered = search.trim()
        ? cameras.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()) || c.location?.toLowerCase().includes(search.toLowerCase()))
        : cameras;

    const gridCls = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

    // Loading
    if (loading) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <div className="text-center">
                    <div className="relative w-12 h-12 mx-auto mb-4">
                        <div className="absolute inset-0 border-2 border-sky-500/20 rounded-full" />
                        <div className="absolute inset-0 border-2 border-transparent border-t-sky-500 rounded-full animate-spin" />
                    </div>
                    <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-600'}`}>Loading cameras...</p>
                </div>
            </div>
        );
    }

    // Error
    if (error) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <div className="text-center px-6">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${dark ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-500'}`}>
                        <Icon.Camera />
                    </div>
                    <p className={`font-medium mb-1 ${dark ? 'text-white' : 'text-gray-900'}`}>Oops!</p>
                    <p className={`text-sm mb-4 ${dark ? 'text-gray-500' : 'text-gray-600'}`}>{error}</p>
                    <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl transition-colors">
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen transition-colors duration-300 ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* Header */}
            <header className={`sticky top-0 z-40 backdrop-blur-xl border-b transition-colors duration-300 ${dark ? 'bg-gray-950/80 border-white/5' : 'bg-white/80 border-gray-200'}`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="h-16 flex items-center justify-between gap-4">
                        {/* Logo */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/25">
                                <Icon.Camera />
                            </div>
                            <div className="hidden xs:block">
                                <h1 className={`text-base font-bold tracking-tight ${dark ? 'text-white' : 'text-gray-900'}`}>RAF NET</h1>
                                <p className={`text-[10px] font-medium uppercase tracking-wider ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                                    {cameras.length} Camera{cameras.length !== 1 ? 's' : ''} Online
                                </p>
                            </div>
                        </div>

                        {/* Search - Desktop */}
                        <div className="flex-1 max-w-sm hidden sm:block">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search cameras..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className={`w-full h-10 pl-10 pr-4 rounded-xl text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                                        dark ? 'bg-white/5 text-white placeholder-gray-500 border border-white/10 focus:bg-white/10' : 'bg-gray-100 text-gray-900 placeholder-gray-500 border border-transparent focus:bg-white focus:border-gray-200'
                                    }`}
                                />
                                <div className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                                    <Icon.Search />
                                </div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-2">
                            {/* Grid Toggle */}
                            <div className={`hidden sm:flex items-center rounded-xl p-1 ${dark ? 'bg-white/5' : 'bg-gray-100'}`}>
                                {[1, 2, 3].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setCols(n)}
                                        className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all duration-200 ${
                                            cols === n
                                                ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25'
                                                : dark ? 'text-gray-500 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200'
                                        }`}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>

                            {/* Theme Toggle */}
                            <button
                                onClick={toggleTheme}
                                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                                    dark ? 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:text-gray-900 hover:bg-gray-200'
                                }`}
                            >
                                {dark ? <Icon.Sun /> : <Icon.Moon />}
                            </button>
                        </div>
                    </div>

                    {/* Search - Mobile */}
                    <div className="pb-3 sm:hidden">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search cameras..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className={`w-full h-10 pl-10 pr-4 rounded-xl text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                                    dark ? 'bg-white/5 text-white placeholder-gray-500 border border-white/10' : 'bg-gray-100 text-gray-900 placeholder-gray-500 border border-transparent'
                                }`}
                            />
                            <div className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                                <Icon.Search />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                {filtered.length === 0 ? (
                    <div className="text-center py-20">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${dark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-400'}`}>
                            <Icon.Camera />
                        </div>
                        <p className={`font-medium ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                            {search ? 'No cameras found' : 'No cameras available'}
                        </p>
                        {search && (
                            <button onClick={() => setSearch('')} className="mt-3 text-sm text-sky-500 hover:text-sky-400">
                                Clear search
                            </button>
                        )}
                    </div>
                ) : (
                    <div className={`grid ${gridCls} gap-4 sm:gap-5`}>
                        {filtered.map((cam, i) => (
                            <CameraCard key={cam.id} camera={cam} index={i} onExpand={() => setExpanded(cam)} />
                        ))}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className={`py-6 text-center ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
                <p className="text-xs">© 2025 RAF NET CCTV System</p>
            </footer>

            {/* Expanded Modal */}
            {expanded && <ExpandedModal camera={expanded} onClose={() => setExpanded(null)} />}

            {/* Global Styles */}
            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
            `}</style>
        </div>
    );
}

export default LandingPage;
