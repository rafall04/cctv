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

// Video Modal - dengan error handling codec, status maintenance, dan zoom controls
const VideoModal = memo(({ camera, onClose }) => {
    const videoRef = useRef(null);
    const videoWrapperRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [errorType, setErrorType] = useState(null); // 'codec', 'network', 'timeout', 'unknown'
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 }); // dalam persentase
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    const isMaintenance = camera.status === 'maintenance';
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;

    const MIN_ZOOM = 1;
    const MAX_ZOOM = 4;

    // Helper functions - sama seperti di LandingPage
    const getMaxPan = (z) => z <= 1 ? 0 : ((z - 1) / (2 * z)) * 100;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    useEffect(() => {
        const handleEsc = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    // Zoom handlers
    const handleZoomIn = () => {
        setZoom(prev => {
            const newZoom = Math.min(prev + 0.5, MAX_ZOOM);
            // Clamp pan saat zoom berubah
            const max = getMaxPan(newZoom);
            setPan(p => ({ 
                x: clamp(p.x, -max, max), 
                y: clamp(p.y, -max, max) 
            }));
            return newZoom;
        });
    };

    const handleZoomOut = () => {
        setZoom(prev => {
            const newZoom = Math.max(prev - 0.5, MIN_ZOOM);
            if (newZoom <= 1) {
                setPan({ x: 0, y: 0 }); // Reset pan when zoom is 1
            } else {
                const max = getMaxPan(newZoom);
                setPan(p => ({ 
                    x: clamp(p.x, -max, max), 
                    y: clamp(p.y, -max, max) 
                }));
            }
            return newZoom;
        });
    };

    const handleResetZoom = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    // Mouse wheel zoom
    const handleWheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.25 : -0.25;
        setZoom(prev => {
            const newZoom = clamp(prev + delta, MIN_ZOOM, MAX_ZOOM);
            if (newZoom <= 1) {
                setPan({ x: 0, y: 0 });
            } else {
                const max = getMaxPan(newZoom);
                setPan(p => ({ 
                    x: clamp(p.x, -max, max), 
                    y: clamp(p.y, -max, max) 
                }));
            }
            return newZoom;
        });
    };

    // Pan handlers (drag to move when zoomed) - menggunakan persentase seperti LandingPage
    const handleMouseDown = (e) => {
        if (zoom > 1) {
            setIsDragging(true);
            dragStart.current = { 
                x: e.clientX, 
                y: e.clientY, 
                panX: pan.x, 
                panY: pan.y 
            };
        }
    };

    const handleMouseMove = (e) => {
        if (isDragging && zoom > 1) {
            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;
            const max = getMaxPan(zoom);
            
            // Factor untuk konversi pixel ke persentase (sesuaikan dengan container)
            const factor = 0.15;
            const newX = clamp(dragStart.current.panX + dx * factor, -max, max);
            const newY = clamp(dragStart.current.panY + dy * factor, -max, max);
            setPan({ x: newX, y: newY });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Touch handlers for mobile - menggunakan persentase
    const handleTouchStart = (e) => {
        if (zoom > 1 && e.touches.length === 1) {
            setIsDragging(true);
            dragStart.current = { 
                x: e.touches[0].clientX, 
                y: e.touches[0].clientY, 
                panX: pan.x, 
                panY: pan.y 
            };
        }
    };

    const handleTouchMove = (e) => {
        if (isDragging && zoom > 1 && e.touches.length === 1) {
            const dx = e.touches[0].clientX - dragStart.current.x;
            const dy = e.touches[0].clientY - dragStart.current.y;
            const max = getMaxPan(zoom);
            
            const factor = 0.15;
            const newX = clamp(dragStart.current.panX + dx * factor, -max, max);
            const newY = clamp(dragStart.current.panY + dy * factor, -max, max);
            setPan({ x: newX, y: newY });
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        // Jika maintenance, tidak perlu load stream
        if (isMaintenance) {
            setStatus('maintenance');
            return;
        }

        if (!camera?.streams?.hls || !videoRef.current) return;

        // Config HLS berdasarkan device tier
        const hlsConfig = isLowEnd ? {
            enableWorker: false,
            lowLatencyMode: false,
            backBufferLength: 5,
            maxBufferLength: 10,
            maxMaxBufferLength: 20,
        } : {
            enableWorker: false,
            lowLatencyMode: false,
            backBufferLength: 10,
            maxBufferLength: 15,
        };

        // Timeout untuk loading
        const loadTimeout = setTimeout(() => {
            if (status === 'loading') {
                setStatus('error');
                setErrorType('timeout');
            }
        }, 15000); // 15 detik timeout

        if (Hls.isSupported()) {
            hlsRef.current = new Hls(hlsConfig);
            
            hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
                clearTimeout(loadTimeout);
                setStatus('playing');
                videoRef.current?.play().catch(() => {});
            });
            
            hlsRef.current.on(Hls.Events.ERROR, (_, data) => {
                console.log('HLS Error:', data);
                if (data.fatal) {
                    clearTimeout(loadTimeout);
                    setStatus('error');
                    
                    // Deteksi jenis error
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        setErrorType('network');
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        // Cek apakah error codec (H.265/HEVC tidak didukung)
                        if (data.details === 'fragParsingError' || 
                            data.details === 'bufferAppendError' ||
                            data.reason?.includes('codec') ||
                            data.reason?.includes('HEVC') ||
                            data.reason?.includes('h265')) {
                            setErrorType('codec');
                        } else {
                            setErrorType('media');
                        }
                    } else {
                        setErrorType('unknown');
                    }
                }
            });
            
            hlsRef.current.loadSource(camera.streams.hls);
            hlsRef.current.attachMedia(videoRef.current);
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
            videoRef.current.src = camera.streams.hls;
            videoRef.current.addEventListener('loadedmetadata', () => {
                clearTimeout(loadTimeout);
                setStatus('playing');
                videoRef.current?.play().catch(() => {});
            });
            videoRef.current.addEventListener('error', () => {
                clearTimeout(loadTimeout);
                setStatus('error');
                setErrorType('media');
            });
        }

        return () => {
            clearTimeout(loadTimeout);
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [camera, isMaintenance]);

    // Error messages berdasarkan tipe
    const getErrorMessage = () => {
        switch (errorType) {
            case 'codec':
                return {
                    title: 'Codec Tidak Didukung',
                    desc: 'Browser tidak mendukung codec H.265/HEVC. Gunakan browser Chrome/Firefox terbaru atau hubungi admin.',
                    icon: (
                        <svg className="w-10 h-10 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                        </svg>
                    )
                };
            case 'network':
                return {
                    title: 'Koneksi Gagal',
                    desc: 'Tidak dapat terhubung ke server stream. Periksa koneksi internet Anda.',
                    icon: (
                        <svg className="w-10 h-10 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
                        </svg>
                    )
                };
            case 'timeout':
                return {
                    title: 'Waktu Habis',
                    desc: 'Stream terlalu lama merespons. Kamera mungkin sedang offline atau jaringan lambat.',
                    icon: (
                        <svg className="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                    )
                };
            default:
                return {
                    title: 'Stream Tidak Tersedia',
                    desc: 'Terjadi kesalahan saat memuat stream. Coba lagi nanti.',
                    icon: (
                        <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                    )
                };
        }
    };

    const errorInfo = getErrorMessage();

    return (
        <div 
            className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4 bg-black/90" 
            onClick={onClose}
        >
            <div 
                className="bg-gray-900 rounded-xl w-full max-w-4xl overflow-hidden shadow-2xl border border-gray-800" 
                onClick={(e) => e.stopPropagation()}
            >
                {/* Video Container */}
                <div 
                    className="relative bg-black aspect-video overflow-hidden"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                            <div className="w-10 h-10 border-2 border-gray-700 border-t-sky-500 rounded-full animate-spin"/>
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
                            {errorInfo.icon}
                            <div className="text-center">
                                <h4 className="text-gray-200 font-semibold">{errorInfo.title}</h4>
                                <p className="text-gray-400 text-sm mt-1 max-w-md">{errorInfo.desc}</p>
                            </div>
                        </div>
                    )}
                    
                    {/* Video with zoom/pan transform */}
                    {!isMaintenance && (
                        <div 
                            ref={videoWrapperRef}
                            className="w-full h-full transition-transform duration-100"
                            style={{ 
                                transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
                                transformOrigin: 'center center',
                                touchAction: 'none',
                                willChange: 'transform',
                                cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
                            }}
                        >
                            <video ref={videoRef} className="w-full h-full object-contain pointer-events-none" muted playsInline autoPlay />
                        </div>
                    )}

                    {/* Close button - top right */}
                    <button 
                        onClick={onClose} 
                        className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg z-20"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>

                    {/* Zoom hint - show when zoomed */}
                    {zoom > 1 && (
                        <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white text-xs rounded-lg z-20">
                            Drag untuk geser • Scroll untuk zoom
                        </div>
                    )}
                </div>

                {/* Info Panel - dengan badges dan zoom controls */}
                <div className="p-4 border-t border-gray-800">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h3 className="text-white font-bold text-base sm:text-lg truncate">{camera.name}</h3>
                                {/* Status badges */}
                                {isMaintenance ? (
                                    <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center gap-1 shrink-0">
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                                        </svg>
                                        Perbaikan
                                    </span>
                                ) : (
                                    <>
                                        <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center gap-1 shrink-0">
                                            <span className="w-1.5 h-1.5 rounded-full bg-white"/>
                                            LIVE
                                        </span>
                                        <span className={`px-2 py-0.5 rounded-full text-white text-xs font-bold shrink-0 ${isTunnel ? 'bg-orange-500' : 'bg-emerald-500'}`}>
                                            {isTunnel ? 'Tunnel' : 'Stabil'}
                                        </span>
                                    </>
                                )}
                            </div>
                            {camera.location && (
                                <p className="text-gray-400 text-sm flex items-center gap-1.5 truncate">
                                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                        <circle cx="12" cy="11" r="3"/>
                                    </svg>
                                    {camera.location}
                                </p>
                            )}
                        </div>
                        
                        {/* Zoom Controls - di info panel */}
                        {!isMaintenance && status !== 'error' && (
                            <div className="flex items-center gap-1 bg-gray-800 rounded-xl p-1 shrink-0">
                                <button
                                    onClick={handleZoomOut}
                                    disabled={zoom <= MIN_ZOOM}
                                    className="p-2 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
                                    title="Zoom Out"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"/>
                                    </svg>
                                </button>
                                <button
                                    onClick={handleResetZoom}
                                    className="px-2 py-1 hover:bg-gray-700 text-white rounded-lg text-xs font-medium min-w-[48px] text-center transition-colors"
                                    title="Reset Zoom"
                                >
                                    {Math.round(zoom * 100)}%
                                </button>
                                <button
                                    onClick={handleZoomIn}
                                    disabled={zoom >= MAX_ZOOM}
                                    className="p-2 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
                                    title="Zoom In"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"/>
                                    </svg>
                                </button>
                                {zoom > 1 && (
                                    <button
                                        onClick={handleResetZoom}
                                        className="p-2 hover:bg-gray-700 rounded-lg text-white transition-colors ml-1"
                                        title="Reset"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                                        </svg>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    
                    {/* Area badge - row terpisah jika ada */}
                    {camera.area_name && (
                        <div className="mt-2 pt-2 border-t border-gray-800">
                            <span className="px-2.5 py-1 bg-sky-500/20 text-sky-400 rounded-lg text-xs font-semibold">
                                {camera.area_name}
                            </span>
                        </div>
                    )}
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
    }, [camerasWithCoords, selectedArea, areas, defaultCenter, defaultZoom, mapSettings]);

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
                    attribution='&copy; OSM'
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

            {/* Legend - Bottom Left */}
            <div className="absolute bottom-12 left-3 z-[1000]">
                <div className="px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg text-xs">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-emerald-500"/>
                            <span className="text-gray-600 dark:text-gray-300">Stabil</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-orange-500"/>
                            <span className="text-gray-600 dark:text-gray-300">Tunnel</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-red-500"/>
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
