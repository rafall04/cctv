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

// ============================================
// SKELETON
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
        </div>
    </div>
);

// ============================================
// CAMERA CARD
// ============================================
const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti }) {
    return (
        <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg hover:shadow-xl transition-all duration-300 ring-1 ring-gray-200 dark:ring-gray-800 hover:ring-sky-500/50">
            <button
                onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                className={`absolute top-3 right-3 z-30 p-2.5 rounded-xl shadow-lg transition-all ${
                    inMulti ? 'bg-emerald-500 text-white scale-110' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-sky-500 hover:text-white hover:scale-110'
                }`}
                title={inMulti ? 'Remove from Multi-View' : 'Add to Multi-View'}
            >
                {inMulti ? <Icons.Check /> : <Icons.Plus />}
            </button>

            <div onClick={onClick} className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 relative overflow-hidden cursor-pointer group">
                <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-700 group-hover:scale-110 transition-transform duration-500">
                    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all duration-300">
                    <div className="w-12 h-12 rounded-full bg-white/90 dark:bg-gray-900/90 flex items-center justify-center text-sky-500 opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300 shadow-xl">
                        <Icons.Play />
                    </div>
                </div>
                <div className="absolute top-3 left-3 z-10">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold shadow-lg">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        LIVE
                    </span>
                </div>
            </div>

            <div className="p-4 cursor-pointer" onClick={onClick}>
                <h3 className="font-bold text-gray-900 dark:text-white truncate">{camera.name}</h3>
                {camera.location && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mt-1">
                        <Icons.MapPin /><span className="truncate">{camera.location}</span>
                    </p>
                )}
                {camera.area_name && (
                    <span className="inline-block mt-2 text-[10px] font-semibold px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">
                        {camera.area_name}
                    </span>
                )}
            </div>
        </div>
    );
});


