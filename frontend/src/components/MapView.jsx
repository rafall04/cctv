/**
 * MapView Component - Desain Modern CCTV Publik
 * Optimasi untuk device low-end
 */

import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import Hls from 'hls.js';
import 'leaflet/dist/leaflet.css';
import { detectDeviceTier } from '../utils/deviceDetector';
import { settingsService } from '../services/settingsService';
import { getHLSConfig } from '../utils/hlsConfig';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Deteksi device tier sekali saja
const deviceTier = detectDeviceTier();
const isLowEnd = deviceTier === 'low';

// Cache icon untuk menghindari pembuatan ulang
const iconCache = new Map();

// CCTV Marker - dengan support status (active, maintenance, tunnel)
const createCameraIcon = (status = 'active', isTunnel = false) => {
    // Status: 'active' = hijau, 'maintenance' = merah, 'tunnel' = orange
    let cacheKey = status === 'maintenance' ? 'maintenance' : (isTunnel ? 'tunnel' : 'stable');
    if (iconCache.has(cacheKey)) {
        return iconCache.get(cacheKey);
    }

    let color, darkColor;
    if (status === 'maintenance') {
        color = '#ef4444'; // merah
        darkColor = '#dc2626';
    } else if (isTunnel) {
        color = '#f97316'; // orange
        darkColor = '#ea580c';
    } else {
        color = '#10b981'; // hijau
        darkColor = '#059669';
    }
    
    const icon = L.divIcon({
        className: 'cctv-marker',
        html: `
            <div style="
                position: relative;
                width: 36px;
                height: 36px;
                cursor: pointer;
            ">
                <div style="
                    width: 36px;
                    height: 36px;
                    background: linear-gradient(135deg, ${color} 0%, ${darkColor} 100%);
                    border: 3px solid white;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    box-shadow: 0 3px 8px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white" style="transform: rotate(45deg);">
                        ${status === 'maintenance' 
                            ? '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>'
                            : '<path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.98z"/>'
                        }
                    </svg>
                </div>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
    });

    iconCache.set(cacheKey, icon);
    return icon;
};

const hasValidCoords = (c) => {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
};

// Fungsi untuk mendeteksi dan memberikan offset pada marker yang bertumpuk
const applyMarkerOffset = (cameras) => {
    const coordMap = new Map();
    const OFFSET = 0.0003; // ~30 meter offset
    
    return cameras.map(camera => {
        const lat = parseFloat(camera.latitude);
        const lng = parseFloat(camera.longitude);
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`; // Group by ~11m precision
        
        if (!coordMap.has(key)) {
            coordMap.set(key, []);
        }
        
        const group = coordMap.get(key);
        const index = group.length;
        group.push(camera.id);
        
        // Jika ada lebih dari 1 kamera di lokasi yang sama, beri offset melingkar
        if (index > 0) {
            const angle = (index * 60) * (Math.PI / 180); // 60 derajat per kamera
            const offsetLat = lat + (OFFSET * Math.cos(angle));
            const offsetLng = lng + (OFFSET * Math.sin(angle));
            return { ...camera, _displayLat: offsetLat, _displayLng: offsetLng, _isGrouped: true, _groupIndex: index };
        }
        
        return { ...camera, _displayLat: lat, _displayLng: lng, _isGrouped: false, _groupIndex: 0 };
    });
};

