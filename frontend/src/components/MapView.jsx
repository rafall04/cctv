/**
 * MapView Component - Desain Modern CCTV Publik
 * Dengan marker CCTV yang lebih keren dan indikator status (Stabil/Tunnel)
 */

import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, ZoomControl } from 'react-leaflet';
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

// Modern CCTV Marker dengan animasi pulse
const createCameraIcon = (isTunnel = false) => {
    const color = isTunnel ? '#f97316' : '#10b981';
    const pulseColor = isTunnel ? 'rgba(249, 115, 22, 0.4)' : 'rgba(16, 185, 129, 0.4)';
    
    return L.divIcon({
        className: 'cctv-marker-modern',
        html: `
            <div class="cctv-pin" style="position: relative; cursor: pointer;">
                <!-- Pulse animation -->
                <div style="
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 50px;
                    height: 50px;
                    background: ${pulseColor};
                    border-radius: 50%;
                    animation: cctvPulse 2s ease-out infinite;
                "></div>
                <!-- Main marker -->
                <div style="
                    position: relative;
                    width: 40px;
                    height: 40px;
                    background: linear-gradient(135deg, ${color} 0%, ${isTunnel ? '#ea580c' : '#059669'} 100%);
                    border: 3px solid white;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <div style="transform: rotate(45deg); display: flex; align-items: center; justify-content: center;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                            <path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.98z"/>
                        </svg>
                    </div>
                </div>
            </div>
            <style>
                @keyframes cctvPulse {
                    0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
                    100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
                }
            </style>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
    });
};

const hasValidCoords = (c) => {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
};

// Video Modal dengan desain modern
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
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4 bg-black/90 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-gradient-to-b from-gray-900 to-gray-950 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl border border-gray-800" onClick={(e) => e.stopPropagation()}>
                {/* Video Container */}
                <div className="relative bg-black aspect-video">
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            <div className="w-12 h-12 border-3 border-gray-700 border-t-sky-500 rounded-full animate-spin"/>
                            <span className="text-gray-400 text-sm">Menghubungkan stream...</span>
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                                <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                                </svg>
                            </div>
                            <span className="text-gray-400 text-sm">Stream tidak tersedia</span>
                        </div>
                    )}
                    <video ref={videoRef} className="w-full h-full object-contain" muted playsInline controls />
                    
                    {/* Top overlay badges */}
                    <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/70 to-transparent">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {/* Live indicator */}
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500 text-white text-xs font-bold shadow-lg">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                                    </span>
                                    LIVE
                                </span>
                                {/* Status badge */}
                                <span className={`px-3 py-1 rounded-full text-white text-xs font-bold shadow-lg ${isTunnel ? 'bg-orange-500' : 'bg-emerald-500'}`}>
                                    {isTunnel ? '⚡ Tunnel' : '✓ Stabil'}
                                </span>
                            </div>
                            {/* Close button */}
                            <button onClick={onClose} className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Info Panel */}
                <div className="p-4 sm:p-5 border-t border-gray-800">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <h3 className="text-white font-bold text-lg sm:text-xl truncate">{camera.name}</h3>
                            {camera.location && (
                                <p className="text-gray-400 text-sm mt-1 flex items-center gap-1.5">
                                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                        <circle cx="12" cy="11" r="3"/>
                                    </svg>
                                    <span className="truncate">{camera.location}</span>
                                </p>
                            )}
                        </div>
                        {camera.area_name && (
                            <span className="shrink-0 px-3 py-1.5 bg-sky-500/20 text-sky-400 rounded-lg text-sm font-semibold border border-sky-500/30">
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

// Map bounds/center controller
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

    // Get unique area names from cameras
    const areaNames = useMemo(() => {
        const set = new Set();
        cameras.forEach(c => c.area_name && set.add(c.area_name));
        return Array.from(set).sort();
    }, [cameras]);

    // Filtered cameras by area
    const filtered = useMemo(() => {
        if (selectedArea === 'all') return camerasWithCoords;
        return camerasWithCoords.filter(c => c.area_name === selectedArea);
    }, [camerasWithCoords, selectedArea]);

    // Hitung jumlah kamera stabil dan tunnel
    const stats = useMemo(() => {
        const stabil = filtered.filter(c => !c.is_tunnel).length;
        const tunnel = filtered.filter(c => c.is_tunnel === 1 || c.is_tunnel === true).length;
        return { stabil, tunnel, total: filtered.length };
    }, [filtered]);

    // Calculate center and bounds based on selected area
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

    const handleAreaChange = (areaName) => {
        setSelectedArea(areaName);
        setMapKey(prev => prev + 1);
    };

    if (cameras.length === 0 || camerasWithCoords.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 rounded-2xl min-h-[400px] ${className}`}>
                <div className="text-center p-8">
                    <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                        </svg>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 font-medium">
                        {cameras.length === 0 ? 'Belum ada kamera' : 'Koordinat kamera belum diatur'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative w-full h-full min-h-[450px] rounded-2xl overflow-hidden ${className}`}>
            {/* Map */}
            <MapContainer
                key={mapKey}
                center={center || defaultCenter}
                zoom={defaultZoom}
                className="w-full h-full"
                style={{ minHeight: '450px', zIndex: 0 }}
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

            {/* Header Overlay */}
            <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/60 via-black/30 to-transparent pointer-events-none z-[1000]">
                <div className="flex items-center justify-between pointer-events-auto">
                    {/* Area Filter Dropdown */}
                    <div className="relative">
                        <select
                            value={selectedArea}
                            onChange={(e) => handleAreaChange(e.target.value)}
                            className="appearance-none pl-4 pr-10 py-2.5 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm text-gray-900 dark:text-white rounded-xl shadow-lg text-sm font-medium border-0 focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer min-w-[180px]"
                        >
                            <option value="all">🗺️ Semua Lokasi</option>
                            {areaNames.map(area => (
                                <option key={area} value={area}>📍 {area}</option>
                            ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M19 9l-7 7-7-7"/>
                            </svg>
                        </div>
                    </div>

                    {/* Stats Panel */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-xl shadow-lg">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"/>
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{stats.stabil}</span>
                            </div>
                            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"/>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-sm shadow-orange-500/50"/>
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{stats.tunnel}</span>
                            </div>
                            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"/>
                            <span className="text-sm font-bold text-sky-600 dark:text-sky-400">{stats.total} CCTV</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend - Bottom Left */}
            <div className="absolute bottom-4 left-4 z-[1000]">
                <div className="px-4 py-3 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-xl shadow-lg">
                    <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Status Koneksi</p>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm"/>
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Stabil</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 shadow-sm"/>
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Tunnel</span>
                        </div>
                    </div>
                </div>
            </div>

            {modalCamera && <VideoModal camera={modalCamera} onClose={closeModal} />}
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