// ============================================
// VIDEO POPUP - Fixed zoom clipping
// ============================================
function VideoPopup({ camera, onClose }) {
    const videoRef = useRef(null);
    const videoWrapperRef = useRef(null);
    const modalRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('connecting');
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
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

    const handleZoom = (delta) => {
        setZoom(z => {
            const nz = Math.max(1, Math.min(4, z + delta));
            if (nz === 1) setPan({ x: 0, y: 0 });
            return nz;
        });
    };

    const onWheel = (e) => {
        e.preventDefault();
        handleZoom(e.deltaY > 0 ? -0.3 : 0.3);
    };

    const onPointerDown = (e) => {
        if (zoom <= 1) return;
        setDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        const maxPan = 50 * (zoom - 1); // percentage based
        setPan({
            x: Math.max(-maxPan, Math.min(maxPan, dragStart.current.panX + (dx / 5))),
            y: Math.max(-maxPan, Math.min(maxPan, dragStart.current.panY + (dy / 5)))
        });
    };

    const onPointerUp = (e) => {
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-2 sm:p-4" onClick={onClose}>
            <div 
                ref={modalRef} 
                className="relative w-full max-w-5xl bg-gray-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
                style={{ maxHeight: 'calc(100vh - 32px)' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="shrink-0 flex items-center justify-between p-3 sm:p-4 bg-gray-900 border-b border-white/10">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-white font-bold text-sm sm:text-lg truncate">{camera.name}</h2>
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                status === 'live' ? 'bg-emerald-500/20 text-emerald-400' : status === 'connecting' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'
                            }`}>
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

                {/* Video Container - clips zoomed content */}
                <div 
                    ref={videoWrapperRef}
                    className="relative flex-1 min-h-0 bg-black overflow-hidden"
                    onWheel={onWheel}
                    onDoubleClick={toggleFS}
                >
                    <video 
                        ref={videoRef}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        className="w-full h-full object-contain transition-transform duration-150 ease-out"
                        style={{ 
                            transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
                            cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default'
                        }}
                        muted playsInline autoPlay 
                    />
                    {status === 'connecting' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <div className="w-10 h-10 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin" />
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                            <p className="text-red-400">Stream Unavailable</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="shrink-0 p-3 sm:p-4 bg-gray-900 border-t border-white/10">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            {camera.description && <p className="text-gray-400 text-xs sm:text-sm line-clamp-1">{camera.description}</p>}
                            {camera.area_name && <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">{camera.area_name}</span>}
                        </div>
                        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
                            <button onClick={() => handleZoom(-0.5)} disabled={zoom <= 1} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icons.ZoomOut /></button>
                            <span className="text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                            <button onClick={() => handleZoom(0.5)} disabled={zoom >= 4} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icons.ZoomIn /></button>
                            {zoom > 1 && <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-2 hover:bg-white/10 rounded-lg text-white ml-1"><Icons.Reset /></button>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


// ============================================
// MULTI-VIEW VIDEO ITEM - Smooth zoom
// ============================================
function MultiViewVideoItem({ camera, onRemove }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('connecting');
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
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

    const handleZoom = (delta) => {
        setZoom(z => {
            const nz = Math.max(1, Math.min(3, z + delta));
            if (nz === 1) setPan({ x: 0, y: 0 });
            return nz;
        });
    };

    const onWheel = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleZoom(e.deltaY > 0 ? -0.2 : 0.2);
    };

    const onPointerDown = (e) => {
        if (zoom <= 1) return;
        e.stopPropagation();
        setDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        const maxPan = 40 * (zoom - 1);
        setPan({
            x: Math.max(-maxPan, Math.min(maxPan, dragStart.current.panX + (dx / 6))),
            y: Math.max(-maxPan, Math.min(maxPan, dragStart.current.panY + (dy / 6)))
        });
    };

    const onPointerUp = (e) => {
        setDragging(false);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    };

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black rounded-xl overflow-hidden group" onWheel={onWheel}>
            <video 
                ref={videoRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="w-full h-full object-contain transition-transform duration-150 ease-out"
                style={{ 
                    transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
                    cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default'
                }}
                muted playsInline autoPlay 
            />

            {/* Status */}
            <div className="absolute top-2 left-2 z-10">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold text-white shadow ${
                    status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-red-500'
                }`}>
                    <span className={`w-1 h-1 rounded-full bg-white ${status === 'live' ? 'animate-pulse' : ''}`} />
                    {status === 'live' ? 'LIVE' : status === 'connecting' ? '...' : 'OFF'}
                </span>
            </div>

            {/* Remove */}
            <button onClick={onRemove} className="absolute top-2 right-2 z-10 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg text-white shadow">
                <Icons.X />
            </button>

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-white text-xs font-medium truncate flex-1">{camera.name}</p>
                    <div className="flex items-center gap-1">
                        <button onClick={() => handleZoom(-0.5)} disabled={zoom <= 1} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomOut /></button>
                        <span className="text-white/70 text-[10px] w-8 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => handleZoom(0.5)} disabled={zoom >= 3} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomIn /></button>
                        {zoom > 1 && <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Reset /></button>}
                        <div className="w-px h-4 bg-white/20 mx-1" />
                        {status === 'live' && <button onClick={takeSnapshot} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Fullscreen /></button>
                    </div>
                </div>
            </div>

            {/* Loading */}
            {status === 'connecting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="w-6 h-6 border-2 border-white/20 border-t-sky-500 rounded-full animate-spin" />
                </div>
            )}

            {/* Error */}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                    <p className="text-red-400 text-xs">Offline</p>
                </div>
            )}
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
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400">
                        <Icons.Layout />
                    </div>
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
                {count === 0 && (
                    <div className="h-full flex items-center justify-center">
                        <p className="text-gray-500">No cameras selected</p>
                    </div>
                )}

                {count === 1 && (
                    <div className="h-full">
                        <MultiViewVideoItem camera={cameras[0]} onRemove={() => onRemove(cameras[0].id)} />
                    </div>
                )}

                {count === 2 && (
                    <div className="h-full grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        {cameras.map(cam => (
                            <MultiViewVideoItem key={cam.id} camera={cam} onRemove={() => onRemove(cam.id)} />
                        ))}
                    </div>
                )}

                {count === 3 && (
                    <div className="h-full flex flex-col gap-2 sm:gap-3">
                        <div style={{ flex: '1.2 1 0%' }} className="min-h-0">
                            <MultiViewVideoItem camera={cameras[0]} onRemove={() => onRemove(cameras[0].id)} />
                        </div>
                        <div style={{ flex: '0.8 1 0%' }} className="min-h-0 grid grid-cols-2 gap-2 sm:gap-3">
                            {cameras.slice(1).map(cam => (
                                <MultiViewVideoItem key={cam.id} camera={cam} onRemove={() => onRemove(cam.id)} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================
// NAVBAR
// ============================================
function Navbar({ cameraCount, multiCount, onOpenMulti }) {
    const { dark, toggleTheme } = useTheme();

    return (
        <nav className={`sticky top-0 z-40 backdrop-blur-xl border-b transition-colors ${dark ? 'bg-gray-950/80 border-white/10' : 'bg-white/80 border-gray-200'}`}>
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex items-center justify-between h-14 sm:h-16">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/25">
                            <Icons.Camera />
                        </div>
                        <div>
                            <h1 className={`font-bold text-base sm:text-lg ${dark ? 'text-white' : 'text-gray-900'}`}>RAF NET</h1>
                            <p className={`text-[10px] -mt-0.5 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>CCTV Hub</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3">
                        {multiCount > 0 && (
                            <button onClick={onOpenMulti} className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-xs sm:text-sm font-medium rounded-xl shadow-lg shadow-sky-500/25 transition-colors">
                                <Icons.Layout /> 
                                <span className="hidden sm:inline">Multi-View</span>
                                <span>({multiCount})</span>
                            </button>
                        )}
                        <span className={`hidden sm:inline text-sm ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                            {cameraCount} Cameras
                        </span>
                        <button onClick={toggleTheme} className={`p-2 sm:p-2.5 rounded-xl transition-colors ${dark ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                            {dark ? <Icons.Sun /> : <Icons.Moon />}
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
}


// ============================================
// FILTER DROPDOWN
// ============================================
function FilterDropdown({ areas, selectedArea, onSelect, dark }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const handleClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(!open)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    dark ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-white text-gray-900 hover:bg-gray-50 shadow-sm'
                } ${selectedArea ? 'ring-2 ring-sky-500' : ''}`}
            >
                <Icons.Filter />
                <span className="hidden sm:inline">{selectedArea || 'All Areas'}</span>
                <span className="sm:hidden">{selectedArea ? '1' : 'All'}</span>
                <Icons.ChevronDown />
            </button>

            {open && (
                <div className={`absolute top-full left-0 mt-2 w-48 rounded-xl shadow-xl z-50 overflow-hidden ${dark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
                    <button
                        onClick={() => { onSelect(null); setOpen(false); }}
                        className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                            !selectedArea ? 'bg-sky-500 text-white' : dark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        All Areas
                    </button>
                    {areas.map(area => (
                        <button
                            key={area}
                            onClick={() => { onSelect(area); setOpen(false); }}
                            className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                                selectedArea === area ? 'bg-sky-500 text-white' : dark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            {area}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================
// CAMERAS SECTION - Fixed layout switcher
// ============================================
function CamerasSection({ cameras, loading, error, onRefresh, onCameraClick, onAddMulti, multiIds }) {
    const { dark } = useTheme();
    const [cols, setCols] = useState(2);
    const [selectedArea, setSelectedArea] = useState(null);

    const areas = [...new Set(cameras.map(c => c.area_name).filter(Boolean))];
    const filteredCameras = selectedArea ? cameras.filter(c => c.area_name === selectedArea) : cameras;

    // Grid class based on cols
    const getGridClass = () => {
        switch (cols) {
            case 1: return 'grid-cols-1';
            case 2: return 'grid-cols-1 sm:grid-cols-2';
            case 3: return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
            default: return 'grid-cols-1 sm:grid-cols-2';
        }
    };

    return (
        <section className="py-6 sm:py-10">
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex flex-col gap-4 mb-6">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                        <div>
                            <h2 className={`text-xl sm:text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Live Cameras</h2>
                            <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                                {loading ? 'Loading...' : `${filteredCameras.length} camera${filteredCameras.length !== 1 ? 's' : ''} ${selectedArea ? `in ${selectedArea}` : 'available'}`}
                            </p>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3">
                            {areas.length > 0 && (
                                <FilterDropdown areas={areas} selectedArea={selectedArea} onSelect={setSelectedArea} dark={dark} />
                            )}

                            {/* Layout Switcher */}
                            <div className={`flex items-center p-1 rounded-xl ${dark ? 'bg-gray-800' : 'bg-gray-100'}`}>
                                {[1, 2, 3].map(n => (
                                    <button 
                                        key={n}
                                        onClick={() => setCols(n)} 
                                        className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                                            cols === n 
                                                ? 'bg-sky-500 text-white shadow' 
                                                : dark ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                                        }`}
                                    >
                                        {n} Col{n > 1 ? 's' : ''}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {error && !loading && (
                    <div className={`text-center py-12 rounded-2xl ${dark ? 'bg-red-500/10' : 'bg-red-50'}`}>
                        <p className={`font-medium mb-4 ${dark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
                        <button onClick={onRefresh} className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-xl">Try Again</button>
                    </div>
                )}

                {loading && (
                    <div className={`grid ${getGridClass()} gap-4 sm:gap-6`}>
                        {[...Array(6)].map((_, i) => <CameraSkeleton key={i} />)}
                    </div>
                )}

                {!loading && !error && (
                    filteredCameras.length === 0 ? (
                        <div className="text-center py-16">
                            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${dark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-400'}`}>
                                <Icons.Camera />
                            </div>
                            <p className={`font-medium ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                                {selectedArea ? `No cameras in ${selectedArea}` : 'No cameras available'}
                            </p>
                            {selectedArea && (
                                <button onClick={() => setSelectedArea(null)} className="mt-3 text-sky-500 hover:text-sky-400 text-sm">Clear filter</button>
                            )}
                        </div>
                    ) : (
                        <div className={`grid ${getGridClass()} gap-4 sm:gap-6`}>
                            {filteredCameras.map(camera => (
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
        <footer className={`py-6 border-t ${dark ? 'border-white/10' : 'border-gray-200'}`}>
            <div className="max-w-7xl mx-auto px-4 text-center">
                <p className={`text-xs sm:text-sm ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
                    © {new Date().getFullYear()} RAF NET CCTV Hub
                </p>
            </div>
        </footer>
    );
}


// ============================================
// MAIN LANDING PAGE
// ============================================
export default function LandingPage() {
    const { dark } = useTheme();
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [popupCamera, setPopupCamera] = useState(null);
    const [multiIds, setMultiIds] = useState([]);
    const [showMulti, setShowMulti] = useState(false);

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

    const handleCameraClick = (camera) => setPopupCamera(camera);

    const handleAddMulti = (cameraId) => {
        setMultiIds(prev => {
            if (prev.includes(cameraId)) return prev.filter(id => id !== cameraId);
            if (prev.length >= 3) return prev;
            return [...prev, cameraId];
        });
    };

    const handleRemoveMulti = (cameraId) => setMultiIds(prev => prev.filter(id => id !== cameraId));

    const multiCameras = multiIds.map(id => cameras.find(c => c.id === id)).filter(Boolean);

    useEffect(() => {
        if (showMulti && multiCameras.length === 0) setShowMulti(false);
    }, [showMulti, multiCameras.length]);

    return (
        <div className={`min-h-screen flex flex-col transition-colors ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
            <Navbar cameraCount={cameras.length} multiCount={multiIds.length} onOpenMulti={() => setShowMulti(true)} />

            <div className={`py-6 sm:py-8 text-center px-4 ${dark ? 'bg-gray-900/50' : 'bg-white'}`}>
                <h1 className={`text-2xl sm:text-3xl font-bold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>Live CCTV Monitoring</h1>
                <p className={`text-sm sm:text-base max-w-xl mx-auto ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                    Klik kamera untuk melihat stream. Gunakan tombol <span className="inline-flex items-center justify-center w-5 h-5 bg-sky-500 text-white rounded text-xs mx-1">+</span> untuk multi-view (max 3).
                </p>
            </div>

            <div className="flex-1">
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

            <Footer />

            {popupCamera && <VideoPopup camera={popupCamera} onClose={() => setPopupCamera(null)} />}
            {showMulti && multiCameras.length > 0 && <MultiViewLayout cameras={multiCameras} onRemove={handleRemoveMulti} onClose={() => setShowMulti(false)} />}
        </div>
    );
}
