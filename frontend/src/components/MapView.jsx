/**
 * MapView Component - Modern CCTV Map
 * Klik marker → langsung modal besar
 * Filter area di dalam map (UI bagus)
 * Warna marker: hijau = stabil, orange = tunnel
 * Nama CCTV di bawah video agar zoom tidak terganggu
 */

import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import Hls from 'hls.js';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Camera marker icon - warna berbeda untuk tunnel vs stabil
const createCameraIcon = (isTunnel = false) => {
    const color = isTunnel ? '#f97316' : '#10b981';
    return L.divIcon({
        className: 'camera-marker',
        html: `<div style="
            width: 28px;
            height: 28px;
            background: ${color};
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s;
        ">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
    });
};

// Check valid coordinates
const hasValidCoords = (c) => {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
};

// Video Modal - Nama CCTV di bawah video
const VideoModal = memo(({ camera, onClose }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('loading');

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    useEffect(() => {
        const handleEsc = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    useEffect(() => {
        if (!camera?.streams?.hls || !videoRef.current) return;

        if (Hls.isSupported()) {
            hlsRef.current = new Hls({
                enableWorker: false,
                lowLatencyMode: false,
                backBufferLength: 15,
                maxBufferLength: 20,
            });
            hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
                setStatus('playing');
                videoRef.current?.play().catch(() => {});
            });
            hlsRef.current.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) setStatus('error');
            });
            hlsRef.current.loadSource(camera.streams.hls);
            hlsRef.current.attachMedia(videoRef.current);
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
            videoRef.current.src = camera.streams.hls;
            videoRef.current.addEventListener('loadedmetadata', () => {
                setStatus('playing');
                videoRef.current?.play().catch(() => {});
            });
        }

        return () => {
            hlsRef.current?.destroy();
            hlsRef.current = null;
        };
    }, [camera]);

    const toggleFullscreen = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            videoRef.current?.requestFullscreen();
        }
    };

    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div 
                className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Video Container - Clean, no overlay text */}
                <div className="relative bg-black aspect-video">
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center">
                                <div className="w-12 h-12 border-3 border-white/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3"/>
                                <p className="text-white/60 text-sm">Memuat stream...</p>
                            </div>
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center text-white/80">
                                <svg className="w-16 h-16 mx-auto mb-3 text-red-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                </svg>
                                <p className="text-sm">Stream tidak tersedia</p>
                            </div>
                        </div>
                    )}
                    <video ref={videoRef} className="w-full h-full object-contain" muted playsInline controls />
                    
                    {/* Only badges on video - minimal */}
                    <div className="absolute top-3 left-3 flex items-center gap-2">
                        <span className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500 rounded-lg text-white text-xs font-semibold shadow-lg">
                            <span className="w-2 h-2 bg-white rounded-full animate-pulse"/>
                            LIVE
                        </span>
                        {isTunnel && (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-500 rounded-lg text-white text-xs font-semibold shadow-lg">
                                ⚠️ Tunnel
                            </span>
                        )}
                    </div>

                    {/* Close & Fullscreen buttons */}
                    <div className="absolute top-3 right-3 flex items-center gap-2">
                        <button
                            onClick={toggleFullscreen}
                            className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors"
                            title="Fullscreen"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                            </svg>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 bg-black/50 hover:bg-red-500 text-white rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Camera Info - Di bawah video */}
                <div className="p-4 bg-gray-900">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-white font-bold text-lg truncate">{camera.name}</h3>
                            {camera.location && (
                                <p className="text-gray-400 text-sm flex items-center gap-1.5 mt-1">
                                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                    </svg>
                                    <span className="truncate">{camera.location}</span>
                                </p>
                            )}
                            {camera.description && (
                                <p className="text-gray-500 text-sm mt-2">{camera.description}</p>
                            )}
                        </div>
                        {camera.area_name && (
                            <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-500/20 text-sky-400 rounded-lg text-sm font-medium">
                                {camera.area_name}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});
VideoModal.displayName = 'VideoModal';

// Map controller for bounds
function MapController({ bounds }) {
    const map = useMap();
    useEffect(() => {
        if (bounds?.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
    }, [bounds, map]);
    return null;
}

// Camera Marker
const CameraMarker = memo(({ camera, onClick }) => {
    if (!hasValidCoords(camera)) return null;
    
    const lat = parseFloat(camera.latitude);
    const lng = parseFloat(camera.longitude);
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
    
    return (
        <Marker 
            position={[lat, lng]} 
            icon={createCameraIcon(isTunnel)}
            eventHandlers={{
                click: () => onClick(camera)
            }}
        />
    );
});
CameraMarker.displayName = 'CameraMarker';

// Main MapView
const MapView = memo(({ 
    cameras = [], 
    defaultCenter = [-7.1507, 111.8815],
    defaultZoom = 13,
    className = '',
}) => {
    const [selectedArea, setSelectedArea] = useState('all');
    const [showAreaDropdown, setShowAreaDropdown] = useState(false);
    const [modalCamera, setModalCamera] = useState(null);
    const mapRef = useRef(null);
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setShowAreaDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Cameras with valid coordinates
    const camerasWithCoords = useMemo(() => cameras.filter(hasValidCoords), [cameras]);

    // Unique areas
    const areas = useMemo(() => {
        const set = new Set();
        cameras.forEach(c => c.area_name && set.add(c.area_name));
        return Array.from(set).sort();
    }, [cameras]);

    // Filtered cameras by area
    const filtered = useMemo(() => {
        if (selectedArea === 'all') return camerasWithCoords;
        return camerasWithCoords.filter(c => c.area_name === selectedArea);
    }, [camerasWithCoords, selectedArea]);

    // Bounds
    const bounds = useMemo(() => {
        if (filtered.length === 0) return null;
        return L.latLngBounds(filtered.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)]));
    }, [filtered]);

    // Map center
    const center = useMemo(() => {
        if (filtered.length === 0) return defaultCenter;
        const avgLat = filtered.reduce((s, c) => s + parseFloat(c.latitude), 0) / filtered.length;
        const avgLng = filtered.reduce((s, c) => s + parseFloat(c.longitude), 0) / filtered.length;
        return [avgLat, avgLng];
    }, [filtered, defaultCenter]);

    const openModal = useCallback((camera) => {
        setModalCamera(camera);
    }, []);

    const closeModal = useCallback(() => {
        setModalCamera(null);
    }, []);

    const selectArea = (area) => {
        setSelectedArea(area);
        setShowAreaDropdown(false);
    };

    const getSelectedAreaName = () => {
        if (selectedArea === 'all') return 'Semua Area';
        return selectedArea;
    };

    // No cameras
    if (cameras.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800/50 rounded-2xl min-h-[400px] ${className}`}>
                <div className="text-center p-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                        </svg>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">Belum ada kamera</p>
                </div>
            </div>
        );
    }

    // No coordinates
    if (camerasWithCoords.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800/50 rounded-2xl min-h-[400px] ${className}`}>
                <div className="text-center p-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                        </svg>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 font-medium mb-1">Koordinat Belum Diatur</p>
                    <p className="text-gray-400 dark:text-gray-500 text-sm">Tambahkan koordinat pada kamera di panel admin</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative w-full h-full min-h-[500px] ${className}`}>
            {/* Map */}
            <MapContainer
                ref={mapRef}
                center={center}
                zoom={defaultZoom}
                className="w-full h-full rounded-2xl"
                style={{ minHeight: '500px', zIndex: 0 }}
            >
                <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController bounds={bounds} />
                {filtered.map(camera => (
                    <CameraMarker
                        key={camera.id}
                        camera={camera}
                        onClick={openModal}
                    />
                ))}
            </MapContainer>

            {/* Top Left - Area Filter (Beautiful UI) */}
            {areas.length > 0 && (
                <div className="absolute top-3 left-3 z-[1000]" ref={dropdownRef}>
                    <button
                        onClick={() => setShowAreaDropdown(!showAreaDropdown)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 hover:border-sky-500 dark:hover:border-sky-500 transition-colors"
                    >
                        <svg className="w-4 h-4 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                            <circle cx="12" cy="11" r="3"/>
                        </svg>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                            {getSelectedAreaName()}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                            ({filtered.length})
                        </span>
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${showAreaDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M19 9l-7 7-7-7"/>
                        </svg>
                    </button>

                    {/* Dropdown Menu */}
                    {showAreaDropdown && (
                        <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="p-2">
                                <button
                                    onClick={() => selectArea('all')}
                                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
                                        selectedArea === 'all'
                                            ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200'
                                    }`}
                                >
                                    <span className="flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                        </svg>
                                        <span className="text-sm font-medium">Semua Area</span>
                                    </span>
                                    <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                                        {camerasWithCoords.length}
                                    </span>
                                </button>
                                
                                <div className="my-2 border-t border-gray-100 dark:border-gray-700"/>
                                
                                {areas.map(area => {
                                    const count = camerasWithCoords.filter(c => c.area_name === area).length;
                                    return (
                                        <button
                                            key={area}
                                            onClick={() => selectArea(area)}
                                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
                                                selectedArea === area
                                                    ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200'
                                            }`}
                                        >
                                            <span className="flex items-center gap-2">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                                                </svg>
                                                <span className="text-sm font-medium">{area}</span>
                                            </span>
                                            <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                                                {count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Top Right - Camera Count */}
            <div className="absolute top-3 right-3 z-[1000]">
                <div className="flex items-center gap-2 px-3 py-2 bg-white/95 dark:bg-gray-800/95 backdrop-blur rounded-xl shadow-lg">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"/>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {filtered.length} Kamera
                    </span>
                </div>
            </div>

            {/* Video Modal */}
            {modalCamera && (
                <VideoModal camera={modalCamera} onClose={closeModal} />
            )}

            {/* Custom Styles */}
            <style>{`
                .camera-marker:hover > div {
                    transform: scale(1.15);
                }
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes zoom-in-95 {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                @keyframes slide-in-from-top-2 {
                    from { transform: translateY(-8px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .animate-in {
                    animation: fade-in 0.2s ease-out, zoom-in-95 0.2s ease-out;
                }
                .slide-in-from-top-2 {
                    animation: slide-in-from-top-2 0.2s ease-out;
                }
            `}</style>
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
