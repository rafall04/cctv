import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// ============================================
// ICONS
// ============================================
const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    Camera: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>,
    X: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>,
    Play: () => <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>,
    MapPin: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 5v14m-7-7h14"/></svg>,
    Check: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7"/></svg>,
    Fullscreen: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>,
    Reset: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
    Layout: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
    Image: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
    Filter: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>,
    ChevronDown: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7"/></svg>,
    ZoomIn: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/></svg>,
    ZoomOut: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/></svg>,
};

// Skeleton
const Skeleton = ({ className }) => <div className={`animate-pulse bg-gray-300 dark:bg-gray-700 rounded-xl ${className}`} />;
const CameraSkeleton = () => (
    <div className="rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg">
        <Skeleton className="aspect-video" />
        <div className="p-4 space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
    </div>
);

// ============================================
// CAMERA CARD
// ============================================
const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti }) {
    return (
        <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg hover:shadow-xl transition-shadow ring-1 ring-gray-200 dark:ring-gray-800 hover:ring-sky-500/50">
            <button
                onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                className={`absolute top-3 right-3 z-30 p-2.5 rounded-xl shadow-lg transition-colors ${
                    inMulti ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-sky-500 hover:text-white'
                }`}
            >
                {inMulti ? <Icons.Check /> : <Icons.Plus />}
            </button>
            <div onClick={onClick} className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 relative cursor-pointer group">
                <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-700">
                    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/30 transition-opacity">
                    <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center text-sky-500 shadow-xl"><Icons.Play /></div>
                </div>
                <div className="absolute top-3 left-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold shadow-lg">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />LIVE
                    </span>
                </div>
            </div>
            <div className="p-4 cursor-pointer" onClick={onClick}>
                <h3 className="font-bold text-gray-900 dark:text-white truncate">{camera.name}</h3>
                {camera.location && <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mt-1"><Icons.MapPin /><span className="truncate">{camera.location}</span></p>}
                {camera.area_name && <span className="inline-block mt-2 text-[10px] font-semibold px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">{camera.area_name}</span>}
            </div>
        </div>
    );
});


