import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { Link } from 'react-router-dom';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// ============================================
// ICONS - Lightweight SVG Icons
// ============================================
const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    Camera: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>,
    Shield: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>,
    Zap: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>,
    Eye: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>,
    Lock: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>,
    X: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>,
    Menu: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 6h16M4 12h16M4 18h16"/></svg>,
    Play: () => <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>,
    MapPin: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 5v14m-7-7h14"/></svg>,
    Check: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7"/></svg>,
    Fullscreen: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>,
    ExitFS: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>,
    Minus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 12h14"/></svg>,
    Reset: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
    Layout: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
    Image: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
    ChevronDown: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7"/></svg>,
    ArrowRight: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>,
};

// ============================================
// SKELETON LOADER
// ============================================
const Skeleton = ({ className }) => (
    <div className={`animate-pulse bg-gray-300 dark:bg-gray-700 rounded-xl ${className}`} />
);

const CameraSkeleton = () => (
    <div className="rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg">
        <Skeleton className="aspect-video" />
        <div className="p-4 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-12 rounded-full" />
            </div>
        </div>
    </div>
);

// ============================================
// CAMERA CARD - Optimized, no video preload
// ============================================
const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti }) {
    return (
        <div
            onClick={onClick}
            className="group relative rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg hover:shadow-xl cursor-pointer transition-all duration-300 hover:-translate-y-1 active:scale-[0.98] ring-1 ring-gray-200 dark:ring-gray-800 hover:ring-sky-500/50"
        >
            {/* Thumbnail Area */}
            <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 relative overflow-hidden">
                {/* Camera Icon */}
                <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-700 group-hover:scale-110 transition-transform duration-500">
                    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>

                {/* Play Overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all duration-300">
                    <div className="w-14 h-14 rounded-full bg-white/90 dark:bg-gray-900/90 flex items-center justify-center text-sky-500 opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300 shadow-xl">
                        <Icons.Play />
                    </div>
                </div>

                {/* Status Badge */}
                <div className="absolute top-3 left-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold shadow-lg">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        LIVE
                    </span>
                </div>

                {/* Multi-view Button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                    className={`absolute top-3 right-3 p-2 rounded-xl transition-all opacity-0 group-hover:opacity-100 shadow-lg ${
                        inMulti 
                            ? 'bg-emerald-500 text-white' 
                            : 'bg-white/90 dark:bg-gray-900/90 text-gray-600 dark:text-gray-300 hover:bg-sky-500 hover:text-white'
                    }`}
                    title={inMulti ? 'In Multi-View' : 'Add to Multi-View'}
                >
                    {inMulti ? <Icons.Check /> : <Icons.Plus />}
                </button>
            </div>

            {/* Info */}
            <div className="p-4">
                <h3 className="font-bold text-gray-900 dark:text-white truncate">{camera.name}</h3>
                {camera.location && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mt-1">
                        <Icons.MapPin />
                        <span className="truncate">{camera.location}</span>
                    </p>
                )}
                {camera.description && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 line-clamp-2">{camera.description}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400">
                        HD Stream
                    </span>
                    {camera.area_name && (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">
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
const VideoPlayer = memo(function VideoPlayer({ camera, compact = false }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('idle');
    const [isVisible, setIsVisible] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const maxRetries = 3;
    const url = camera.streams?.hls;

    // Intersection Observer
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

    // HLS Setup
    useEffect(() => {
        if (!isVisible || !url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        setStatus('connecting');

        if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 10 });
            hlsRef.current = hls;
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setStatus('live'); setRetryCount(0); });
            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCount < maxRetries) {
                        setStatus('reconnecting');
                        setTimeout(() => { hls?.startLoad(); setRetryCount(r => r + 1); }, 2000 * (retryCount + 1));
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls?.recoverMediaError(); }
                    else { setStatus('error'); }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); setStatus('live'); });
            video.addEventListener('error', () => setStatus('error'));
        }
        return () => { if (hls) { hls.destroy(); hlsRef.current = null; } };
    }, [isVisible, url, retryCount]);

    const toggleFS = async () => {
        const el = containerRef.current;
        try {
            if (!document.fullscreenElement) await el?.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch {}
    };

    const takeSnapshot = () => {
        if (!videoRef.current || status !== 'live') return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        const link = document.createElement('a');
        link.download = `${camera.name}-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden group" onDoubleClick={toggleFS}>
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
            
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

            {/* Status Badge */}
            <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold text-white shadow-lg ${
                    status === 'live' ? 'bg-emerald-500' : status === 'connecting' || status === 'reconnecting' ? 'bg-amber-500' : 'bg-red-500'
                }`}>
                    <span className={`w-1.5 h-1.5 rounded-full bg-white ${status === 'live' ? 'animate-pulse' : ''}`} />
                    {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : status === 'reconnecting' ? `RETRY ${retryCount}/${maxRetries}` : 'OFFLINE'}
                </span>
            </div>

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-end justify-between">
                    <div className="flex-1 min-w-0">
                        <h3 className={`text-white font-semibold truncate ${compact ? 'text-xs' : 'text-sm'}`}>{camera.name}</h3>
                        {!compact && camera.location && <p className="text-white/60 text-[10px] flex items-center gap-1 truncate"><Icons.MapPin />{camera.location}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                        {status === 'live' && <button onClick={takeSnapshot} className="p-1.5 bg-white/10 hover:bg-white/25 rounded-lg text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-1.5 bg-white/10 hover:bg-white/25 rounded-lg text-white"><Icons.Fullscreen /></button>
                    </div>
                </div>
            </div>

            {/* Loading */}
            {(status === 'connecting' || status === 'reconnecting') && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin" />
                </div>
            )}

            {/* Error */}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                    <div className="text-center">
                        <p className="text-white/80 text-sm mb-2">Connection Failed</p>
                        <button onClick={() => { setRetryCount(0); setStatus('connecting'); }} className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-xs rounded-lg">Retry</button>
                    </div>
                </div>
            )}

            {/* Not Visible Placeholder */}
            {!isVisible && <div className="absolute inset-0 flex items-center justify-center bg-gray-900"><div className="text-gray-700"><Icons.Camera /></div></div>}
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

    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;

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

    const toggleFS = async () => {
        const el = containerRef.current;
        try {
            if (!document.fullscreenElement) await el?.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch {}
    };

    const takeSnapshot = () => {
        if (!videoRef.current || status !== 'live') return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        const link = document.createElement('a');
        link.download = `${camera.name}-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const maxPan = 200 * (zoom - 1);
    const onWheel = (e) => { e.preventDefault(); setZoom(z => { const nz = Math.max(1, Math.min(4, z + (e.deltaY > 0 ? -0.25 : 0.25))); if (nz === 1) setPan({ x: 0, y: 0 }); return nz; }); };
    const onPointerDown = (e) => { if (zoom <= 1) return; setDragging(true); dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; };
    const onPointerMove = (e) => { if (!dragging) return; setPan({ x: Math.max(-maxPan, Math.min(maxPan, dragRef.current.px + (e.clientX - dragRef.current.x))), y: Math.max(-maxPan, Math.min(maxPan, dragRef.current.py + (e.clientY - dragRef.current.y))) }); };
    const onPointerUp = () => setDragging(false);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" onClick={onClose}>
            <div ref={containerRef} className="relative w-full max-w-5xl bg-gray-950 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gray-900/50">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-white font-bold text-lg truncate">{camera.name}</h2>
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${status === 'live' ? 'bg-emerald-500/20 text-emerald-400' : status === 'connecting' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-emerald-400 animate-pulse' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
                                {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
                            </span>
                        </div>
                        {camera.location && <p className="text-gray-400 text-sm flex items-center gap-1.5 mt-1 truncate"><Icons.MapPin /> {camera.location}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                        {status === 'live' && <button onClick={takeSnapshot} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.Fullscreen /></button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.X /></button>
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
                <div className="p-4 border-t border-white/10 bg-gray-900/50">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            {camera.description && <p className="text-gray-400 text-sm line-clamp-1">{camera.description}</p>}
                            <div className="flex items-center gap-2 mt-1">
                                {camera.area_name && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">{camera.area_name}</span>}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400">HD Stream</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
                            <button onClick={() => { const nz = Math.max(1, zoom - 0.5); setZoom(nz); if (nz === 1) setPan({ x: 0, y: 0 }); }} disabled={zoom <= 1} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icons.Minus /></button>
                            <span className="text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                            <button onClick={() => setZoom(z => Math.min(4, z + 0.5))} disabled={zoom >= 4} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icons.Plus /></button>
                            {zoom > 1 && <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-2 hover:bg-white/10 rounded-lg text-white ml-1"><Icons.Reset /></button>}
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

    return (
        <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gray-900/50">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400"><Icons.Layout /></div>
                    <div>
                        <h2 className="text-white font-bold">Multi-View</h2>
                        <p className="text-gray-500 text-xs">{count} of 3 cameras</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {count > 0 && <button onClick={onClear} className="px-3 py-2 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl">Clear All</button>}
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.X /></button>
                </div>
            </div>
            <div className="flex-1 p-4 overflow-auto">
                {count === 0 ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center max-w-xs">
                            <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4 text-gray-600"><Icons.Layout /></div>
                            <p className="text-white font-medium mb-2">No Cameras Selected</p>
                            <p className="text-gray-500 text-sm">Tap the + button on camera cards to add them (max 3)</p>
                        </div>
                    </div>
                ) : (
                    <div className={`grid gap-4 h-full auto-rows-fr ${count === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                        {selected.map((cam, i) => (
                            <div key={cam.id} className={`relative rounded-xl overflow-hidden bg-black ${count === 3 && i === 2 ? 'sm:col-span-2' : ''}`}>
                                <VideoPlayer camera={cam} compact />
                                <button onClick={() => onRemove(cam.id)} className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-red-500 rounded-lg text-white opacity-0 hover:opacity-100 transition-all z-10"><Icons.X /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================
// HERO SECTION
// ============================================
function HeroSection({ onScrollToCameras }) {
    const { dark } = useTheme();
    return (
        <section className="relative min-h-[70vh] flex items-center justify-center overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-purple-500/10" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(56,189,248,0.15),transparent_50%)]" />
            
            <div className="relative z-10 max-w-4xl mx-auto px-4 text-center py-20">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-500 text-sm font-medium mb-6">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Live Monitoring Active
                </div>
                
                <h1 className={`text-4xl sm:text-5xl md:text-6xl font-black tracking-tight mb-6 ${dark ? 'text-white' : 'text-gray-900'}`}>
                    RAF NET <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-purple-500">CCTV Hub</span>
                </h1>
                
                <p className={`text-lg sm:text-xl max-w-2xl mx-auto mb-8 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                    Secure gateway untuk monitoring CCTV real-time. Akses stream publik tanpa mengekspos IP privat kamera Anda.
                </p>
                
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <button onClick={onScrollToCameras} className="px-8 py-4 bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white font-bold rounded-2xl shadow-lg shadow-sky-500/25 transition-all hover:-translate-y-0.5 flex items-center gap-2">
                        Lihat Kamera <Icons.ArrowRight />
                    </button>
                    <Link to="/admin/login" className={`px-8 py-4 font-bold rounded-2xl transition-all hover:-translate-y-0.5 ${dark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>
                        Admin Panel
                    </Link>
                </div>
            </div>
        </section>
    );
}

// ============================================
// FEATURES SECTION
// ============================================
function FeaturesSection() {
    const { dark } = useTheme();
    const features = [
        { icon: <Icons.Shield />, title: 'Secure Gateway', desc: 'IP privat kamera tidak pernah terekspos ke publik. Semua stream diproses melalui server aman.' },
        { icon: <Icons.Zap />, title: 'Low Latency', desc: 'Streaming WebRTC dan HLS dengan latensi minimal untuk monitoring real-time.' },
        { icon: <Icons.Lock />, title: 'Privacy Protection', desc: 'RTSP URL tersimpan di server, tidak pernah dikirim ke browser pengguna.' },
        { icon: <Icons.Eye />, title: 'Public Access', desc: 'Siapapun dapat melihat stream tanpa login. Admin panel terpisah untuk manajemen.' },
    ];

    return (
        <section className={`py-20 ${dark ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
            <div className="max-w-6xl mx-auto px-4">
                <div className="text-center mb-12">
                    <h2 className={`text-3xl font-black mb-4 ${dark ? 'text-white' : 'text-gray-900'}`}>Fitur Utama</h2>
                    <p className={`max-w-2xl mx-auto ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                        Didesain untuk keamanan dan kemudahan akses
                    </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {features.map((f, i) => (
                        <div key={i} className={`p-6 rounded-2xl transition-all hover:-translate-y-1 ${dark ? 'bg-gray-800/50 hover:bg-gray-800' : 'bg-white hover:shadow-lg'}`}>
                            <div className="w-12 h-12 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-500 mb-4">{f.icon}</div>
                            <h3 className={`font-bold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>{f.title}</h3>
                            <p className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{f.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

// ============================================
// FAQ SECTION
// ============================================
function FAQSection() {
    const { dark } = useTheme();
    const [openIndex, setOpenIndex] = useState(null);
    const faqs = [
        { q: 'Apakah saya perlu login untuk melihat CCTV?', a: 'Tidak. Semua stream CCTV yang aktif dapat dilihat publik tanpa perlu login. Login hanya diperlukan untuk admin yang mengelola kamera.' },
        { q: 'Apakah IP kamera saya aman?', a: 'Ya. URL RTSP kamera Anda tersimpan di server dan tidak pernah dikirim ke browser pengguna. Pengguna hanya menerima stream yang sudah diproses.' },
        { q: 'Bagaimana cara menambah kamera baru?', a: 'Login ke Admin Panel, masuk ke menu Cameras, lalu klik "Register New Camera". Masukkan nama dan URL RTSP kamera Anda.' },
        { q: 'Codec apa yang didukung?', a: 'Untuk kompatibilitas browser terbaik, gunakan H.264 dari kamera Anda. H.265 mungkin tidak didukung di semua browser.' },
    ];

    return (
        <section className="py-20">
            <div className="max-w-3xl mx-auto px-4">
                <div className="text-center mb-12">
                    <h2 className={`text-3xl font-black mb-4 ${dark ? 'text-white' : 'text-gray-900'}`}>FAQ</h2>
                    <p className={dark ? 'text-gray-400' : 'text-gray-600'}>Pertanyaan yang sering diajukan</p>
                </div>
                <div className="space-y-4">
                    {faqs.map((faq, i) => (
                        <div key={i} className={`rounded-2xl overflow-hidden ${dark ? 'bg-gray-800/50' : 'bg-white shadow-sm'}`}>
                            <button onClick={() => setOpenIndex(openIndex === i ? null : i)} className={`w-full p-5 text-left flex items-center justify-between gap-4 ${dark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'}`}>
                                <span className={`font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>{faq.q}</span>
                                <span className={`transition-transform ${openIndex === i ? 'rotate-180' : ''}`}><Icons.ChevronDown /></span>
                            </button>
                            {openIndex === i && <div className={`px-5 pb-5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{faq.a}</div>}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

// ============================================
// NAVBAR
// ============================================
function Navbar({ cameraCount, multiCount, onOpenMulti }) {
    const { dark, toggleTheme } = useTheme();
    const [mobileMenu, setMobileMenu] = useState(false);

    return (
        <nav className={`sticky top-0 z-40 backdrop-blur-xl border-b transition-colors ${dark ? 'bg-gray-950/80 border-white/10' : 'bg-white/80 border-gray-200'}`}>
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex items-center justify-between h-16">
                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/25">
                            <Icons.Camera />
                        </div>
                        <div className="hidden sm:block">
                            <h1 className={`font-bold text-lg ${dark ? 'text-white' : 'text-gray-900'}`}>RAF NET</h1>
                            <p className={`text-[10px] -mt-0.5 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>CCTV Hub</p>
                        </div>
                    </Link>

                    {/* Desktop Actions */}
                    <div className="hidden md:flex items-center gap-3">
                        {multiCount > 0 && (
                            <button onClick={onOpenMulti} className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl shadow-lg shadow-sky-500/25">
                                <Icons.Layout /> Multi-View ({multiCount})
                            </button>
                        )}
                        <span className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{cameraCount} Cameras</span>
                        <button onClick={toggleTheme} className={`p-2.5 rounded-xl transition-colors ${dark ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                            {dark ? <Icons.Sun /> : <Icons.Moon />}
                        </button>
                        <Link to="/admin/login" className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${dark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>
                            Admin
                        </Link>
                    </div>

                    {/* Mobile Menu Button */}
                    <button onClick={() => setMobileMenu(!mobileMenu)} className={`md:hidden p-2 rounded-xl ${dark ? 'text-white' : 'text-gray-900'}`}>
                        {mobileMenu ? <Icons.X /> : <Icons.Menu />}
                    </button>
                </div>

                {/* Mobile Menu */}
                {mobileMenu && (
                    <div className={`md:hidden py-4 border-t ${dark ? 'border-white/10' : 'border-gray-200'}`}>
                        <div className="flex flex-col gap-3">
                            {multiCount > 0 && (
                                <button onClick={() => { onOpenMulti(); setMobileMenu(false); }} className="flex items-center justify-center gap-2 px-4 py-3 bg-sky-500 text-white font-medium rounded-xl">
                                    <Icons.Layout /> Open Multi-View ({multiCount})
                                </button>
                            )}
                            <div className="flex gap-2">
                                <button onClick={toggleTheme} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl ${dark ? 'bg-white/5 text-white' : 'bg-gray-100 text-gray-900'}`}>
                                    {dark ? <><Icons.Sun /> Light</> : <><Icons.Moon /> Dark</>}
                                </button>
                                <Link to="/admin/login" className={`flex-1 flex items-center justify-center py-3 font-medium rounded-xl ${dark ? 'bg-white/5 text-white' : 'bg-gray-100 text-gray-900'}`}>
                                    Admin
                                </Link>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </nav>
    );
}

// ============================================
// CAMERAS SECTION
// ============================================
function CamerasSection({ cameras, loading, error, onRefresh, onCameraClick, onAddMulti, multiIds }) {
    const { dark } = useTheme();
    const [cols, setCols] = useState(2);
    const gridCols = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' };

    return (
        <section id="cameras" className="py-16">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
                    <div>
                        <h2 className={`text-2xl sm:text-3xl font-black ${dark ? 'text-white' : 'text-gray-900'}`}>Live Cameras</h2>
                        <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                            {loading ? 'Loading...' : `${cameras.length} camera${cameras.length !== 1 ? 's' : ''} available`}
                        </p>
                    </div>
                    {/* Layout Switcher */}
                    <div className={`flex items-center gap-1 p-1 rounded-xl ${dark ? 'bg-gray-800' : 'bg-gray-100'}`}>
                        {[1, 2, 3].map(c => (
                            <button key={c} onClick={() => setCols(c)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${cols === c ? 'bg-sky-500 text-white shadow' : dark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                                {c}×{c}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Error State */}
                {error && !loading && (
                    <div className={`text-center py-16 rounded-2xl ${dark ? 'bg-red-500/10' : 'bg-red-50'}`}>
                        <p className={`font-medium mb-4 ${dark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
                        <button onClick={onRefresh} className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-xl">Try Again</button>
                    </div>
                )}

                {/* Loading */}
                {loading && (
                    <div className={`grid ${gridCols[cols]} gap-6`}>
                        {[...Array(6)].map((_, i) => <CameraSkeleton key={i} />)}
                    </div>
                )}

                {/* Camera Grid */}
                {!loading && !error && (
                    cameras.length === 0 ? (
                        <div className="text-center py-16">
                            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${dark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-400'}`}>
                                <Icons.Camera />
                            </div>
                            <p className={`font-medium ${dark ? 'text-gray-400' : 'text-gray-600'}`}>No cameras available</p>
                        </div>
                    ) : (
                        <div className={`grid ${gridCols[cols]} gap-6`}>
                            {cameras.map(camera => (
                                <CameraCard
                                    key={camera.id}
                                    camera={camera}
                                    onClick={() => onCameraClick(camera)}
                                    onAddMulti={() => onAddMulti(camera.id)}
                                    inMulti={multiIds.includes(camera.id)}
                                />
                            ))}
                        </div>
                    )
                )}
            </div>
        </section>
    );
}

// ============================================
// FOOTER
// ============================================
function Footer() {
    const { dark } = useTheme();
    return (
        <footer className={`py-8 border-t ${dark ? 'border-white/10 bg-gray-900/50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="max-w-7xl mx-auto px-4 text-center">
                <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                    © {new Date().getFullYear()} RAF NET CCTV Hub. Secure video streaming gateway.
                </p>
            </div>
        </footer>
    );
}

// ============================================
// MAIN LANDING PAGE COMPONENT
// ============================================
export default function LandingPage() {
    const { theme } = useTheme();
    const dark = theme === 'dark';
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [popupCamera, setPopupCamera] = useState(null);
    const [multiIds, setMultiIds] = useState([]);
    const [showMulti, setShowMulti] = useState(false);
    const camerasRef = useRef(null);

    // Fetch cameras
    const fetchCameras = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await streamService.getAllActiveStreams();
            if (response?.success && response?.data) {
                setCameras(response.data);
            } else {
                setError('Failed to load cameras');
            }
        } catch (err) {
            console.error('Fetch cameras error:', err);
            setError('Unable to connect to server');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCameras();
    }, [fetchCameras]);

    // Scroll to cameras section
    const scrollToCameras = () => {
        camerasRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Handle camera click - open popup
    const handleCameraClick = (camera) => {
        setPopupCamera(camera);
    };

    // Handle add/remove from multi-view
    const handleAddMulti = (cameraId) => {
        setMultiIds(prev => {
            if (prev.includes(cameraId)) {
                return prev.filter(id => id !== cameraId);
            }
            if (prev.length >= 3) {
                return prev; // Max 3 cameras
            }
            return [...prev, cameraId];
        });
    };

    // Remove from multi-view
    const handleRemoveMulti = (cameraId) => {
        setMultiIds(prev => prev.filter(id => id !== cameraId));
    };

    // Clear all multi-view
    const handleClearMulti = () => {
        setMultiIds([]);
    };

    return (
        <div className={`min-h-screen transition-colors ${dark ? 'bg-gray-950 text-white' : 'bg-white text-gray-900'}`}>
            {/* Navbar */}
            <Navbar
                cameraCount={cameras.length}
                multiCount={multiIds.length}
                onOpenMulti={() => setShowMulti(true)}
            />

            {/* Hero Section */}
            <HeroSection onScrollToCameras={scrollToCameras} />

            {/* Features Section */}
            <FeaturesSection />

            {/* Cameras Section */}
            <div ref={camerasRef}>
                <CamerasSection
                    cameras={cameras}
                    loading={loading}
                    error={error}
                    onRefresh={fetchCameras}
                    onCameraClick={handleCameraClick}
                    onAddMulti={handleAddMulti}
                    multiIds={multiIds}
                />
            </div>

            {/* FAQ Section */}
            <FAQSection />

            {/* Footer */}
            <Footer />

            {/* Video Popup Modal */}
            {popupCamera && (
                <VideoPopup
                    camera={popupCamera}
                    onClose={() => setPopupCamera(null)}
                />
            )}

            {/* Multi-View Panel */}
            {showMulti && (
                <MultiViewPanel
                    selectedIds={multiIds}
                    allCameras={cameras}
                    onRemove={handleRemoveMulti}
                    onClear={handleClearMulti}
                    onClose={() => setShowMulti(false)}
                />
            )}
        </div>
    );
}
