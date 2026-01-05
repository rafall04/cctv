/**
 * MapView Component
 * Interactive map displaying camera locations with markers
 * Features: Area filter, camera sidebar list, click to view stream
 */

import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom camera marker icon
const createCameraIcon = (isSelected = false, isTunnel = false) => {
    const color = isSelected ? '#f59e0b' : (isTunnel ? '#f97316' : '#22c55e');
    const size = isSelected ? 40 : 32;
    
    return L.divIcon({
        className: 'custom-camera-marker',
        html: `
            <div style="width:${size}px;height:${size}px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;cursor:pointer;">
                <svg width="${size * 0.5}" height="${size * 0.5}" viewBox="0 0 24 24" fill="white">
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
            </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
    });
};

// Check if camera has valid coordinates
const hasValidCoordinates = (camera) => {
    const lat = parseFloat(camera.latitude);
    const lng = parseFloat(camera.longitude);
    return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
};

// Map controller for programmatic control
function MapController({ bounds, selectedCamera }) {
    const map = useMap();
    
    useEffect(() => {
        if (selectedCamera && hasValidCoordinates(selectedCamera)) {
            map.flyTo([parseFloat(selectedCamera.latitude), parseFloat(selectedCamera.longitude)], 17, { duration: 0.5 });
        }
    }, [selectedCamera, map]);

    useEffect(() => {
        if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }
    }, [bounds, map]);
    
    return null;
}

// Camera marker component
const CameraMarker = memo(({ camera, isSelected, onSelect, onViewStream }) => {
    if (!hasValidCoordinates(camera)) return null;
    
    const lat = parseFloat(camera.latitude);
    const lng = parseFloat(camera.longitude);
    
    return (
        <Marker
            position={[lat, lng]}
            icon={createCameraIcon(isSelected, camera.is_tunnel === 1)}
            eventHandlers={{ click: () => onSelect(camera) }}
        >
            <Popup maxWidth={300} minWidth={250}>
                <div className="p-1">
                    <h3 className="font-semibold text-gray-900 text-sm mb-1">{camera.name}</h3>
                    {camera.location && (
                        <p className="text-gray-600 text-xs mb-1 flex items-center gap-1">
                            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                <circle cx="12" cy="11" r="3"/>
                            </svg>
                            <span className="truncate">{camera.location}</span>
                        </p>
                    )}
                    {camera.area_name && (
                        <p className="text-gray-500 text-xs mb-2">Area: {camera.area_name}</p>
                    )}
                    <button
                        onClick={() => onViewStream(camera)}
                        className="w-full bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        Lihat Stream
                    </button>
                </div>
            </Popup>
        </Marker>
    );
});
CameraMarker.displayName = 'CameraMarker';

// Camera list item in sidebar
const CameraListItem = memo(({ camera, isSelected, onClick, onViewStream }) => (
    <div 
        onClick={() => onClick(camera)}
        className={`p-3 rounded-xl cursor-pointer transition-all ${
            isSelected 
                ? 'bg-sky-100 dark:bg-sky-500/20 border-sky-500' 
                : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50'
        } border ${isSelected ? 'border-sky-500' : 'border-gray-200 dark:border-gray-700'}`}
    >
        <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                camera.is_tunnel === 1 
                    ? 'bg-orange-100 dark:bg-orange-500/20 text-orange-500' 
                    : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-500'
            }`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
            </div>
            <div className="flex-1 min-w-0">
                <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate">{camera.name}</h4>
                {camera.location && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{camera.location}</p>
                )}
                <div className="flex items-center gap-2 mt-1.5">
                    {camera.area_name && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                            {camera.area_name}
                        </span>
                    )}
                    {camera.is_tunnel === 1 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400">
                            Tunnel
                        </span>
                    )}
                </div>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onViewStream(camera); }}
                className="p-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white transition-colors shrink-0"
                title="Lihat Stream"
            >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
        </div>
    </div>
));
CameraListItem.displayName = 'CameraListItem';

