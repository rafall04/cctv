/**
 * MapView Component - CCTV Map dengan Video Popup
 * Fitur: Area filter, inline video player, responsive sidebar
 */

import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import Hls from 'hls.js';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom camera marker icon - GREEN for stable, ORANGE for tunnel
const createCameraIcon = (isSelected = false, isTunnel = false) => {
    // Fix: Check isTunnel properly - only orange if explicitly tunnel
    const color = isSelected ? '#3b82f6' : (isTunnel === true || isTunnel === 1 ? '#f97316' : '#22c55e');
    const size = isSelected ? 38 : 30;
    
    return L.divIcon({
        className: 'camera-marker',
        html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
            <svg width="${size * 0.5}" height="${size * 0.5}" viewBox="0 0 24 24" fill="white">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
        </div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2 - 5],
    });
};

// Check valid coordinates
const hasValidCoords = (c) => {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
};

// Video Player Component for Popup
const VideoPlayer = memo(({ streamUrl, cameraName }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;

        const video = videoRef.current;
        
        if (Hls.isSupported()) {
            hlsRef.current = new Hls({
                enableWorker: false,
                lowLatencyMode: false,
                backBufferLength: 10,
                maxBufferLength: 15,
                maxMaxBufferLength: 30,
            });

            hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
                setStatus('playing');
                video.play().catch(() => {});
            });

            hlsRef.current.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    setStatus('error');
                    setError('Stream tidak tersedia');
                }
            });

            hlsRef.current.loadSource(streamUrl);
            hlsRef.current.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', () => {
                setStatus('playing');
                video.play().catch(() => {});
            });
        }

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [streamUrl]);

    if (status === 'error') {
        return (
            <div className="w-full aspect-video bg-gray-900 flex items-center justify-center rounded-lg">
                <div className="text-center text-white">
                    <svg className="w-8 h-8 mx-auto mb-2 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                    <p className="text-xs">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative">
            {status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                    <div className="text-center">
                        <svg className="w-8 h-8 mx-auto mb-2 text-sky-400 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        <p className="text-xs text-gray-400">Loading...</p>
                    </div>
                </div>
            )}
            <video
                ref={videoRef}
                className="w-full h-full object-contain"
                muted
                playsInline
                autoPlay
            />
            {/* Live badge */}
            <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 bg-red-500 rounded text-white text-[10px] font-bold">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"/>
                LIVE
            </div>
        </div>
    );
});
VideoPlayer.displayName = 'VideoPlayer';

// Map controller
function MapController({ bounds, selectedCamera }) {
    const map = useMap();
    
    useEffect(() => {
        if (selectedCamera && hasValidCoords(selectedCamera)) {
            map.flyTo([parseFloat(selectedCamera.latitude), parseFloat(selectedCamera.longitude)], 17, { duration: 0.3 });
        }
    }, [selectedCamera, map]);

    useEffect(() => {
        if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        }
    }, [bounds, map]);
    
    return null;
}

// Camera marker with video popup
const CameraMarker = memo(({ camera, isSelected, onSelect }) => {
    if (!hasValidCoords(camera)) return null;
    
    const lat = parseFloat(camera.latitude);
    const lng = parseFloat(camera.longitude);
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
    
    return (
        <Marker
            position={[lat, lng]}
            icon={createCameraIcon(isSelected, isTunnel)}
            eventHandlers={{ click: () => onSelect(camera) }}
        >
            <Popup 
                maxWidth={320} 
                minWidth={280}
                className="camera-popup"
                closeButton={true}
            >
                <div className="p-0">
                    {/* Video Player - Auto play on popup open */}
                    {camera.streams?.hls && (
                        <VideoPlayer 
                            streamUrl={camera.streams.hls} 
                            cameraName={camera.name}
                        />
                    )}
                    
                    {/* Camera Info */}
                    <div className="p-2">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">{camera.name}</h3>
                        {camera.location && (
                            <p className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
                                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                </svg>
                                {camera.location}
                            </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1.5">
                            {camera.area_name && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{camera.area_name}</span>
                            )}
                            {isTunnel && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">Tunnel</span>
                            )}
                        </div>
                    </div>
                </div>
            </Popup>
        </Marker>
    );
});
CameraMarker.displayName = 'CameraMarker';

