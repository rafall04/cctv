/**
 * MapView Component
 * Interactive map displaying camera locations with markers
 * Click marker to view camera stream in popup
 */

import { useEffect, useRef, useState, memo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon issue with bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom camera marker icon
const createCameraIcon = (isActive = true, isSelected = false) => {
    const color = isSelected ? '#f59e0b' : (isActive ? '#22c55e' : '#ef4444');
    const size = isSelected ? 40 : 32;
    
    return L.divIcon({
        className: 'custom-camera-marker',
        html: `
            <div style="
                width: ${size}px;
                height: ${size}px;
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

// Map controller component for programmatic control
function MapController({ center, zoom, selectedCamera }) {
    const map = useMap();
    
    useEffect(() => {
        if (selectedCamera?.latitude && selectedCamera?.longitude) {
            map.flyTo([selectedCamera.latitude, selectedCamera.longitude], 17, {
                duration: 0.5
            });
        }
    }, [selectedCamera, map]);
    
    return null;
}

// Camera marker component
const CameraMarker = memo(({ camera, isSelected, onSelect, onViewStream }) => {
    const hasCoordinates = camera.latitude && camera.longitude;
    
    if (!hasCoordinates) return null;
    
    return (
        <Marker
            position={[camera.latitude, camera.longitude]}
            icon={createCameraIcon(true, isSelected)}
            eventHandlers={{
                click: () => onSelect(camera),
            }}
        >
            <Popup maxWidth={320} minWidth={280}>
                <div className="p-1">
                    <h3 className="font-semibold text-gray-900 text-base mb-1">
                        {camera.name}
                    </h3>
                    {camera.location && (
                        <p className="text-gray-600 text-sm mb-2 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                <circle cx="12" cy="11" r="3"/>
                            </svg>
                            {camera.location}
                        </p>
                    )}
                    {camera.area_name && (
                        <p className="text-gray-500 text-xs mb-3">
                            Area: {camera.area_name}
                        </p>
                    )}
                    <button
                        onClick={() => onViewStream(camera)}
                        className="w-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                        Lihat Stream
                    </button>
                </div>
            </Popup>
        </Marker>
    );
});

CameraMarker.displayName = 'CameraMarker';

// Main MapView component
const MapView = memo(({ 
    cameras = [], 
    onCameraSelect, 
    selectedCameraId,
    defaultCenter = [-7.7956, 110.3695], // Default: Yogyakarta
    defaultZoom = 13,
    className = '',
}) => {
    const [selectedCamera, setSelectedCamera] = useState(null);
    const mapRef = useRef(null);

    // Filter cameras with valid coordinates
    const camerasWithCoords = cameras.filter(c => c.latitude && c.longitude);
    
    // Calculate map center based on cameras
    const mapCenter = camerasWithCoords.length > 0
        ? [
            camerasWithCoords.reduce((sum, c) => sum + c.latitude, 0) / camerasWithCoords.length,
            camerasWithCoords.reduce((sum, c) => sum + c.longitude, 0) / camerasWithCoords.length
          ]
        : defaultCenter;

    const handleSelect = useCallback((camera) => {
        setSelectedCamera(camera);
        onCameraSelect?.(camera);
    }, [onCameraSelect]);

    const handleViewStream = useCallback((camera) => {
        onCameraSelect?.(camera, true); // true = open stream modal
    }, [onCameraSelect]);

    // Update selected camera when prop changes
    useEffect(() => {
        if (selectedCameraId) {
            const camera = cameras.find(c => c.id === selectedCameraId);
            if (camera) setSelectedCamera(camera);
        }
    }, [selectedCameraId, cameras]);

    return (
        <div className={`relative w-full h-full min-h-[400px] ${className}`}>
            <MapContainer
                ref={mapRef}
                center={mapCenter}
                zoom={defaultZoom}
                className="w-full h-full rounded-xl z-0"
                style={{ minHeight: '400px' }}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                
                <MapController 
                    center={mapCenter} 
                    zoom={defaultZoom}
                    selectedCamera={selectedCamera}
                />
                
                {camerasWithCoords.map(camera => (
                    <CameraMarker
                        key={camera.id}
                        camera={camera}
                        isSelected={selectedCamera?.id === camera.id}
                        onSelect={handleSelect}
                        onViewStream={handleViewStream}
                    />
                ))}
            </MapContainer>
            
            {/* Camera count badge */}
            <div className="absolute top-3 right-3 z-[1000] bg-white dark:bg-gray-800 px-3 py-1.5 rounded-full shadow-lg text-sm font-medium text-gray-700 dark:text-gray-200">
                {camerasWithCoords.length} Kamera
            </div>
            
            {/* No coordinates warning */}
            {cameras.length > 0 && camerasWithCoords.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl z-[1000]">
                    <div className="text-center p-6">
                        <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                            <circle cx="12" cy="11" r="3"/>
                        </svg>
                        <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Belum Ada Koordinat
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">
                            Tambahkan koordinat latitude/longitude pada kamera di panel admin
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
});

MapView.displayName = 'MapView';

export default MapView;
