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

// CCTV Marker - Sederhana tapi tetap keren, tanpa animasi berat
const createCameraIcon = (isTunnel = false) => {
    const cacheKey = isTunnel ? 'tunnel' : 'stable';
    if (iconCache.has(cacheKey)) {
        return iconCache.get(cacheKey);
    }

    const color = isTunnel ? '#f97316' : '#10b981';
    const darkColor = isTunnel ? '#ea580c' : '#059669';
    
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
                        <path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.98z"/>
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

// Video Modal - Optimasi untuk low-end (tanpa backdrop-blur)
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

        if (Hls.isSupported()) {
            hlsRef.current = new Hls(hlsConfig);
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
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [camera]);

    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;

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
                <div className="relative bg-black aspect-video">
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            <div className="w-10 h-10 border-2 border-gray-700 border-t-sky-500 rounded-full animate-spin"/>
                            <span className="text-gray-400 text-sm">Menghubungkan...</span>
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                            <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                            </svg>
                            <span className="text-gray-400 text-sm">Stream tidak tersedia</span>
                        </div>
                    )}
                    <video ref={videoRef} className="w-full h-full object-contain" muted playsInline controls />
                    
                    {/* Top badges - tanpa gradient overlay untuk performa */}
                    <div className="absolute top-2 left-2 flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-white"/>
                            LIVE
                        </span>
                        <span className={`px-2.5 py-1 rounded-full text-white text-xs font-bold ${isTunnel ? 'bg-orange-500' : 'bg-emerald-500'}`}>
                            {isTunnel ? 'Tunnel' : 'Stabil'}
                        </span>
                    </div>

                    {/* Close button */}
                    <button 
                        onClick={onClose} 
                        className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                {/* Info Panel */}
                <div className="p-4 border-t border-gray-800">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <h3 className="text-white font-bold text-base sm:text-lg truncate">{camera.name}</h3>
                            {camera.location && (
                                <p className="text-gray-400 text-sm mt-0.5 flex items-center gap-1.5 truncate">
                                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                        <circle cx="12" cy="11" r="3"/>
                                    </svg>
                                    {camera.location}
                                </p>
                            )}
                        </div>
                        {camera.area_name && (
                            <span className="shrink-0 px-2.5 py-1 bg-sky-500/20 text-sky-400 rounded-lg text-xs font-semibold">
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

// Main MapView
const MapView = memo(({ 
    cameras = [], 
    areas = [],
    defaultCenter = [-7.1507, 111.8815],
    defaultZoom = 13,
    className = '',
}) => {
    const [selectedArea, setSelectedArea] = useState('all');
    const [modalCamera, setModalCamera] = useState(null);
    const [mapKey, setMapKey] = useState(0);

    const camerasWithCoords = useMemo(() => cameras.filter(hasValidCoords), [cameras]);

    const areaNames = useMemo(() => {
        const set = new Set();
        cameras.forEach(c => c.area_name && set.add(c.area_name));
        return Array.from(set).sort();
    }, [cameras]);

    const filtered = useMemo(() => {
        if (selectedArea === 'all') return camerasWithCoords;
        return camerasWithCoords.filter(c => c.area_name === selectedArea);
    }, [camerasWithCoords, selectedArea]);

    const stats = useMemo(() => {
        const stabil = filtered.filter(c => !c.is_tunnel).length;
        const tunnel = filtered.filter(c => c.is_tunnel === 1 || c.is_tunnel === true).length;
        return { stabil, tunnel, total: filtered.length };
    }, [filtered]);

    const { center, bounds } = useMemo(() => {
        if (selectedArea !== 'all') {
            const areaData = areas.find(a => a.name === selectedArea);
            if (areaData?.latitude && areaData?.longitude) {
                return {
                    center: [parseFloat(areaData.latitude), parseFloat(areaData.longitude)],
                    bounds: null
                };
            }
        }
        
        if (filtered.length === 0) {
            return { center: defaultCenter, bounds: null };
        }
        
        const cameraBounds = L.latLngBounds(filtered.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)]));
        return { center: null, bounds: cameraBounds };
    }, [filtered, selectedArea, areas, defaultCenter]);

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
                <MapController center={center} zoom={15} bounds={bounds} />
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
                    <option value="all">Semua Lokasi ({camerasWithCoords.length})</option>
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
                    </div>
                </div>
            </div>

            {modalCamera && <VideoModal camera={modalCamera} onClose={closeModal} />}
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