// Compact camera list item
const CameraItem = memo(({ camera, isSelected, onClick }) => {
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
    
    return (
        <button
            onClick={() => onClick(camera)}
            className={`w-full text-left p-2 rounded-lg transition-all ${
                isSelected 
                    ? 'bg-sky-500/20 border-sky-500' 
                    : 'bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800'
            } border ${isSelected ? 'border-sky-500' : 'border-transparent'} backdrop-blur-sm`}
        >
            <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${isTunnel ? 'bg-orange-500' : 'bg-emerald-500'}`}/>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{camera.name}</p>
                    {camera.location && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{camera.location}</p>
                    )}
                </div>
            </div>
        </button>
    );
});
CameraItem.displayName = 'CameraItem';

// Main MapView
const MapView = memo(({ 
    cameras = [], 
    onCameraSelect, 
    defaultCenter = [-7.1507, 111.8815],
    defaultZoom = 13,
    className = '',
}) => {
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [selectedArea, setSelectedArea] = useState('all');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const mapRef = useRef(null);

    // Detect mobile
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

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

    const handleSelect = useCallback((camera) => {
        setSelectedCamera(camera);
        onCameraSelect?.(camera);
        if (isMobile) setSidebarOpen(false);
    }, [onCameraSelect, isMobile]);

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
        <div className={`relative w-full h-full min-h-[450px] rounded-xl overflow-hidden ${className}`}>
            {/* Map */}
            <MapContainer
                ref={mapRef}
                center={center}
                zoom={defaultZoom}
                className="w-full h-full"
                style={{ minHeight: '450px', zIndex: 0 }}
            >
                <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController bounds={bounds} selectedCamera={selectedCamera} />
                {filtered.map(camera => (
                    <CameraMarker
                        key={camera.id}
                        camera={camera}
                        isSelected={selectedCamera?.id === camera.id}
                        onSelect={handleSelect}
                    />
                ))}
            </MapContainer>

            {/* Top Controls */}
            <div className="absolute top-3 left-3 right-3 z-[1000] flex items-start gap-2">
                {/* Toggle Sidebar */}
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="p-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 transition-colors shrink-0"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M4 6h16M4 12h16M4 18h16"/>
                    </svg>
                </button>

                {/* Area Filter */}
                <select
                    value={selectedArea}
                    onChange={(e) => setSelectedArea(e.target.value)}
                    className="flex-1 max-w-[200px] px-3 py-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg text-sm text-gray-700 dark:text-gray-200 border-0 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                    <option value="all">Semua ({camerasWithCoords.length})</option>
                    {areas.map(area => (
                        <option key={area} value={area}>
                            {area} ({camerasWithCoords.filter(c => c.area_name === area).length})
                        </option>
                    ))}
                </select>

                {/* Camera Count */}
                <div className="ml-auto px-3 py-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg text-sm font-medium text-gray-700 dark:text-gray-200 shrink-0">
                    {filtered.length} Kamera
                </div>
            </div>

            {/* Sidebar - Compact & Transparent */}
            <div className={`absolute top-16 left-3 bottom-3 z-[1000] transition-all duration-300 ${
                sidebarOpen ? (isMobile ? 'w-56' : 'w-64') : 'w-0 opacity-0 pointer-events-none'
            }`}>
                <div className="h-full bg-white/80 dark:bg-gray-900/80 backdrop-blur-md rounded-xl shadow-lg overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="p-2 border-b border-gray-200/50 dark:border-gray-700/50">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Daftar Kamera</p>
                    </div>
                    
                    {/* List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {filtered.length === 0 ? (
                            <p className="text-center text-xs text-gray-500 py-4">Tidak ada kamera</p>
                        ) : (
                            filtered.map(camera => (
                                <CameraItem
                                    key={camera.id}
                                    camera={camera}
                                    isSelected={selectedCamera?.id === camera.id}
                                    onClick={handleSelect}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Legend - Bottom Right */}
            <div className="absolute bottom-3 right-3 z-[1000] px-3 py-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg">
                <div className="flex items-center gap-3 text-[10px] text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"/>
                        <span>Stabil</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-orange-500"/>
                        <span>Tunnel</span>
                    </div>
                </div>
            </div>

            {/* Custom Popup Styles */}
            <style>{`
                .camera-popup .leaflet-popup-content-wrapper {
                    padding: 0;
                    border-radius: 12px;
                    overflow: hidden;
                }
                .camera-popup .leaflet-popup-content {
                    margin: 0;
                    width: 280px !important;
                }
                .camera-popup .leaflet-popup-close-button {
                    top: 8px;
                    right: 8px;
                    color: white;
                    font-size: 18px;
                    z-index: 10;
                }
                .leaflet-popup-tip {
                    background: white;
                }
            `}</style>
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