// Main MapView component
const MapView = memo(({ 
    cameras = [], 
    onCameraSelect, 
    selectedCameraId,
    defaultCenter = [-7.1507, 111.8815],
    defaultZoom = 13,
    className = '',
}) => {
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [selectedArea, setSelectedArea] = useState('all');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const mapRef = useRef(null);

    // Get cameras with valid coordinates
    const camerasWithCoords = useMemo(() => 
        cameras.filter(hasValidCoordinates), 
    [cameras]);

    // Get unique areas from cameras
    const areas = useMemo(() => {
        const areaSet = new Set();
        cameras.forEach(c => {
            if (c.area_name) areaSet.add(c.area_name);
        });
        return Array.from(areaSet).sort();
    }, [cameras]);

    // Filter cameras by selected area
    const filteredCameras = useMemo(() => {
        if (selectedArea === 'all') return camerasWithCoords;
        return camerasWithCoords.filter(c => c.area_name === selectedArea);
    }, [camerasWithCoords, selectedArea]);

    // Calculate bounds for filtered cameras
    const bounds = useMemo(() => {
        if (filteredCameras.length === 0) return null;
        const latLngs = filteredCameras.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)]);
        return L.latLngBounds(latLngs);
    }, [filteredCameras]);

    // Map center
    const mapCenter = useMemo(() => {
        if (filteredCameras.length > 0) {
            const avgLat = filteredCameras.reduce((sum, c) => sum + parseFloat(c.latitude), 0) / filteredCameras.length;
            const avgLng = filteredCameras.reduce((sum, c) => sum + parseFloat(c.longitude), 0) / filteredCameras.length;
            return [avgLat, avgLng];
        }
        return defaultCenter;
    }, [filteredCameras, defaultCenter]);

    const handleSelect = useCallback((camera) => {
        setSelectedCamera(camera);
        onCameraSelect?.(camera);
    }, [onCameraSelect]);

    const handleViewStream = useCallback((camera) => {
        onCameraSelect?.(camera, true);
    }, [onCameraSelect]);

    useEffect(() => {
        if (selectedCameraId) {
            const camera = cameras.find(c => c.id === selectedCameraId);
            if (camera) setSelectedCamera(camera);
        }
    }, [selectedCameraId, cameras]);

    // No cameras with coordinates
    if (cameras.length > 0 && camerasWithCoords.length === 0) {
        return (
            <div className={`relative w-full h-full min-h-[400px] flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl ${className}`}>
                <div className="text-center p-6">
                    <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                        <circle cx="12" cy="11" r="3"/>
                    </svg>
                    <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">Belum Ada Koordinat</h3>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">Tambahkan koordinat pada kamera di panel admin</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative w-full h-full min-h-[500px] flex ${className}`}>
            {/* Sidebar */}
            <div className={`${sidebarOpen ? 'w-80' : 'w-0'} transition-all duration-300 overflow-hidden bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col`}>
                {/* Area Filter */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Filter Area</label>
                    <select
                        value={selectedArea}
                        onChange={(e) => setSelectedArea(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                        <option value="all">Semua Area ({camerasWithCoords.length})</option>
                        {areas.map(area => {
                            const count = camerasWithCoords.filter(c => c.area_name === area).length;
                            return <option key={area} value={area}>{area} ({count})</option>;
                        })}
                    </select>
                </div>

                {/* Camera List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {filteredCameras.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                            Tidak ada kamera di area ini
                        </div>
                    ) : (
                        filteredCameras.map(camera => (
                            <CameraListItem
                                key={camera.id}
                                camera={camera}
                                isSelected={selectedCamera?.id === camera.id}
                                onClick={handleSelect}
                                onViewStream={handleViewStream}
                            />
                        ))
                    )}
                </div>

                {/* Stats */}
                <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500 dark:text-gray-400">Total Kamera</span>
                        <span className="font-medium text-gray-900 dark:text-white">{filteredCameras.length}</span>
                    </div>
                </div>
            </div>

            {/* Map */}
            <div className="flex-1 relative">
                <MapContainer
                    ref={mapRef}
                    center={mapCenter}
                    zoom={defaultZoom}
                    className="w-full h-full"
                    style={{ minHeight: '500px', zIndex: 0 }}
                >
                    <TileLayer
                        attribution='&copy; OpenStreetMap'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapController bounds={bounds} selectedCamera={selectedCamera} />
                    {filteredCameras.map(camera => (
                        <CameraMarker
                            key={camera.id}
                            camera={camera}
                            isSelected={selectedCamera?.id === camera.id}
                            onSelect={handleSelect}
                            onViewStream={handleViewStream}
                        />
                    ))}
                </MapContainer>

                {/* Toggle Sidebar Button */}
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="absolute top-3 left-3 z-[1000] p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    title={sidebarOpen ? 'Tutup Sidebar' : 'Buka Sidebar'}
                >
                    <svg className={`w-5 h-5 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/>
                    </svg>
                </button>

                {/* Camera Count Badge */}
                <div className="absolute top-3 right-3 z-[1000] bg-white dark:bg-gray-800 px-3 py-1.5 rounded-full shadow-lg text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
                    {filteredCameras.length} Kamera
                </div>

                {/* Legend */}
                <div className="absolute bottom-3 right-3 z-[1000] bg-white dark:bg-gray-800 p-3 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Keterangan</p>
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                            <span>Koneksi Stabil</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                            <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                            <span>Koneksi Tunnel</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;
