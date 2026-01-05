/**
 * LocationPicker Component
 * Interactive map for selecting camera location coordinates
 * Optimized for low-end devices with lazy loading
 */

import { useEffect, useRef, useState, useCallback, memo } from 'react';

// Lazy load map components only when needed
let MapContainer, TileLayer, Marker, useMapEvents, useMap, L;
let leafletLoaded = false;

const loadLeaflet = async () => {
    if (leafletLoaded) return true;
    try {
        const [leaflet, reactLeaflet] = await Promise.all([
            import('leaflet'),
            import('react-leaflet')
        ]);
        L = leaflet.default;
        MapContainer = reactLeaflet.MapContainer;
        TileLayer = reactLeaflet.TileLayer;
        Marker = reactLeaflet.Marker;
        useMapEvents = reactLeaflet.useMapEvents;
        useMap = reactLeaflet.useMap;
        
        // Fix default marker icon
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        });
        
        leafletLoaded = true;
        return true;
    } catch (error) {
        console.error('Failed to load Leaflet:', error);
        return false;
    }
};

// Custom marker icon for location picker
const createPickerIcon = () => {
    if (!L) return null;
    return L.divIcon({
        className: 'location-picker-marker',
        html: `
            <div style="width:36px;height:36px;position:relative;">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,#0ea5e9,#3b82f6);border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 3px 10px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
                    <svg style="transform:rotate(45deg);" width="16" height="16" viewBox="0 0 24 24" fill="white">
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
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
            map.setView(center, map.getZoom());
        }
    }, [center, map]);
    return null;
}

// Simple search box - debounced
const SearchBox = memo(function SearchBox({ onSearch }) {
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
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => searchLocation(value), 600);
    };

    const handleSelect = (result) => {
        onSearch(parseFloat(result.lat), parseFloat(result.lon));
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
                    className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                    {loading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                    ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                        </svg>
                    )}
                </div>
            </div>
            {showResults && results.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                    {results.map((result, index) => (
                        <button
                            key={index}
                            type="button"
                            onClick={() => handleSelect(result)}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                        >
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {result.display_name.split(',')[0]}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {result.display_name}
                            </p>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
});

// Map component - only rendered when leaflet is loaded
const MapComponent = memo(function MapComponent({ position, mapCenter, defaultZoom, onLocationSelect }) {
    if (!MapContainer || !TileLayer) return null;
    
    return (
        <MapContainer
            center={mapCenter}
            zoom={defaultZoom}
            className="w-full h-[200px] z-0"
            style={{ background: '#e5e7eb' }}
        >
            <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapController center={mapCenter} />
            <MapClickHandler onLocationSelect={onLocationSelect} />
            {position && Marker && (
                <Marker
                    position={position}
                    icon={createPickerIcon()}
                    draggable={true}
                    eventHandlers={{
                        dragend: (e) => {
                            const { lat, lng } = e.target.getLatLng();
                            onLocationSelect(lat, lng);
                        },
                    }}
                />
            )}
        </MapContainer>
    );
});

const LocationPicker = ({ 
    latitude, 
    longitude, 
    onLocationChange,
    defaultCenter = [-7.1507, 111.8815], // Default: Bojonegoro
    defaultZoom = 13,
}) => {
    const [mapLoaded, setMapLoaded] = useState(false);
    const [showMap, setShowMap] = useState(false);
    const [position, setPosition] = useState(
        latitude && longitude ? [parseFloat(latitude), parseFloat(longitude)] : null
    );
    const [mapCenter, setMapCenter] = useState(
        latitude && longitude ? [parseFloat(latitude), parseFloat(longitude)] : defaultCenter
    );

    // Load leaflet when map is shown
    useEffect(() => {
        if (showMap && !mapLoaded) {
            loadLeaflet().then(success => {
                if (success) setMapLoaded(true);
            });
        }
    }, [showMap, mapLoaded]);

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

    // Collapsed view - just show coordinates and expand button
    if (!showMap) {
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-sm">
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
                            <span className="text-gray-400 dark:text-gray-500 italic text-xs">Belum ada koordinat</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {position && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="text-xs text-red-500 hover:text-red-600 font-medium"
                            >
                                Hapus
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowMap(true)}
                            className="px-3 py-1.5 text-xs font-medium bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 rounded-lg hover:bg-sky-200 dark:hover:bg-sky-500/30 transition-colors"
                        >
                            {position ? 'Edit Peta' : 'Pilih di Peta'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Expanded view with map
    return (
        <div className="space-y-2">
            <SearchBox onSearch={handleSearch} />
            
            <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                {mapLoaded ? (
                    <MapComponent
                        position={position}
                        mapCenter={mapCenter}
                        defaultZoom={defaultZoom}
                        onLocationSelect={handleLocationSelect}
                    />
                ) : (
                    <div className="w-full h-[200px] bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <div className="flex items-center gap-2 text-gray-400">
                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                            </svg>
                            <span className="text-sm">Loading map...</span>
                        </div>
                    </div>
                )}
                
                {!position && mapLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
                        <div className="bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg shadow text-xs text-gray-600 dark:text-gray-300">
                            Klik peta untuk pilih lokasi
                        </div>
                    </div>
                )}
            </div>
            
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs">
                    {position ? (
                        <>
                            <span className="text-gray-500 dark:text-gray-400">
                                Lat: {position[0].toFixed(6)}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400">
                                Lng: {position[1].toFixed(6)}
                            </span>
                        </>
                    ) : (
                        <span className="text-gray-400 dark:text-gray-500 italic">Belum ada koordinat</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {position && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="text-xs text-red-500 hover:text-red-600 font-medium"
                        >
                            Hapus
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowMap(false)}
                        className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium"
                    >
                        Tutup Peta
                    </button>
                </div>
            </div>
        </div>
    );
};

export default memo(LocationPicker);
