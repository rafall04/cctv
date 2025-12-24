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
    Fullscreen: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>,
    ExitFS: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>,
    MapPin: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 5v14m-7-7h14"/></svg>,
    Minus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 12h14"/></svg>,
    Reset: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
    Layout: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
    Check: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7"/></svg>,
    Refresh: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
    Clock: () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    Play: () => <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>,
    Info: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>,
    Signal: () => <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>,
};


// Camera Card - NO video load, just thumbnail/info
const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti, dark }) {
    return (
        <div
            className={`relative rounded-2xl overflow-hidden cursor-pointer group transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl ${
                dark ? 'bg-gray-900 ring-1 ring-white/10 hover:ring-sky-500/50' : 'bg-white ring-1 ring-gray-200 hover:ring-sky-500/50 shadow-lg'
            }`}
            onClick={onClick}
        >
            {/* Thumbnail area */}
            <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center relative overflow-hidden">
                {/* Play button overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                    <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white group-hover:scale-110 group-hover:bg-sky-500/80 transition-all duration-300 shadow-xl">
                        <Icon.Play />
                    </div>
                </div>
                
                {/* Camera icon background */}
                <div className="text-gray-700/50">
                    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>

                {/* Status indicator */}
                <div className="absolute top-3 left-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-500/90 text-white shadow-lg">
                        <Icon.Signal />
                        ONLINE
                    </span>
                </div>

                {/* Add to multi-view */}
                <button
                    onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                    className={`absolute top-3 right-3 p-2 rounded-xl transition-all opacity-0 group-hover:opacity-100 shadow-lg ${
                        inMulti ? 'bg-emerald-500 text-white' : 'bg-black/50 hover:bg-sky-500 text-white backdrop-blur-sm'
                    }`}
                    title={inMulti ? 'Added to Multi-View' : 'Add to Multi-View'}
                >
                    {inMulti ? <Icon.Check /> : <Icon.Plus />}
                </button>
            </div>

            {/* Info section */}
            <div className={`p-4 ${dark ? 'bg-gray-900' : 'bg-white'}`}>
                <h3 className={`font-bold truncate ${dark ? 'text-white' : 'text-gray-900'}`}>
                    {camera.name}
                </h3>
                
                {camera.location && (
                    <p className={`text-sm flex items-center gap-1.5 mt-1 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                        <Icon.MapPin />
                        <span className="truncate">{camera.location}</span>
                    </p>
                )}
                
                {camera.description && (
                    <p className={`text-xs mt-2 line-clamp-2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {camera.description}
                    </p>
                )}

                {/* Quick info badges */}
                <div className="flex items-center gap-2 mt-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${dark ? 'bg-sky-500/20 text-sky-400' : 'bg-sky-100 text-sky-600'}`}>
                        HD Stream
                    </span>
                    {camera.area_name && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${dark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>
                            {camera.area_name}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});


// Video Popup Modal - loads video on open, proper sizing
function VideoPopup({ camera, onClose }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [isFS, setIsFS] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

    const url = camera.streams?.hls;

    // ESC to close
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && !isFS && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose, isFS]);

    // Load HLS
    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;

        setStatus('loading');
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
                    else setStatus('error');
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); setStatus('live'); });
            video.addEventListener('error', () => setStatus('error'));
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

    // Fullscreen toggle
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

    // Zoom/Pan
    const maxPan = 250 * (zoom - 1);
    const onWheel = (e) => { e.preventDefault(); setZoom(z => { const nz = Math.max(1, Math.min(5, z + (e.deltaY > 0 ? -0.25 : 0.25))); if (nz === 1) setPan({ x: 0, y: 0 }); return nz; }); };
    const onPointerDown = (e) => { if (zoom <= 1) return; setDragging(true); dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; };
    const onPointerMove = (e) => { if (!dragging) return; setPan({ x: Math.max(-maxPan, Math.min(maxPan, dragRef.current.px + (e.clientX - dragRef.current.x))), y: Math.max(-maxPan, Math.min(maxPan, dragRef.current.py + (e.clientY - dragRef.current.y))) }); };
    const onPointerUp = () => setDragging(false);

    const zoomIn = () => setZoom(z => Math.min(5, z + 0.5));
    const zoomOut = () => { const nz = Math.max(1, zoom - 0.5); setZoom(nz); if (nz === 1) setPan({ x: 0, y: 0 }); };
    const zoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/90 backdrop-blur-md" onClick={onClose}>
            <div
                ref={containerRef}
                className="relative w-full max-w-5xl bg-gray-950 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 flex flex-col max-h-[95vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-3 sm:p-4 border-b border-white/10 bg-gray-900/50">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                            <h2 className="text-white font-bold text-lg truncate">{camera.name}</h2>
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                status === 'live' ? 'bg-emerald-500/20 text-emerald-400' :
                                status === 'loading' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                                <Icon.Signal />
                                {status === 'live' ? 'LIVE' : status === 'loading' ? 'LOADING' : 'OFFLINE'}
                            </span>
                        </div>
                        {camera.location && (
                            <p className="text-gray-400 text-sm flex items-center gap-1.5 mt-1 truncate">
                                <Icon.MapPin /> {camera.location}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={toggleFS} className="p-2 hover:bg-white/10 rounded-xl text-white transition-colors" title="Fullscreen">
                            {isFS ? <Icon.ExitFS /> : <Icon.Fullscreen />}
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white transition-colors">
                            <Icon.X />
                        </button>
                    </div>
                </div>

                {/* Video Container - maintains aspect ratio */}
                <div
                    className="relative bg-black flex-1 min-h-0"
                    style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
                    onWheel={onWheel}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                >
                    <div className="absolute inset-0 flex items-center justify-center">
                        <video
                            ref={videoRef}
                            onPointerDown={onPointerDown}
                            className="max-w-full max-h-full w-auto h-auto"
                            style={{
                                transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                                cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
                            }}
                            muted playsInline autoPlay
                        />
                    </div>

                    {/* Loading overlay */}
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <div className="text-center">
                                <div className="w-10 h-10 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin mx-auto mb-3" />
                                <p className="text-white/60 text-sm">Connecting to stream...</p>
                            </div>
                        </div>
                    )}

                    {/* Error overlay */}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                            <div className="text-center">
                                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-3">
                                    <Icon.X />
                                </div>
                                <p className="text-red-400 font-medium">Stream Unavailable</p>
                                <p className="text-gray-500 text-sm mt-1">Please try again later</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer - Zoom controls & Info */}
                <div className="p-3 sm:p-4 border-t border-white/10 bg-gray-900/50">
                    <div className="flex items-center justify-between gap-4">
                        {/* Camera info */}
                        <div className="flex-1 min-w-0">
                            {camera.description && (
                                <p className="text-gray-400 text-sm line-clamp-1">{camera.description}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                                {camera.area_name && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
                                        {camera.area_name}
                                    </span>
                                )}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400">
                                    HD Stream
                                </span>
                            </div>
                        </div>

                        {/* Zoom controls */}
                        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
                            <button onClick={zoomOut} disabled={zoom <= 1} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white transition-colors">
                                <Icon.Minus />
                            </button>
                            <span className="text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                            <button onClick={zoomIn} disabled={zoom >= 5} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white transition-colors">
                                <Icon.Plus />
                            </button>
                            {zoom > 1 && (
                                <button onClick={zoomReset} className="p-2 hover:bg-white/10 rounded-lg text-white transition-colors ml-1">
                                    <Icon.Reset />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


// Multi-View Video Player (loads video)
const MultiViewPlayer = memo(function MultiViewPlayer({ camera, onRemove }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [isFS, setIsFS] = useState(false);

    const url = camera.streams?.hls;

    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;

        setStatus('loading');
        if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
            hlsRef.current = hls;
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setStatus('live'); });
            hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setStatus('error'); });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); setStatus('live'); });
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

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden group">
            <video ref={videoRef} className="w-full h-full" style={{ objectFit: isFS ? 'contain' : 'cover' }} muted playsInline autoPlay />

            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

            {/* Status */}
            <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${status === 'live' ? 'bg-emerald-500' : status === 'loading' ? 'bg-amber-500' : 'bg-red-500'}`}>
                    <Icon.Signal />
                    {status === 'live' ? 'LIVE' : status === 'loading' ? '...' : 'OFF'}
                </span>
            </div>

            {/* Remove */}
            <button onClick={onRemove} className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-500 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all">
                <Icon.X />
            </button>

            {/* Bottom */}
            <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-end justify-between">
                    <div className="flex-1 min-w-0">
                        <h3 className="text-white text-xs font-semibold truncate">{camera.name}</h3>
                    </div>
                    <button onClick={toggleFS} className="p-1.5 bg-white/10 hover:bg-white/25 rounded-lg text-white">
                        {isFS ? <Icon.ExitFS /> : <Icon.Fullscreen />}
                    </button>
                </div>
            </div>

            {status === 'loading' && <div className="absolute inset-0 flex items-center justify-center bg-black/40"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
        </div>
    );
});

// Multi-View Panel
function MultiViewPanel({ selectedIds, allCameras, onRemove, onClear, onClose }) {
    const selected = selectedIds.map(id => allCameras.find(c => c.id === id)).filter(Boolean);
    const count = selected.length;

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose]);

    const layoutClass = count === 1 ? 'grid-cols-1' : count === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2';

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-white/10">
                <div className="flex items-center gap-2 text-white">
                    <Icon.Layout />
                    <span className="font-semibold">Multi-View</span>
                    <span className="text-xs text-gray-500">({count}/3)</span>
                </div>
                <div className="flex items-center gap-2">
                    {count > 0 && <button onClick={onClear} className="px-3 py-1.5 text-xs bg-white/10 hover:bg-red-500/30 text-white rounded-lg">Clear All</button>}
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-white"><Icon.X /></button>
                </div>
            </div>

            <div className="flex-1 p-2 sm:p-3 overflow-auto">
                {count === 0 ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4 text-gray-600"><Icon.Layout /></div>
                            <p className="text-gray-400">No cameras selected</p>
                            <p className="text-gray-600 text-sm mt-1">Tap + on camera cards to add</p>
                        </div>
                    </div>
                ) : (
                    <div className={`grid ${layoutClass} gap-2 sm:gap-3 h-full auto-rows-fr`}>
                        {selected.map((cam, i) => (
                            <div key={cam.id} className={`rounded-xl overflow-hidden ${count === 3 && i === 2 ? 'sm:col-span-2' : ''}`}>
                                <MultiViewPlayer camera={cam} onRemove={() => onRemove(cam.id)} />
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
            } else setError('No cameras available');
        } catch { setError('Connection failed'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchCameras(); }, [fetchCameras]);

    const addToMulti = (id) => { if (multiIds.length < 3 && !multiIds.includes(id)) setMultiIds([...multiIds, id]); };
    const removeFromMulti = (id) => setMultiIds(multiIds.filter(i => i !== id));

    const filtered = search.trim()
        ? cameras.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()) || c.location?.toLowerCase().includes(search.toLowerCase()) || c.description?.toLowerCase().includes(search.toLowerCase()))
        : cameras;

    const gridCls = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

    if (loading) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <div className="text-center">
                    <div className="w-12 h-12 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-600'}`}>Loading cameras...</p>
                </div>
            </div>
        );
    }

    if (error && cameras.length === 0) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <div className="text-center px-6">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${dark ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-500'}`}>
                        <Icon.Camera />
                    </div>
                    <p className={`font-medium mb-1 ${dark ? 'text-white' : 'text-gray-900'}`}>Connection Error</p>
                    <p className={`text-sm mb-4 ${dark ? 'text-gray-500' : 'text-gray-600'}`}>{error}</p>
                    <button onClick={fetchCameras} className="px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl transition-colors">
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* Header */}
            <header className={`sticky top-0 z-40 backdrop-blur-xl border-b ${dark ? 'bg-gray-950/80 border-white/5' : 'bg-white/80 border-gray-200'}`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="h-16 flex items-center justify-between gap-3">
                        {/* Logo */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/25">
                                <Icon.Camera />
                            </div>
                            <div>
                                <h1 className={`text-base font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>RAF NET CCTV</h1>
                                <p className={`text-[11px] ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                                    {cameras.length} camera{cameras.length !== 1 ? 's' : ''} available
                                </p>
                            </div>
                        </div>

                        {/* Search */}
                        <div className="flex-1 max-w-xs hidden sm:block">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search cameras..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className={`w-full h-10 pl-10 pr-4 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all ${
                                        dark ? 'bg-white/5 text-white placeholder-gray-500 border border-white/10 focus:bg-white/10' : 'bg-gray-100 text-gray-900 placeholder-gray-500 focus:bg-white border border-transparent focus:border-gray-200'
                                    }`}
                                />
                                <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}><Icon.Search /></div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-2">
                            {/* Multi-View */}
                            <button
                                onClick={() => setShowMulti(true)}
                                className={`h-10 px-3 rounded-xl text-sm font-medium flex items-center gap-2 transition-all ${
                                    multiIds.length > 0 ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : dark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                <Icon.Layout />
                                <span className="hidden sm:inline">Multi-View</span>
                                {multiIds.length > 0 && <span className="w-5 h-5 rounded-full bg-white/20 text-xs flex items-center justify-center">{multiIds.length}</span>}
                            </button>

                            {/* Grid - desktop */}
                            <div className={`hidden md:flex items-center rounded-xl p-1 ${dark ? 'bg-white/5' : 'bg-gray-100'}`}>
                                {[1, 2, 3].map(n => (
                                    <button key={n} onClick={() => setCols(n)} className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${cols === n ? 'bg-sky-500 text-white' : dark ? 'text-gray-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                                        {n}
                                    </button>
                                ))}
                            </div>

                            {/* Refresh */}
                            <button onClick={fetchCameras} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${dark ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`} title={lastUpdate ? `Last update: ${lastUpdate.toLocaleTimeString()}` : 'Refresh'}>
                                <Icon.Refresh />
                            </button>

                            {/* Theme */}
                            <button onClick={toggleTheme} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${dark ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                {dark ? <Icon.Sun /> : <Icon.Moon />}
                            </button>
                        </div>
                    </div>

                    {/* Mobile search */}
                    <div className="pb-3 sm:hidden">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search cameras..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className={`w-full h-10 pl-10 pr-4 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                                    dark ? 'bg-white/5 text-white placeholder-gray-500 border border-white/10' : 'bg-gray-100 text-gray-900 placeholder-gray-500'
                                }`}
                            />
                            <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}><Icon.Search /></div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Stats */}
            <div className={`max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    {cameras.length} Online
                </span>
                {lastUpdate && (
                    <span className="flex items-center gap-1.5">
                        <Icon.Clock />
                        Updated {lastUpdate.toLocaleTimeString()}
                    </span>
                )}
                {multiIds.length > 0 && (
                    <span className="text-sky-400 font-medium">{multiIds.length} camera{multiIds.length > 1 ? 's' : ''} in Multi-View</span>
                )}
            </div>

            {/* Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
                {filtered.length === 0 ? (
                    <div className="text-center py-20">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${dark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-400'}`}>
                            <Icon.Camera />
                        </div>
                        <p className={`font-medium ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                            {search ? 'No cameras found' : 'No cameras available'}
                        </p>
                        {search && <button onClick={() => setSearch('')} className="mt-3 text-sm text-sky-500 hover:text-sky-400">Clear search</button>}
                    </div>
                ) : (
                    <div className={`grid ${gridCls} gap-4 sm:gap-6`}>
                        {filtered.map((cam) => (
                            <CameraCard
                                key={cam.id}
                                camera={cam}
                                dark={dark}
                                inMulti={multiIds.includes(cam.id)}
                                onClick={() => setPopup(cam)}
                                onAddMulti={() => addToMulti(cam.id)}
                            />
                        ))}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className={`py-6 text-center text-xs ${dark ? 'text-gray-700' : 'text-gray-400'}`}>
                © 2025 RAF NET CCTV System
            </footer>

            {/* Modals */}
            {popup && <VideoPopup camera={popup} onClose={() => setPopup(null)} />}
            {showMulti && <MultiViewPanel selectedIds={multiIds} allCameras={cameras} onRemove={removeFromMulti} onClear={() => setMultiIds([])} onClose={() => setShowMulti(false)} />}
        </div>
    );
}

export default LandingPage;
