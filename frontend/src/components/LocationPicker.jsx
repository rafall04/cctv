/**
 * LocationPicker Component
 * Interactive map for selecting camera location coordinates
 * Click on map to set position, drag marker to adjust
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Custom marker icon for location picker
const createPickerIcon = () => {
    return L.divIcon({
        className: 'location-picker-marker',
        html: `
            <div style="
                width: 40px;
                height: 40px;
                position: relative;
            ">
                <div style="
                    width: 40px;
                    height: 40px;
                    background: linear-gradient(135deg, #0ea5e9, #3b82f6);
                    border: 3px solid white;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    box-shadow: 0 3px 10px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <svg style="transform: rotate(45deg);" width="18" height="18" viewBox="0 0 24 24" fill="white">
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>
            </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
    });
};

// Map click handler component
function MapClickHandler({ onLocationSelect }) {
    useMapEvents({
        click: (e) => {
            onLocationSelect(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

// Map center controller
function MapController({ center }) {
    const map = useMap();
    
    useEffect(() => {
        if (center) {
            map.flyTo(center, map.getZoom(), { duration: 0.3 });
        }
    }, [center, map]);
    
    return null;
}

// Search box component
function SearchBox({ onSearch }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const timeoutRef = useRef(null);

    const searchLocation = useCallback(async (searchQuery) => {
        if (!searchQuery || searchQuery.length < 3) {
            setResults([]);
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&countrycodes=id`
            );
            const data = await response.json();
            setResults(data);
            setShowResults(true);
        } catch (error) {
            console.error('Search error:', error);
            setResults([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleInputChange = (e) => {
        const value = e.target.value;
        setQuery(value);
        
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        
        timeoutRef.current = setTimeout(() => {
            searchLocation(value);
        }, 500);
    };

    const handleSelect = (result) => {
        onSearch(parseFloat(result.lat), parseFloat(result.lon), result.display_name);
        setQuery(result.display_name.split(',')[0]);
        setShowResults(false);
    };

    return (
        <div className="relative">
            <div className="relative">
                <input
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    onFocus={() => results.length > 0 && setShowResults(true)}
                    placeholder="Cari lokasi..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {loading ? (
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                        </svg>
                    )}
                </div>
            </div>
            
            {showResults && results.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto">
                    {results.map((result, index) => (
                        <button
                            key={index}
                            onClick={() => handleSelect(result)}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700/50 last:border-0 transition-colors"
                        >
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {result.display_name.split(',')[0]}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                {result.display_name}
                            </p>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

const LocationPicker = ({ 
    latitude, 
    longitude, 
    onLocationChange,
    defaultCenter = [-7.1507, 111.8815], // Default: Bojonegoro
    defaultZoom = 13,
}) => {
    const [position, setPosition] = useState(
        latitude && longitude ? [parseFloat(latitude), parseFloat(longitude)] : null
    );
    const [mapCenter, setMapCenter] = useState(
        latitude && longitude ? [parseFloat(latitude), parseFloat(longitude)] : defaultCenter
    );

    // Update position when props change
    useEffect(() => {
        if (latitude && longitude) {
            const newPos = [parseFloat(latitude), parseFloat(longitude)];
            setPosition(newPos);
            setMapCenter(newPos);
        }
    }, [latitude, longitude]);

    const handleLocationSelect = useCallback((lat, lng) => {
        const newPos = [lat, lng];
        setPosition(newPos);
        onLocationChange(lat.toFixed(6), lng.toFixed(6));
    }, [onLocationChange]);

    const handleSearch = useCallback((lat, lng) => {
        const newPos = [lat, lng];
        setPosition(newPos);
        setMapCenter(newPos);
        onLocationChange(lat.toFixed(6), lng.toFixed(6));
    }, [onLocationChange]);

    const handleClear = useCallback(() => {
        setPosition(null);
        onLocationChange('', '');
    }, [onLocationChange]);

    return (
        <div className="space-y-3">
            {/* Search Box */}
            <SearchBox onSearch={handleSearch} />
            
            {/* Map Container */}
            <div className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                <MapContainer
                    center={mapCenter}
                    zoom={defaultZoom}
                    className="w-full h-[250px] z-0"
                    style={{ background: '#f3f4f6' }}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    
                    <MapController center={mapCenter} />
                    <MapClickHandler onLocationSelect={handleLocationSelect} />
                    
                    {position && (
                        <Marker
                            position={position}
                            icon={createPickerIcon()}
                            draggable={true}
                            eventHandlers={{
                                dragend: (e) => {
                                    const { lat, lng } = e.target.getLatLng();
                                    handleLocationSelect(lat, lng);
                                },
                            }}
                        />
                    )}
                </MapContainer>
                
                {/* Instructions overlay */}
                {!position && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                        <div className="bg-white dark:bg-gray-800 px-4 py-2 rounded-lg shadow-lg text-sm text-gray-600 dark:text-gray-300">
                            Klik pada peta untuk memilih lokasi
                        </div>
                    </div>
                )}
            </div>
            
            {/* Coordinates Display */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-sm">
                    {position ? (
                        <>
                            <span className="text-gray-500 dark:text-gray-400">
                                <span className="font-medium text-gray-700 dark:text-gray-200">Lat:</span> {position[0].toFixed(6)}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400">
                                <span className="font-medium text-gray-700 dark:text-gray-200">Lng:</span> {position[1].toFixed(6)}
                            </span>
                        </>
                    ) : (
                        <span className="text-gray-400 dark:text-gray-500 italic">Belum ada koordinat</span>
                    )}
                </div>
                
                {position && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors"
                    >
                        Hapus Lokasi
                    </button>
                )}
            </div>
        </div>
    );
};

export default LocationPicker;
