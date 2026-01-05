/**
 * MapView Component - Modern CCTV Map
 * Klik marker → langsung modal besar
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

// Camera marker icon - simple colored dot
const createCameraIcon = (isActive = true) => {
    const color = isActive ? '#10b981' : '#6b7280';
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

// Video Modal - Full featured
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
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div 
                className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Video Container */}
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
                    <video ref={videoRef} className="w-full h-full object-contain" muted playsInline />
                    
                    {/* Live Badge */}
                    <div className="absolute top-3 left-3">
                        <span className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500 rounded-lg text-white text-xs font-semibold shadow-lg">
                            <span className="w-2 h-2 bg-white rounded-full animate-pulse"/>
                            LIVE
                        </span>
                    </div>

                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                    
                    {/* Bottom Controls */}
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                        <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0 mr-3">
                                <h3 className="text-white font-semibold text-sm sm:text-base truncate">{camera.name}</h3>
                                {camera.location && (
                                    <p className="text-white/60 text-xs truncate flex items-center gap-1 mt-0.5">
                                        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                        </svg>
                                        {camera.location}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={toggleFullscreen}
                                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                title="Fullscreen"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Camera Info */}
                <div className="p-4 border-t border-gray-800">
                    <div className="flex flex-wrap items-center gap-2">
                        {camera.area_name && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-500/20 text-sky-400 rounded-lg text-xs font-medium">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                                </svg>
                                {camera.area_name}
                            </span>
                        )}
                        {camera.description && (
                            <span className="text-gray-400 text-xs">{camera.description}</span>
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

// Camera Marker - click langsung buka modal
const CameraMarker = memo(({ camera, onClick }) => {
    if (!hasValidCoords(camera)) return null;
    
    const lat = parseFloat(camera.latitude);
    const lng = parseFloat(camera.longitude);
    
    return (
        <Marker 
            position={[lat, lng]} 
            icon={createCameraIcon(true)}
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
    const [modalCamera, setModalCamera] = useState(null);
    const mapRef = useRef(null);

    // Cameras with valid coordinates
    const camerasWithCoords = useMemo(() => cameras.filter(hasValidCoords), [cameras]);

    // Bounds
    const bounds = useMemo(() => {
        if (camerasWithCoords.length === 0) return null;
        return L.latLngBounds(camerasWithCoords.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)]));
    }, [camerasWithCoords]);

    // Map center
    const center = useMemo(() => {
        if (camerasWithCoords.length === 0) return defaultCenter;
        const avgLat = camerasWithCoords.reduce((s, c) => s + parseFloat(c.latitude), 0) / camerasWithCoords.length;
        const avgLng = camerasWithCoords.reduce((s, c) => s + parseFloat(c.longitude), 0) / camerasWithCoords.length;
        return [avgLat, avgLng];
    }, [camerasWithCoords, defaultCenter]);

    const openModal = useCallback((camera) => {
        setModalCamera(camera);
    }, []);

    const closeModal = useCallback(() => {
        setModalCamera(null);
    }, []);

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
                {camerasWithCoords.map(camera => (
                    <CameraMarker
                        key={camera.id}
                        camera={camera}
                        onClick={openModal}
                    />
                ))}
            </MapContainer>

            {/* Camera Count Badge */}
            <div className="absolute top-3 left-3 z-[1000]">
                <div className="flex items-center gap-2 px-3 py-2 bg-white/95 dark:bg-gray-800/95 backdrop-blur rounded-xl shadow-lg">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"/>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {camerasWithCoords.length} Kamera Aktif
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
                .animate-in {
                    animation: fade-in 0.2s ease-out, zoom-in-95 0.2s ease-out;
                }
            `}</style>
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
