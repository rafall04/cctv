/**
 * MapView Component - Optimized for Low-End Devices
 * - Minimal animations
 * - Simple modal without heavy effects
 * - Area filter only
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

// Simple camera marker
const createCameraIcon = (isTunnel = false) => {
    const color = isTunnel ? '#f97316' : '#10b981';
    return L.divIcon({
        className: 'camera-marker',
        html: `<div style="width:24px;height:24px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:pointer;"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
    });
};

const hasValidCoords = (c) => {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
};

// Simple Video Modal - No heavy effects
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
                backBufferLength: 10,
                maxBufferLength: 15,
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

    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4 bg-black/80" onClick={onClose}>
            <div className="bg-gray-900 rounded-xl w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                {/* Video */}
                <div className="relative bg-black aspect-video">
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin"/>
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
                            Stream tidak tersedia
                        </div>
                    )}
                    <video ref={videoRef} className="w-full h-full object-contain" muted playsInline controls />
                    
                    {/* Badges */}
                    <div className="absolute top-2 left-2 flex gap-1.5">
                        <span className="px-2 py-0.5 bg-red-500 rounded text-white text-[10px] font-bold">LIVE</span>
                        {isTunnel && <span className="px-2 py-0.5 bg-orange-500 rounded text-white text-[10px] font-bold">Tunnel</span>}
                    </div>

                    {/* Close */}
                    <button onClick={onClose} className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                {/* Info */}
                <div className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="text-white font-semibold text-sm sm:text-base truncate">{camera.name}</h3>
                            {camera.location && (
                                <p className="text-gray-400 text-xs sm:text-sm truncate mt-0.5">{camera.location}</p>
                            )}
                        </div>
                        {camera.area_name && (
                            <span className="shrink-0 px-2 py-1 bg-sky-500/20 text-sky-400 rounded text-xs font-medium">
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

// Map bounds controller
function MapController({ bounds }) {
    const map = useMap();
    useEffect(() => {
        if (bounds?.isValid()) {
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
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
            eventHandlers={{ click: () => onClick(camera) }}
        />
    );
});
CameraMarker.displayName = 'CameraMarker';

// Main MapView - Optimized
const MapView = memo(({ 
    cameras = [], 
    defaultCenter = [-7.1507, 111.8815],
    defaultZoom = 13,
    className = '',
}) => {
    const [selectedArea, setSelectedArea] = useState('all');
    const [modalCamera, setModalCamera] = useState(null);

    const camerasWithCoords = useMemo(() => cameras.filter(hasValidCoords), [cameras]);

    const areas = useMemo(() => {
        const set = new Set();
        cameras.forEach(c => c.area_name && set.add(c.area_name));
        return Array.from(set).sort();
    }, [cameras]);

    const filtered = useMemo(() => {
        if (selectedArea === 'all') return camerasWithCoords;
        return camerasWithCoords.filter(c => c.area_name === selectedArea);
    }, [camerasWithCoords, selectedArea]);

    const bounds = useMemo(() => {
        if (filtered.length === 0) return null;
        return L.latLngBounds(filtered.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)]));
    }, [filtered]);

    const center = useMemo(() => {
        if (filtered.length === 0) return defaultCenter;
        const avgLat = filtered.reduce((s, c) => s + parseFloat(c.latitude), 0) / filtered.length;
        const avgLng = filtered.reduce((s, c) => s + parseFloat(c.longitude), 0) / filtered.length;
        return [avgLat, avgLng];
    }, [filtered, defaultCenter]);

    const openModal = useCallback((camera) => setModalCamera(camera), []);
    const closeModal = useCallback(() => setModalCamera(null), []);

    if (cameras.length === 0 || camerasWithCoords.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800/50 rounded-xl min-h-[400px] ${className}`}>
                <div className="text-center p-6">
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                        {cameras.length === 0 ? 'Belum ada kamera' : 'Koordinat belum diatur'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative w-full h-full min-h-[450px] ${className}`}>
            <MapContainer
                center={center}
                zoom={defaultZoom}
                className="w-full h-full rounded-xl"
                style={{ minHeight: '450px', zIndex: 0 }}
            >
                <TileLayer
                    attribution='&copy; OSM'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController bounds={bounds} />
                {filtered.map(camera => (
                    <CameraMarker key={camera.id} camera={camera} onClick={openModal} />
                ))}
            </MapContainer>

            {/* Area Filter - Simple select */}
            {areas.length > 0 && (
                <div className="absolute top-2 left-2 z-[1000]">
                    <select
                        value={selectedArea}
                        onChange={(e) => setSelectedArea(e.target.value)}
                        className="px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow text-sm border border-gray-200 dark:border-gray-700 focus:outline-none"
                    >
                        <option value="all">Semua Area ({camerasWithCoords.length})</option>
                        {areas.map(area => (
                            <option key={area} value={area}>
                                {area} ({camerasWithCoords.filter(c => c.area_name === area).length})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Camera count */}
            <div className="absolute top-2 right-2 z-[1000] px-2.5 py-1.5 bg-white dark:bg-gray-800 rounded-lg shadow text-xs font-medium text-gray-700 dark:text-gray-200">
                {filtered.length} Kamera
            </div>

            {modalCamera && <VideoModal camera={modalCamera} onClose={closeModal} />}
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
