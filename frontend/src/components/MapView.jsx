/**
 * MapView Component - With CCTV Icon Markers & Zoom Controls
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

// CCTV Camera Icon SVG
const createCameraIcon = (isTunnel = false) => {
    const bgColor = isTunnel ? '#f97316' : '#10b981';
    return L.divIcon({
        className: 'cctv-marker',
        html: `
            <div style="
                width: 36px;
                height: 36px;
                background: ${bgColor};
                border: 3px solid white;
                border-radius: 8px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                    <path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.98zM16 18H4V6h12v12z"/>
                    <circle cx="10" cy="12" r="2.5" fill="white"/>
                </svg>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
    });
};

const hasValidCoords = (c) => {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
};

// Video Modal
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
                    <button onClick={onClose} className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded">
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

// Map bounds/center controller
function MapController({ center, zoom, bounds }) {
    const map = useMap();
    
    useEffect(() => {
        if (bounds?.isValid()) {
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
        } else if (center) {
            map.setView(center, zoom || 14);
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

    // Calculate center and bounds based on selected area
    const { center, bounds } = useMemo(() => {
        // If specific area selected, check if area has coordinates
        if (selectedArea !== 'all') {
            const areaData = areas.find(a => a.name === selectedArea);
            if (areaData?.latitude && areaData?.longitude) {
                return {
                    center: [parseFloat(areaData.latitude), parseFloat(areaData.longitude)],
                    bounds: null
                };
            }
        }
        
        // Otherwise use camera bounds
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
        setMapKey(prev => prev + 1); // Force map to recenter
    };

    if (cameras.length === 0 || camerasWithCoords.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800/50 rounded-xl min-h-[400px] ${className}`}>
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
        <div className={`relative w-full h-full min-h-[450px] ${className}`}>
            <MapContainer
                key={mapKey}
                center={center || defaultCenter}
                zoom={defaultZoom}
                className="w-full h-full rounded-xl"
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

            {/* Area Filter */}
            {areaNames.length > 0 && (
                <div className="absolute top-3 left-3 z-[1000]">
                    <select
                        value={selectedArea}
                        onChange={handleAreaChange}
                        className="px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg shadow-lg text-sm border-0 focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer min-w-[160px]"
                    >
                        <option value="all">📍 Semua Area ({camerasWithCoords.length})</option>
                        {areaNames.map(area => (
                            <option key={area} value={area}>
                                📍 {area} ({camerasWithCoords.filter(c => c.area_name === area).length})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Camera count & Legend */}
            <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
                <div className="px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg text-sm font-medium text-gray-900 dark:text-white">
                    {filtered.length} Kamera
                </div>
                <div className="px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg text-xs space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded bg-emerald-500"/>
                        <span className="text-gray-600 dark:text-gray-300">Stabil</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded bg-orange-500"/>
                        <span className="text-gray-600 dark:text-gray-300">Tunnel</span>
                    </div>
                </div>
            </div>

            {modalCamera && <VideoModal camera={modalCamera} onClose={closeModal} />}
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