// ============================================
// ZOOM/PAN HOOK - Smooth with animation control
// ============================================
function useZoomPan(maxZoom = 4) {
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
    const animationTimer = useRef(null);

    const getMaxPan = useCallback((z) => {
        if (z <= 1) return 0;
        return ((z - 1) / (2 * z)) * 100;
    }, []);

    const clampPan = useCallback((x, y, z) => {
        const max = getMaxPan(z);
        return { x: Math.max(-max, Math.min(max, x)), y: Math.max(-max, Math.min(max, y)) };
    }, [getMaxPan]);

    // Smooth zoom (button click)
    const handleZoom = useCallback((delta) => {
        setIsAnimating(true);
        clearTimeout(animationTimer.current);
        
        setZoom(z => {
            const newZoom = Math.max(1, Math.min(maxZoom, z + delta));
            if (newZoom <= 1) setPan({ x: 0, y: 0 });
            else setPan(p => clampPan(p.x, p.y, newZoom));
            return newZoom;
        });
        
        animationTimer.current = setTimeout(() => setIsAnimating(false), 200);
    }, [maxZoom, clampPan]);

    // Wheel zoom (no animation for responsiveness)
    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.5 : 0.5;
        setZoom(z => {
            const newZoom = Math.max(1, Math.min(maxZoom, z + delta));
            if (newZoom <= 1) setPan({ x: 0, y: 0 });
            else setPan(p => clampPan(p.x, p.y, newZoom));
            return newZoom;
        });
    }, [maxZoom, clampPan]);

    const handlePointerDown = useCallback((e) => {
        if (zoom <= 1) return;
        setIsDragging(true);
        setIsAnimating(false);
        dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        e.currentTarget.setPointerCapture(e.pointerId);
    }, [zoom, pan]);

    const handlePointerMove = useCallback((e) => {
        if (!isDragging || zoom <= 1) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        const sensitivity = 3;
        setPan(clampPan(dragStart.current.panX + dx / sensitivity, dragStart.current.panY + dy / sensitivity, zoom));
    }, [isDragging, zoom, clampPan]);

    const handlePointerUp = useCallback((e) => {
        setIsDragging(false);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }, []);

    const reset = useCallback(() => {
        setIsAnimating(true);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        clearTimeout(animationTimer.current);
        animationTimer.current = setTimeout(() => setIsAnimating(false), 200);
    }, []);

    useEffect(() => () => clearTimeout(animationTimer.current), []);

    return {
        zoom, pan, isDragging, isAnimating,
        handleZoom, handleWheel, handlePointerDown, handlePointerMove, handlePointerUp, reset,
        getTransform: () => `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
        getStyle: () => ({
            transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
            transformOrigin: 'center center',
            transition: isAnimating ? 'transform 0.2s ease-out' : 'none',
            cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
            willChange: 'transform'
        })
    };
}


// ============================================
// VIDEO POPUP
// ============================================
function VideoPopup({ camera, onClose }) {
    const videoRef = useRef(null);
    const modalRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('connecting');
    const zp = useZoomPan(4);
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
        try {
            if (!document.fullscreenElement) await modalRef.current?.requestFullscreen?.();
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-2 sm:p-4" onClick={onClose}>
            <div ref={modalRef} className="relative w-full max-w-5xl bg-gray-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 16px)' }} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="shrink-0 flex items-center justify-between p-3 sm:p-4 bg-gray-900 border-b border-white/10">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-white font-bold text-sm sm:text-lg truncate">{camera.name}</h2>
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${status === 'live' ? 'bg-emerald-500/20 text-emerald-400' : status === 'connecting' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-emerald-400 animate-pulse' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
                                {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
                            </span>
                        </div>
                        {camera.location && <p className="text-gray-400 text-xs sm:text-sm flex items-center gap-1.5 mt-1 truncate"><Icons.MapPin /> {camera.location}</p>}
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2">
                        {status === 'live' && <button onClick={takeSnapshot} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.Fullscreen /></button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.X /></button>
                    </div>
                </div>

                {/* Video */}
                <div className="relative flex-1 min-h-0 bg-black overflow-hidden" onWheel={zp.handleWheel} onDoubleClick={toggleFS}>
                    <video 
                        ref={videoRef}
                        onPointerDown={zp.handlePointerDown}
                        onPointerMove={zp.handlePointerMove}
                        onPointerUp={zp.handlePointerUp}
                        onPointerCancel={zp.handlePointerUp}
                        onPointerLeave={zp.handlePointerUp}
                        className="w-full h-full object-contain"
                        style={zp.getStyle()}
                        muted playsInline autoPlay 
                    />
                    {status === 'connecting' && <div className="absolute inset-0 flex items-center justify-center bg-black/60"><div className="w-10 h-10 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin" /></div>}
                    {status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-black/80"><p className="text-red-400">Stream Unavailable</p></div>}
                </div>

                {/* Footer */}
                <div className="shrink-0 p-3 sm:p-4 bg-gray-900 border-t border-white/10">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            {camera.description && <p className="text-gray-400 text-xs sm:text-sm line-clamp-1">{camera.description}</p>}
                            {camera.area_name && <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">{camera.area_name}</span>}
                        </div>
                        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
                            <button onClick={() => zp.handleZoom(-0.5)} disabled={zp.zoom <= 1} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icons.ZoomOut /></button>
                            <span className="text-white text-xs font-medium w-12 text-center">{Math.round(zp.zoom * 100)}%</span>
                            <button onClick={() => zp.handleZoom(0.5)} disabled={zp.zoom >= 4} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icons.ZoomIn /></button>
                            {zp.zoom > 1 && <button onClick={zp.reset} className="p-2 hover:bg-white/10 rounded-lg text-white ml-1"><Icons.Reset /></button>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


// ============================================
// MULTI-VIEW VIDEO ITEM
// ============================================
function MultiViewVideoItem({ camera, onRemove }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('connecting');
    const zp = useZoomPan(3);
    const url = camera.streams?.hls;

    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 10 });
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
        try {
            if (!document.fullscreenElement) await containerRef.current?.requestFullscreen?.();
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

    const handleWheel = (e) => { e.stopPropagation(); zp.handleWheel(e); };

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black rounded-xl overflow-hidden group" onWheel={handleWheel}>
            <video 
                ref={videoRef}
                onPointerDown={zp.handlePointerDown}
                onPointerMove={zp.handlePointerMove}
                onPointerUp={zp.handlePointerUp}
                onPointerCancel={zp.handlePointerUp}
                onPointerLeave={zp.handlePointerUp}
                className="w-full h-full object-contain"
                style={zp.getStyle()}
                muted playsInline autoPlay 
            />
            <div className="absolute top-2 left-2 z-10">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold text-white shadow ${status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-red-500'}`}>
                    <span className={`w-1 h-1 rounded-full bg-white ${status === 'live' ? 'animate-pulse' : ''}`} />
                    {status === 'live' ? 'LIVE' : status === 'connecting' ? '...' : 'OFF'}
                </span>
            </div>
            <button onClick={onRemove} className="absolute top-2 right-2 z-10 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg text-white shadow"><Icons.X /></button>
            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-white text-xs font-medium truncate flex-1">{camera.name}</p>
                    <div className="flex items-center gap-1">
                        <button onClick={() => zp.handleZoom(-0.5)} disabled={zp.zoom <= 1} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomOut /></button>
                        <span className="text-white/70 text-[10px] w-8 text-center">{Math.round(zp.zoom * 100)}%</span>
                        <button onClick={() => zp.handleZoom(0.5)} disabled={zp.zoom >= 3} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomIn /></button>
                        {zp.zoom > 1 && <button onClick={zp.reset} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Reset /></button>}
                        <div className="w-px h-4 bg-white/20 mx-1" />
                        {status === 'live' && <button onClick={takeSnapshot} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Fullscreen /></button>
                    </div>
                </div>
            </div>
            {status === 'connecting' && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><div className="w-6 h-6 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin" /></div>}
            {status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-black/70"><p className="text-red-400 text-xs">Offline</p></div>}
        </div>
    );
}

