/**
 * LocationPicker Component
 * Interactive map for selecting camera location coordinates
 * Optimized for low-end devices - map only loads when user clicks button
 * Features: Search, GPS detection, drag marker
 */

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { settingsService } from '../services/settingsService';
import 'leaflet/dist/leaflet.css';

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
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-[1000] max-h-48 overflow-y-auto">
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

// Lazy loaded map component
const LazyMap = ({ position, mapCenter, defaultZoom, onLocationSelect }) => {
    const mapRef = useRef(null);
    const markerRef = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    const [leafletModules, setLeafletModules] = useState(null);

    // Load leaflet modules
    useEffect(() => {
        let mounted = true;
        
        Promise.all([
            import('leaflet'),
            import('react-leaflet')
        ]).then(([L, RL]) => {
            if (!mounted) return;
            
            // Fix default marker icon
            delete L.default.Icon.Default.prototype._getIconUrl;
            L.default.Icon.Default.mergeOptions({
                iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
                iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            });
            
            setLeafletModules({ L: L.default, RL });
        }).catch(err => {
            console.error('Failed to load leaflet:', err);
        });

        return () => { mounted = false; };
    }, []);

    // Create custom marker icon
    const createPickerIcon = useCallback(() => {
        if (!leafletModules) return null;
        return leafletModules.L.divIcon({
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
    }, [leafletModules]);

    if (!leafletModules) {
        return (
            <div className="w-full h-[200px] bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                <div className="flex items-center gap-2 text-gray-400">
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    <span className="text-sm">Loading map...</span>
                </div>
            </div>
        );
    }

    const { MapContainer, TileLayer, Marker, useMapEvents, useMap } = leafletModules.RL;

    // Map click handler
    const MapClickHandler = () => {
        useMapEvents({
            click: (e) => {
                onLocationSelect(e.latlng.lat, e.latlng.lng);
            },
        });
        return null;
    };

    // Map center controller
    const MapController = ({ center }) => {
        const map = useMap();
        useEffect(() => {
            if (center && map) {
                map.setView(center, map.getZoom());
            }
        }, [center, map]);
        return null;
    };

    return (
        <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            <MapContainer
                center={mapCenter}
                zoom={defaultZoom}
                className="w-full h-[200px]"
                style={{ background: '#e5e7eb', zIndex: 0 }}
            >
                <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController center={mapCenter} />
                <MapClickHandler />
                {position && (
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
            
            {!position && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
                    <div className="bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg shadow text-xs text-gray-600 dark:text-gray-300">
                        Klik peta untuk pilih lokasi
                    </div>
                </div>
            )}
        </div>
    );
};

const LocationPicker = ({ 
    latitude, 
    longitude, 
    onLocationChange,
    defaultCenter = null, // Will load from backend
    defaultZoom = 13,
}) => {
    const [showMap, setShowMap] = useState(false);
    const [position, setPosition] = useState(
        latitude && longitude ? [parseFloat(latitude), parseFloat(longitude)] : null
    );
    const [mapCenter, setMapCenter] = useState(
        latitude && longitude ? [parseFloat(latitude), parseFloat(longitude)] : [-7.1507, 111.8815]
    );
    const [loadingGPS, setLoadingGPS] = useState(false);
    const [gpsError, setGpsError] = useState(null);

    // Load map center from backend on mount
    useEffect(() => {
        if (!defaultCenter) {
            settingsService.getMapCenter().then(res => {
                if (res.success && res.data) {
                    const center = [res.data.latitude, res.data.longitude];
                    // Only update if no position set yet
                    if (!position) {
                        setMapCenter(center);
                    }
                }
            }).catch(() => {
                // Fallback to Bojonegoro if backend fails
                setMapCenter([-7.1507, 111.8815]);
            });
        } else {
            setMapCenter(defaultCenter);
        }
    }, [defaultCenter, position]);

    // Update position when props change
    useEffect(() => {
        if (latitude && longitude) {
            const newPos = [parseFloat(latitude), parseFloat(longitude)];
            setPosition(newPos);
            setMapCenter(newPos);
        } else {
            setPosition(null);
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

    // GPS detection - get current location from device
    const handleUseGPS = useCallback(() => {
        if (!navigator.geolocation) {
            setGpsError('GPS tidak didukung di browser ini');
            setTimeout(() => setGpsError(null), 3000);
            return;
        }

        setLoadingGPS(true);
        setGpsError(null);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const newPos = [lat, lng];
                setPosition(newPos);
                setMapCenter(newPos);
                onLocationChange(lat.toFixed(6), lng.toFixed(6));
                setLoadingGPS(false);
                setShowMap(true); // Auto-expand map to show location
            },
            (error) => {
                setLoadingGPS(false);
                let errorMsg = 'Gagal mendapatkan lokasi GPS';
                if (error.code === error.PERMISSION_DENIED) {
                    errorMsg = 'Akses GPS ditolak. Izinkan akses lokasi di browser.';
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    errorMsg = 'Lokasi tidak tersedia';
                } else if (error.code === error.TIMEOUT) {
                    errorMsg = 'Timeout mendapatkan lokasi';
                }
                setGpsError(errorMsg);
                setTimeout(() => setGpsError(null), 5000);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
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
                            onClick={handleUseGPS}
                            disabled={loadingGPS}
                            className="px-3 py-1.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                            title="Gunakan lokasi GPS device"
                        >
                            {loadingGPS ? (
                                <>
                                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                                    </svg>
                                    <span>GPS...</span>
                                </>
                            ) : (
                                <>
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                        <circle cx="12" cy="11" r="3"/>
                                    </svg>
                                    <span>GPS</span>
                                </>
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowMap(true)}
                            className="px-3 py-1.5 text-xs font-medium bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 rounded-lg hover:bg-sky-200 dark:hover:bg-sky-500/30 transition-colors"
                        >
                            {position ? 'Edit Peta' : 'Pilih di Peta'}
                        </button>
                    </div>
                </div>
                
                {/* GPS Error Message */}
                {gpsError && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                        <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        <p className="text-xs text-red-600 dark:text-red-400">{gpsError}</p>
                    </div>
                )}
            </div>
        );
    }

    // Expanded view with map
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <div className="flex-1">
                    <SearchBox onSearch={handleSearch} />
                </div>
                <button
                    type="button"
                    onClick={handleUseGPS}
                    disabled={loadingGPS}
                    className="px-3 py-2 text-xs font-medium bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                    title="Gunakan lokasi GPS device"
                >
                    {loadingGPS ? (
                        <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                            </svg>
                            <span>GPS...</span>
                        </>
                    ) : (
                        <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                <circle cx="12" cy="11" r="3"/>
                            </svg>
                            <span>GPS</span>
                        </>
                    )}
                </button>
            </div>
            
            {/* GPS Error Message */}
            {gpsError && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                    <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <p className="text-xs text-red-600 dark:text-red-400">{gpsError}</p>
                </div>
            )}
            
            <LazyMap
                position={position}
                mapCenter={mapCenter}
                defaultZoom={defaultZoom}
                onLocationSelect={handleLocationSelect}
            />
            
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
