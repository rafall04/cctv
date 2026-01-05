/**
 * MapView Component - Style seperti CCTV Jogja
 * Klik marker → popup preview, klik lagi → modal fullscreen
 */

import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
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

// Camera marker icon
const createCameraIcon = (isTunnel = false) => {
    const color = isTunnel ? '#f97316' : '#3b82f6';
    return L.divIcon({
        className: 'camera-marker',
        html: `<div style="width:32px;height:32px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;cursor:pointer;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -20],
    });
};

// Check valid coordinates
const hasValidCoords = (c) => {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
};

// Mini Video Preview in Popup
const MiniPreview = memo(({ streamUrl }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;
        
        if (Hls.isSupported()) {
            hlsRef.current = new Hls({
                enableWorker: false,
                maxBufferLength: 10,
                maxMaxBufferLength: 20,
            });
            hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
                setLoaded(true);
                videoRef.current?.play().catch(() => {});
            });
            hlsRef.current.loadSource(streamUrl);
            hlsRef.current.attachMedia(videoRef.current);
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
            videoRef.current.src = streamUrl;
            videoRef.current.addEventListener('loadedmetadata', () => {
                setLoaded(true);
                videoRef.current?.play().catch(() => {});
            });
        }

        return () => {
            hlsRef.current?.destroy();
            hlsRef.current = null;
        };
    }, [streamUrl]);

    return (
        <div className="relative w-full aspect-video bg-gray-900 rounded overflow-hidden">
            {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                </div>
            )}
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 bg-red-500 rounded text-white text-[9px] font-bold">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"/>
                LIVE
            </div>
        </div>
    );
});
MiniPreview.displayName = 'MiniPreview';

// Full Video Modal (seperti CCTV Jogja)
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

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <div 
                className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-3xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate pr-4">
                        {camera.name}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                {/* Video */}
                <div className="relative bg-black aspect-video">
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center">
                                <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-2"/>
                                <p className="text-white/70 text-sm">Memuat stream...</p>
                            </div>
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center text-white">
                                <svg className="w-12 h-12 mx-auto mb-2 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                                </svg>
                                <p>Stream tidak tersedia</p>
                            </div>
                        </div>
                    )}
                    <video ref={videoRef} className="w-full h-full object-contain" muted playsInline />
                    
                    {/* Controls overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1.5 px-2 py-1 bg-red-500 rounded text-white text-xs font-bold">
                                <span className="w-2 h-2 bg-white rounded-full animate-pulse"/>
                                Live
                            </span>
                        </div>
                        <button
                            onClick={toggleFullscreen}
                            className="p-2 text-white/80 hover:text-white transition-colors"
                            title="Fullscreen"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Info */}
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                    {camera.location && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1.5 mb-1">
                            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                <circle cx="12" cy="11" r="3"/>
                            </svg>
                            {camera.location}
                        </p>
                    )}
                    {camera.area_name && (
                        <span className="inline-block text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                            {camera.area_name}
                        </span>
                    )}
                    {camera.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{camera.description}</p>
                    )}
                </div>
            </div>
        </div>
    );
});
VideoModal.displayName = 'VideoModal';

// Map controller
function MapController({ bounds }) {
    const map = useMap();
    useEffect(() => {
        if (bounds?.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
    }, [bounds, map]);
    return null;
}

// Camera Marker with Popup Preview
const CameraMarker = memo(({ camera, onOpenModal }) => {
    if (!hasValidCoords(camera)) return null;
    
    const lat = parseFloat(camera.latitude);
    const lng = parseFloat(camera.longitude);
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
    
    return (
        <Marker position={[lat, lng]} icon={createCameraIcon(isTunnel)}>
            <Popup className="camera-popup" closeButton={false} maxWidth={260} minWidth={240}>
                <div 
                    className="cursor-pointer" 
                    onClick={() => onOpenModal(camera)}
                >
                    {/* Mini Preview */}
                    {camera.streams?.hls && (
                        <MiniPreview streamUrl={camera.streams.hls} />
                    )}
                    
                    {/* Info */}
                    <div className="p-2.5">
                        <h4 className="font-semibold text-gray-900 text-sm mb-1">{camera.name}</h4>
                        {camera.location && (
                            <p className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                </svg>
                                <span className="truncate">{camera.location}</span>
                            </p>
                        )}
                        {camera.area_name && (
                            <span className="inline-block text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded uppercase">
                                {camera.area_name}
                            </span>
                        )}
                    </div>
                </div>
            </Popup>
        </Marker>
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
    const [modalCamera, setModalCamera] = useState(null);
    const mapRef = useRef(null);

    // Cameras with valid coordinates
    const camerasWithCoords = useMemo(() => cameras.filter(hasValidCoords), [cameras]);

    // Unique areas
    const areas = useMemo(() => {
        const set = new Set();
        cameras.forEach(c => c.area_name && set.add(c.area_name));
        return Array.from(set).sort();
    }, [cameras]);

    // Filtered cameras
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

    // No coordinates
    if (cameras.length > 0 && camerasWithCoords.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl min-h-[400px] ${className}`}>
                <div className="text-center p-6">
                    <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                    </svg>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">Belum ada koordinat kamera</p>
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
                className="w-full h-full rounded-xl"
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
                        onOpenModal={openModal}
                    />
                ))}
            </MapContainer>

            {/* Top Left - Area Filter */}
            <div className="absolute top-3 left-3 z-[1000]">
                <select
                    value={selectedArea}
                    onChange={(e) => setSelectedArea(e.target.value)}
                    className="px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg text-sm text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-sky-500 min-w-[140px]"
                >
                    <option value="all">Semua ({camerasWithCoords.length})</option>
                    {areas.map(area => (
                        <option key={area} value={area}>
                            {area} ({camerasWithCoords.filter(c => c.area_name === area).length})
                        </option>
                    ))}
                </select>
            </div>

            {/* Top Right - Camera Count */}
            <div className="absolute top-3 right-3 z-[1000] px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
                {filtered.length} Kamera
            </div>

            {/* Video Modal */}
            {modalCamera && (
                <VideoModal camera={modalCamera} onClose={closeModal} />
            )}

            {/* Popup Styles */}
            <style>{`
                .camera-popup .leaflet-popup-content-wrapper {
                    padding: 0;
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                }
                .camera-popup .leaflet-popup-content {
                    margin: 0;
                    width: 240px !important;
                }
                .camera-popup .leaflet-popup-tip-container {
                    display: none;
                }
            `}</style>
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