// ============================================
// MULTI-VIEW LAYOUT
// ============================================
function MultiViewLayout({ cameras, onRemove, onClose }) {
    const containerRef = useRef(null);
    const count = cameras.length;

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose]);

    const toggleFS = async () => {
        try {
            if (!document.fullscreenElement) await containerRef.current?.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch {}
    };

    return (
        <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
            <div className="shrink-0 flex items-center justify-between p-3 bg-gray-900 border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400"><Icons.Layout /></div>
                    <div>
                        <h2 className="text-white font-bold text-sm sm:text-base">Multi-View</h2>
                        <p className="text-gray-500 text-[10px] sm:text-xs">{count} camera{count !== 1 ? 's' : ''}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={toggleFS} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.Fullscreen /></button>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.X /></button>
                </div>
            </div>
            <div ref={containerRef} className="flex-1 p-2 sm:p-3 min-h-0 overflow-hidden">
                {count === 1 && <div className="h-full"><MultiViewVideoItem camera={cameras[0]} onRemove={() => onRemove(cameras[0].id)} /></div>}
                {count === 2 && <div className="h-full grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">{cameras.map(c => <MultiViewVideoItem key={c.id} camera={c} onRemove={() => onRemove(c.id)} />)}</div>}
                {count === 3 && (
                    <div className="h-full flex flex-col gap-2 sm:gap-3">
                        <div style={{ flex: '1.2 1 0%' }} className="min-h-0"><MultiViewVideoItem camera={cameras[0]} onRemove={() => onRemove(cameras[0].id)} /></div>
                        <div style={{ flex: '0.8 1 0%' }} className="min-h-0 grid grid-cols-2 gap-2 sm:gap-3">{cameras.slice(1).map(c => <MultiViewVideoItem key={c.id} camera={c} onRemove={() => onRemove(c.id)} />)}</div>
                    </div>
                )}
            </div>
        </div>
    );
}


// ============================================
// NAVBAR
// ============================================
function Navbar() {
    const { isDark, toggleTheme } = useTheme();
    return (
        <nav className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg">
                            <Icons.Camera />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900 dark:text-white">RAF NET</h1>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-0.5">CCTV Monitoring</p>
                        </div>
                    </div>
                    <button
                        onClick={toggleTheme}
                        className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                        {isDark ? <Icons.Sun /> : <Icons.Moon />}
                    </button>
                </div>
            </div>
        </nav>
    );
}