// Video Modal - OPTIMIZED untuk low-end device
// Menggunakan ref-based state untuk pan/zoom agar tidak trigger re-render
const VideoModal = memo(({ camera, onClose }) => {
    const videoRef = useRef(null);
    const videoWrapperRef = useRef(null);
    const modalRef = useRef(null);
    const hlsRef = useRef(null);
    const rafRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [errorType, setErrorType] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    
    // Zoom state - hanya untuk UI display
    const [zoomDisplay, setZoomDisplay] = useState(1);
    
    // Ref-based state untuk performa (tidak trigger re-render saat pan/zoom)
    const stateRef = useRef({ 
        zoom: 1, panX: 0, panY: 0, 
        dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 
    });

    const isMaintenance = camera.status === 'maintenance';
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;

    const MIN_ZOOM = 1;
    const MAX_ZOOM = 4;

    const getMaxPan = (z) => z <= 1 ? 0 : ((z - 1) / (2 * z)) * 100;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // Apply transform langsung ke DOM (bypass React re-render)
    const applyTransform = useCallback((animate = false) => {
        if (!videoWrapperRef.current) return;
        const { zoom, panX, panY } = stateRef.current;
        videoWrapperRef.current.style.transition = animate ? 'transform 0.15s ease-out' : 'none';
        videoWrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
        setZoomDisplay(zoom);
    }, []);

    // RAF-throttled transform
    const scheduleTransform = useCallback(() => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
            applyTransform(false);
            rafRef.current = null;
        });
    }, [applyTransform]);

    // Fullscreen toggle
    const toggleFullscreen = useCallback(async () => {
        try {
            if (!document.fullscreenElement) {
                await modalRef.current?.requestFullscreen?.();
            } else {
                await document.exitFullscreen?.();
            }
        } catch {}
    }, []);

    // Screenshot/snapshot
    const takeSnapshot = useCallback(() => {
        if (!videoRef.current || status !== 'playing') return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        const link = document.createElement('a');
        link.download = `${camera.name}-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }, [camera.name, status]);

    // Track fullscreen state
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { 
            document.body.style.overflow = ''; 
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    useEffect(() => {
        const handleEsc = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    const handleZoomIn = useCallback(() => {
        const s = stateRef.current;
        s.zoom = Math.min(s.zoom + 0.5, MAX_ZOOM);
        const max = getMaxPan(s.zoom);
        s.panX = clamp(s.panX, -max, max);
        s.panY = clamp(s.panY, -max, max);
        applyTransform(true);
    }, [applyTransform]);

    const handleZoomOut = useCallback(() => {
        const s = stateRef.current;
        s.zoom = Math.max(s.zoom - 0.5, MIN_ZOOM);
        if (s.zoom <= 1) { s.panX = 0; s.panY = 0; }
        else {
            const max = getMaxPan(s.zoom);
            s.panX = clamp(s.panX, -max, max);
            s.panY = clamp(s.panY, -max, max);
        }
        applyTransform(true);
    }, [applyTransform]);

    const handleResetZoom = useCallback(() => {
        const s = stateRef.current;
        s.zoom = 1; s.panX = 0; s.panY = 0;
        applyTransform(true);
    }, [applyTransform]);

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const s = stateRef.current;
        s.zoom = clamp(s.zoom + (e.deltaY < 0 ? 0.25 : -0.25), MIN_ZOOM, MAX_ZOOM);
        if (s.zoom <= 1) { s.panX = 0; s.panY = 0; }
        else {
            const max = getMaxPan(s.zoom);
            s.panX = clamp(s.panX, -max, max);
            s.panY = clamp(s.panY, -max, max);
        }
        scheduleTransform();
    }, [scheduleTransform]);

    const handlePointerDown = useCallback((e) => {
        const s = stateRef.current;
        if (s.zoom <= 1) return;
        s.dragging = true;
        s.startX = e.clientX; s.startY = e.clientY;
        s.startPanX = s.panX; s.startPanY = s.panY;
        if (videoWrapperRef.current) videoWrapperRef.current.style.cursor = 'grabbing';
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = useCallback((e) => {
        const s = stateRef.current;
        if (!s.dragging) return;
        const max = getMaxPan(s.zoom);
        const factor = 0.15;
        s.panX = clamp(s.startPanX + (e.clientX - s.startX) * factor, -max, max);
        s.panY = clamp(s.startPanY + (e.clientY - s.startY) * factor, -max, max);
        scheduleTransform();
    }, [scheduleTransform]);

    const handlePointerUp = useCallback((e) => {
        const s = stateRef.current;
        s.dragging = false;
        if (videoWrapperRef.current) videoWrapperRef.current.style.cursor = s.zoom > 1 ? 'grab' : 'default';
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }, []);

    // HLS setup - simplified (stream sudah di-preload setiap 5 detik)
    useEffect(() => {
        if (isMaintenance) { setStatus('maintenance'); return; }
        if (!camera?.streams?.hls || !videoRef.current) return;

        const hlsConfig = getHLSConfig(deviceTier);

        if (Hls.isSupported()) {
            hlsRef.current = new Hls(hlsConfig);
            hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
                setStatus('playing');
                videoRef.current?.play().catch(() => {});
            });
            hlsRef.current.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    setStatus('error');
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) setErrorType('network');
                    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        if (data.details === 'fragParsingError' || data.details === 'bufferAppendError' ||
                            data.details === 'manifestIncompatibleCodecsError' ||
                            data.reason?.toLowerCase().includes('codec') ||
                            data.reason?.toLowerCase().includes('hevc')) {
                            setErrorType('codec');
                        } else setErrorType('media');
                    } else setErrorType('unknown');
                }
            });
            hlsRef.current.loadSource(camera.streams.hls);
            hlsRef.current.attachMedia(videoRef.current);
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
            videoRef.current.src = camera.streams.hls;
            videoRef.current.addEventListener('loadedmetadata', () => {
                setStatus('playing');
                videoRef.current?.play().catch(() => {});
            });
            videoRef.current.addEventListener('error', () => {
                setStatus('error'); setErrorType('media');
            });
        }

        return () => {
            if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
        };
    }, [camera, isMaintenance]);

    const getErrorMessage = useCallback(() => {
        const errors = {
            codec: { title: 'Codec Tidak Didukung', desc: 'Browser Anda tidak mendukung codec H.265/HEVC. Coba browser lain.', color: 'yellow' },
            network: { title: 'Koneksi Gagal', desc: 'Tidak dapat terhubung ke server stream.', color: 'orange' },
            default: { title: 'Stream Tidak Tersedia', desc: 'Terjadi kesalahan saat memuat stream.', color: 'red' }
        };
        return errors[errorType] || errors.default;
    }, [errorType]);

    const errorInfo = getErrorMessage();

    return (
        <div 
            className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4 bg-black/90" 
            onClick={onClose}
        >
            <div 
                ref={modalRef}
                className="bg-gray-900 rounded-xl w-full max-w-4xl overflow-hidden shadow-2xl border border-gray-800" 
                onClick={(e) => e.stopPropagation()}
            >
                {/* Video Container - optimized dengan pointer events */}
                <div 
                    className="relative bg-black aspect-video overflow-hidden"
                    onWheel={handleWheel}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                    style={{ touchAction: 'none' }}
                >
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                            <div className={`w-10 h-10 border-2 border-gray-700 border-t-sky-500 rounded-full ${isLowEnd ? '' : 'animate-spin'}`}
                                 style={isLowEnd ? { animation: 'spin 1.5s linear infinite' } : {}} />
                            <span className="text-gray-400 text-sm">Menghubungkan...</span>
                        </div>
                    )}
                    
                    {status === 'maintenance' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-950/50 z-10">
                            <svg className="w-16 h-16 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"/>
                            </svg>
                            <div className="text-center px-4">
                                <h4 className="text-red-400 font-bold text-lg">Dalam Perbaikan</h4>
                                <p className="text-gray-400 text-sm mt-1">Kamera ini sedang dalam masa perbaikan/maintenance</p>
                            </div>
                        </div>
                    )}
                    
                    {status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 z-10">
                            <svg className={`w-10 h-10 text-${errorInfo.color}-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                            </svg>
                            <div className="text-center">
                                <h4 className="text-gray-200 font-semibold">{errorInfo.title}</h4>
                                <p className="text-gray-400 text-sm mt-1 max-w-md">{errorInfo.desc}</p>
                            </div>
                        </div>
                    )}
                    
                    {/* Video with zoom/pan transform - optimized */}
                    {!isMaintenance && (
                        <div 
                            ref={videoWrapperRef}
                            className="w-full h-full"
                            style={{ 
                                transformOrigin: 'center center',
                                willChange: 'transform',
                                cursor: stateRef.current.zoom > 1 ? 'grab' : 'default'
                            }}
                        >
                            <video ref={videoRef} className="w-full h-full object-contain pointer-events-none" muted playsInline autoPlay />
                        </div>
                    )}

                    {/* Close button */}
                    <button 
                        onClick={onClose} 
                        className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg z-20"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>

                    {/* Zoom hint */}
                    {zoomDisplay > 1 && (
                        <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white text-xs rounded-lg z-20">
                            Geser untuk pan
                        </div>
                    )}
                </div>

                {/* Info Panel */}
                <div className="p-3 border-t border-gray-800">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="text-white font-bold text-sm sm:text-base truncate flex-1">{camera.name}</h3>
                        
                        {/* Controls: Zoom + Screenshot + Fullscreen */}
                        {!isMaintenance && status !== 'error' && (
                            <div className="flex items-center gap-1 shrink-0">
                                {/* Zoom Controls */}
                                <div className="flex items-center gap-0.5 bg-gray-800 rounded-lg p-0.5">
                                    <button
                                        onClick={handleZoomOut}
                                        disabled={zoomDisplay <= MIN_ZOOM}
                                        className="p-1.5 hover:bg-gray-700 disabled:opacity-30 rounded text-white transition-colors"
                                        title="Zoom Out"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"/>
                                        </svg>
                                    </button>
                                    <span className="text-white text-[10px] font-medium w-8 text-center">{Math.round(zoomDisplay * 100)}%</span>
                                    <button
                                        onClick={handleZoomIn}
                                        disabled={zoomDisplay >= MAX_ZOOM}
                                        className="p-1.5 hover:bg-gray-700 disabled:opacity-30 rounded text-white transition-colors"
                                        title="Zoom In"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"/>
                                        </svg>
                                    </button>
                                    {zoomDisplay > 1 && (
                                        <button
                                            onClick={handleResetZoom}
                                            className="p-1.5 hover:bg-gray-700 rounded text-white transition-colors"
                                            title="Reset Zoom"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                                            </svg>
                                        </button>
                                    )}
                                </div>
                                
                                {/* Screenshot Button */}
                                {status === 'playing' && (
                                    <button
                                        onClick={takeSnapshot}
                                        className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
                                        title="Ambil Screenshot"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                                            <circle cx="8.5" cy="8.5" r="1.5"/>
                                            <path d="M21 15l-5-5L5 21"/>
                                        </svg>
                                    </button>
                                )}
                                
                                {/* Fullscreen Button */}
                                <button
                                    onClick={toggleFullscreen}
                                    className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
                                    title={isFullscreen ? "Keluar Fullscreen" : "Fullscreen"}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        {isFullscreen ? (
                                            <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>
                                        ) : (
                                            <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                                        )}
                                    </svg>
                                </button>
                            </div>
                        )}
                    </div>
                    
                    {/* Row 2: Location + Area + Status badges */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            {camera.location && (
                                <span className="text-gray-400 text-xs flex items-center gap-1 truncate">
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                        <circle cx="12" cy="11" r="3"/>
                                    </svg>
                                    <span className="truncate">{camera.location}</span>
                                </span>
                            )}
                            {camera.area_name && (
                                <span className="px-1.5 py-0.5 bg-sky-500/20 text-sky-400 rounded text-[10px] font-medium shrink-0">
                                    {camera.area_name}
                                </span>
                            )}
                        </div>
                        
                        {/* Status badges - pojok kanan bawah */}
                        <div className="flex items-center gap-1 shrink-0">
                            {isMaintenance ? (
                                <span className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold flex items-center gap-1">
                                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                                    </svg>
                                    Perbaikan
                                </span>
                            ) : (
                                <>
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"/>
                                    <span className={`px-1.5 py-0.5 rounded text-white text-[10px] font-bold ${isTunnel ? 'bg-orange-500' : 'bg-emerald-500'}`}>
                                        {isTunnel ? 'Tunnel' : 'Stabil'}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
VideoModal.displayName = 'VideoModal';

// Map controller
function MapController({ center, zoom, bounds }) {
    const map = useMap();
    
    useEffect(() => {
        if (bounds?.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        } else if (center) {
            map.setView(center, zoom || 15);
        }
    }, [map, center, zoom, bounds]);
    
    return null;
}

// Camera Marker - dengan support untuk grouped markers dan status
const CameraMarker = memo(({ camera, onClick }) => {
    if (!hasValidCoords(camera)) return null;
    // Gunakan display coordinates jika ada (untuk offset)
    const lat = camera._displayLat ?? parseFloat(camera.latitude);
    const lng = camera._displayLng ?? parseFloat(camera.longitude);
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
    const status = camera.status || 'active';
    
    return (
        <Marker 
            position={[lat, lng]} 
            icon={createCameraIcon(status, isTunnel)}
            eventHandlers={{ click: () => onClick(camera) }}
        />
    );
});
CameraMarker.displayName = 'CameraMarker';

// Main MapView
const MapView = memo(({ 
    cameras = [], 
    areas = [],
    defaultCenter = [-7.1507, 111.8815],
    defaultZoom = 11, // Zoom level untuk skala kabupaten
    className = '',
    focusedCameraId = null, // ID kamera yang akan difokuskan
    onFocusHandled = null, // Callback setelah fokus ditangani
}) => {
    const [selectedArea, setSelectedArea] = useState('all');
    const [modalCamera, setModalCamera] = useState(null);
    const [mapKey, setMapKey] = useState(0);
    const [mapSettings, setMapSettings] = useState({ 
        latitude: defaultCenter[0], 
        longitude: defaultCenter[1], 
        zoom: defaultZoom, 
        name: 'Semua Lokasi' 
    });

    // Load map settings from backend
    useEffect(() => {
        settingsService.getMapCenter().then(res => {
            if (res.success && res.data) {
                setMapSettings(res.data);
            }
        }).catch(() => {});
    }, []);

    // Handle focused camera from search
    useEffect(() => {
        if (focusedCameraId) {
            const camera = cameras.find(c => c.id === focusedCameraId);
            if (camera && hasValidCoords(camera)) {
                // Set area filter to show the camera
                if (camera.area_name && selectedArea !== camera.area_name && selectedArea !== 'all') {
                    setSelectedArea('all');
                }
                // Open modal for the camera
                setModalCamera(camera);
                // Trigger map rerender to focus on camera
                setMapKey(prev => prev + 1);
                // Notify parent that focus has been handled
                onFocusHandled?.();
            }
        }
    }, [focusedCameraId, cameras, onFocusHandled, selectedArea]);

    const camerasWithCoords = useMemo(() => cameras.filter(hasValidCoords), [cameras]);

    const areaNames = useMemo(() => {
        const set = new Set();
        cameras.forEach(c => c.area_name && set.add(c.area_name));
        return Array.from(set).sort();
    }, [cameras]);

    const filtered = useMemo(() => {
        let result;
        if (selectedArea === 'all') {
            result = camerasWithCoords;
        } else {
            result = camerasWithCoords.filter(c => c.area_name === selectedArea);
        }
        // Terapkan offset untuk marker yang bertumpuk
        return applyMarkerOffset(result);
    }, [camerasWithCoords, selectedArea]);

    const stats = useMemo(() => {
        const maintenance = filtered.filter(c => c.status === 'maintenance').length;
        const stabil = filtered.filter(c => c.status !== 'maintenance' && !c.is_tunnel).length;
        const tunnel = filtered.filter(c => c.status !== 'maintenance' && (c.is_tunnel === 1 || c.is_tunnel === true)).length;
        return { stabil, tunnel, maintenance, total: filtered.length };
    }, [filtered]);

    const { center, zoom, bounds } = useMemo(() => {
        // Jika ada focused camera, prioritaskan ke kamera tersebut
        if (focusedCameraId) {
            const focusedCamera = camerasWithCoords.find(c => c.id === focusedCameraId);
            if (focusedCamera) {
                return {
                    center: [parseFloat(focusedCamera.latitude), parseFloat(focusedCamera.longitude)],
                    zoom: 17, // Zoom dekat untuk fokus ke kamera
                    bounds: null
                };
            }
        }
        
        // Jika area spesifik dipilih, gunakan koordinat area tersebut
        if (selectedArea !== 'all') {
            const areaData = areas.find(a => a.name === selectedArea);
            if (areaData?.latitude && areaData?.longitude) {
                return {
                    center: [parseFloat(areaData.latitude), parseFloat(areaData.longitude)],
                    zoom: 15, // Zoom level untuk desa
                    bounds: null
                };
            }
            // Area tidak punya koordinat, tapi tetap filter kamera
            // Jika ada kamera di area ini, gunakan bounds kamera
            const areaCameras = camerasWithCoords.filter(c => c.area_name === selectedArea);
            if (areaCameras.length > 0) {
                const cameraBounds = L.latLngBounds(areaCameras.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)]));
                return { center: null, zoom: null, bounds: cameraBounds };
            }
            // Area tidak punya koordinat dan tidak ada kamera, fallback ke default
        }
        
        // "Semua Lokasi" - gunakan settings dengan zoom dari settings
        if (selectedArea === 'all' && mapSettings.latitude && mapSettings.longitude) {
            return {
                center: [mapSettings.latitude, mapSettings.longitude],
                zoom: mapSettings.zoom || 13, // Gunakan zoom dari settings
                bounds: null
            };
        }
        
        // Fallback
        return { 
            center: [mapSettings.latitude || defaultCenter[0], mapSettings.longitude || defaultCenter[1]], 
            zoom: mapSettings.zoom || defaultZoom,
            bounds: null 
        };
    }, [camerasWithCoords, selectedArea, areas, defaultCenter, defaultZoom, mapSettings, focusedCameraId]);

    const openModal = useCallback((camera) => setModalCamera(camera), []);
    const closeModal = useCallback(() => setModalCamera(null), []);

    const handleAreaChange = (e) => {
        setSelectedArea(e.target.value);
        setMapKey(prev => prev + 1);
    };

    if (cameras.length === 0 || camerasWithCoords.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl min-h-[400px] ${className}`}>
                <div className="text-center p-6">
                    <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                        {cameras.length === 0 ? 'Belum ada kamera' : 'Koordinat kamera belum diatur'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative w-full h-full min-h-[450px] rounded-xl overflow-hidden ${className}`}>
            {/* Map */}
            <MapContainer
                key={mapKey}
                center={center || defaultCenter}
                zoom={defaultZoom}
                className="w-full h-full"
                style={{ minHeight: '450px', zIndex: 1 }}
                zoomControl={false}
            >
                <TileLayer
                    attribution='&copy; <a href="https://rafnet.my.id" target="_blank">RAF NET</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <ZoomControl position="bottomright" />
                <MapController center={center} zoom={zoom} bounds={bounds} />
                {filtered.map(camera => (
                    <CameraMarker key={camera.id} camera={camera} onClick={openModal} />
                ))}
            </MapContainer>

            {/* Filter & Stats - Top */}
            <div className="absolute top-3 left-3 right-3 z-[1000] flex items-start justify-between gap-2 flex-wrap">
                {/* Area Filter */}
                <select
                    value={selectedArea}
                    onChange={handleAreaChange}
                    className="px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg shadow-lg text-sm font-medium border-0 focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
                >
                    <option value="all">{mapSettings.name || 'Semua Lokasi'} ({camerasWithCoords.length})</option>
                    {areaNames.map(area => (
                        <option key={area} value={area}>
                            {area} ({camerasWithCoords.filter(c => c.area_name === area).length})
                        </option>
                    ))}
                </select>

                {/* Stats */}
                <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg text-sm">
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"/>
                        <span className="font-medium text-gray-700 dark:text-gray-200">{stats.stabil}</span>
                    </span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-500"/>
                        <span className="font-medium text-gray-700 dark:text-gray-200">{stats.tunnel}</span>
                    </span>
                    {stats.maintenance > 0 && (
                        <>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-red-500"/>
                                <span className="font-medium text-gray-700 dark:text-gray-200">{stats.maintenance}</span>
                            </span>
                        </>
                    )}
                </div>
            </div>

            {/* Legend - Bottom Left - posisi lebih ke pojok bawah */}
            <div className="absolute bottom-3 left-3 z-[1000]">
                <div className="px-2.5 py-1.5 bg-white/95 dark:bg-gray-800/95 rounded-lg shadow-lg text-[10px]">
                    <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"/>
                            <span className="text-gray-600 dark:text-gray-300">Stabil</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-orange-500"/>
                            <span className="text-gray-600 dark:text-gray-300">Tunnel</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-500"/>
                            <span className="text-gray-600 dark:text-gray-300">Perbaikan</span>
                        </span>
                    </div>
                </div>
            </div>

            {modalCamera && <VideoModal camera={modalCamera} onClose={closeModal} />}
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