// ============================================
// FILTER DROPDOWN
// ============================================
function FilterDropdown({ areas, selected, onChange }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const selectedArea = areas.find(a => a.id === selected);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-sky-500 transition-colors shadow-sm"
            >
                <Icons.Filter />
                <span className="text-sm font-medium">{selectedArea?.name || 'All Areas'}</span>
                <Icons.ChevronDown />
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 z-50">
                    <button
                        onClick={() => { onChange(null); setOpen(false); }}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${!selected ? 'text-sky-500 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                    >
                        All Areas
                    </button>
                    {areas.map(area => (
                        <button
                            key={area.id}
                            onClick={() => { onChange(area.id); setOpen(false); }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${selected === area.id ? 'text-sky-500 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                        >
                            {area.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================
// CAMERAS SECTION
// ============================================
function CamerasSection({ cameras, loading, areas, onCameraClick, onAddMulti, multiCameras, cols, setCols }) {
    const [filter, setFilter] = useState(null);
    const filtered = filter ? cameras.filter(c => c.area_id === filter) : cameras;

    const gridClass = cols === 1 
        ? 'grid-cols-1' 
        : cols === 2 
            ? 'grid-cols-1 sm:grid-cols-2' 
            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

    return (
        <section className="py-8 sm:py-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Live Cameras</h2>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{filtered.length} camera{filtered.length !== 1 ? 's' : ''} available</p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        {areas.length > 0 && <FilterDropdown areas={areas} selected={filter} onChange={setFilter} />}
                        {/* Layout Switcher */}
                        <div className="flex items-center bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-1 shadow-sm">
                            {[1, 2, 3].map(n => (
                                <button
                                    key={n}
                                    onClick={() => setCols(n)}
                                    className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${
                                        cols === n 
                                            ? 'bg-sky-500 text-white shadow' 
                                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Grid */}
                {loading ? (
                    <div className={`grid ${gridClass} gap-4 sm:gap-6`}>
                        {[1, 2, 3, 4, 5, 6].map(i => <CameraSkeleton key={i} />)}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400">
                            <Icons.Camera />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Cameras Found</h3>
                        <p className="text-gray-500 dark:text-gray-400">No cameras available in this area.</p>
                    </div>
                ) : (
                    <div className={`grid ${gridClass} gap-4 sm:gap-6`}>
                        {filtered.map(camera => (
                            <CameraCard
                                key={camera.id}
                                camera={camera}
                                onClick={() => onCameraClick(camera)}
                                onAddMulti={() => onAddMulti(camera)}
                                inMulti={multiCameras.some(c => c.id === camera.id)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

// ============================================
// FOOTER
// ============================================
function Footer() {
    return (
        <footer className="py-6 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <p className="text-center text-gray-500 dark:text-gray-400 text-sm">
                    © {new Date().getFullYear()} RAF NET CCTV Hub. All rights reserved.
                </p>
            </div>
        </footer>
    );
}

// ============================================
// MULTI-VIEW FLOATING BUTTON
// ============================================
function MultiViewButton({ count, onClick }) {
    if (count === 0) return null;
    return (
        <button
            onClick={onClick}
            className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all"
        >
            <Icons.Layout />
            <span className="font-bold">Multi-View</span>
            <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">{count}</span>
        </button>
    );
}

// ============================================
// MAIN LANDING PAGE
// ============================================
export default function LandingPage() {
    const [cameras, setCameras] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [popup, setPopup] = useState(null);
    const [multiCameras, setMultiCameras] = useState([]);
    const [showMulti, setShowMulti] = useState(false);
    const [cols, setCols] = useState(3);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [camsRes, areasRes] = await Promise.all([
                    streamService.getAllActiveStreams(),
                    fetch('/api/areas').then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] }))
                ]);
                setCameras(camsRes.data || []);
                setAreas(areasRes.data || []);
            } catch (err) {
                console.error('Failed to fetch data:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const handleAddMulti = useCallback((camera) => {
        setMultiCameras(prev => {
            const exists = prev.some(c => c.id === camera.id);
            if (exists) return prev.filter(c => c.id !== camera.id);
            if (prev.length >= 3) return prev;
            return [...prev, camera];
        });
    }, []);

    const handleRemoveMulti = useCallback((id) => {
        setMultiCameras(prev => {
            const next = prev.filter(c => c.id !== id);
            if (next.length === 0) setShowMulti(false);
            return next;
        });
    }, []);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
            <Navbar />
            
            {/* Hero */}
            <div className="bg-gradient-to-br from-sky-500/10 via-transparent to-purple-500/10 dark:from-sky-500/5 dark:to-purple-500/5">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 text-center">
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white mb-3">
                        Live CCTV Monitoring
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                        Real-time surveillance system with secure streaming
                    </p>
                </div>
            </div>

            <CamerasSection
                cameras={cameras}
                loading={loading}
                areas={areas}
                onCameraClick={setPopup}
                onAddMulti={handleAddMulti}
                multiCameras={multiCameras}
                cols={cols}
                setCols={setCols}
            />

            <div className="flex-1" />
            <Footer />

            <MultiViewButton count={multiCameras.length} onClick={() => setShowMulti(true)} />

            {popup && <VideoPopup camera={popup} onClose={() => setPopup(null)} />}
            {showMulti && multiCameras.length > 0 && (
                <MultiViewLayout
                    cameras={multiCameras}
                    onRemove={handleRemoveMulti}
                    onClose={() => setShowMulti(false)}
                />
            )}
        </div>
    );
}
