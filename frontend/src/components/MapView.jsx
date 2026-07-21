/*
 * Purpose: Public CCTV map with live stream markers, aggregation, and area-focused navigation.
 * Caller: Public landing page and camera browsing routes.
 * Deps: React, react-leaflet, Leaflet, stream/viewer services, map area and coordinate utilities.
 * MainFuncs: MapView, createCameraIcon, buildBoundsFromCameras.
 * SideEffects: Initializes Leaflet default icons, opens viewer streams, tracks viewer sessions.
 */

import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, ZoomControl, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/leaflet-overrides.css';
import { settingsService } from '../services/settingsService';
import VideoPopup from './MultiView/VideoPopup.jsx';
import MapTopChrome from './maps/MapTopChrome.jsx';
import { getCameraAvailabilityState } from '../utils/cameraAvailability.js';
import { isBroadAreaCoverage, resolveAreaFocusZoom } from '../utils/areaCoverage';
import { buildAreaSummaryList, getCentroidFromCameras } from '../utils/mapAreaSummary.js';
import { applyMarkerOffset } from '../utils/mapMarkerLayout.js';
import {
    getBoundsCenterFromCameras,
    hasValidCoords,
    normalizeAreaKey,
} from '../utils/mapCoordinateUtils.js';
import { sortCamerasByDistance, formatDistanceLabel } from '../utils/geoDistance.js';
import { useGeolocation } from '../hooks/useGeolocation.js';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Cache icon untuk menghindari pembuatan ulang
const iconCache = new Map();
const AREA_AGGREGATE_ZOOM = 13;
const INDIVIDUAL_MARKER_ZOOM = 16;
const DENSE_AREA_THRESHOLD = 24;
const ALL_AREA_SUPER_AGGREGATE_ZOOM = 11;
const VIEWPORT_RECALC_DEBOUNCE_MS = 100;
const MAX_VISIBLE_INDIVIDUAL_MARKERS = 120;
// Neighborhood scale for "Cek CCTV terdekat" so individual nearby cameras become visible.
const USER_LOCATION_ZOOM = 16;
// Radius used to summarize how many cameras sit near the located user (+ a clean round-km label).
const NEARBY_RADIUS_METERS = 5000;
const NEARBY_RADIUS_LABEL = '5 km';

// "You are here" marker icon (cached). Reuses the transparent divIcon wrapper convention; the
// blue dot + pulse styling lives in styles/leaflet-overrides.css (.custom-user-marker).
const createUserLocationIcon = () => {
    const cacheKey = 'user-location';
    if (iconCache.has(cacheKey)) {
        return iconCache.get(cacheKey);
    }

    const icon = L.divIcon({
        className: 'custom-user-marker',
        html: `
            <div class="user-location-dot">
                <span class="user-location-pulse"></span>
                <span class="user-location-core"></span>
            </div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
    });

    iconCache.set(cacheKey, icon);
    return icon;
};

// CCTV Marker - dengan support status (active, maintenance, tunnel, offline)
const createCameraIcon = (status = 'active', isTunnel = false, isOnline = true, availabilityState = 'online') => {
    // Status priority: maintenance > offline > tunnel > stable
    let cacheKey;
    if (status === 'maintenance') {
        cacheKey = 'maintenance';
    } else if (!isOnline) {
        cacheKey = 'offline';
    } else if (availabilityState === 'degraded') {
        cacheKey = 'degraded';
    } else if (isTunnel) {
        cacheKey = 'tunnel';
    } else {
        cacheKey = 'stable';
    }

    if (iconCache.has(cacheKey)) {
        return iconCache.get(cacheKey);
    }

    let color, darkColor;
    if (status === 'maintenance') {
        color = '#ef4444'; // merah
        darkColor = '#dc2626';
    } else if (!isOnline) {
        color = '#6b7280'; // abu-abu (offline)
        darkColor = '#4b5563';
    } else if (availabilityState === 'degraded') {
        color = '#f59e0b';
        darkColor = '#d97706';
    } else if (isTunnel) {
        color = '#f97316'; // orange
        darkColor = '#ea580c';
    } else {
        color = '#10b981'; // hijau
        darkColor = '#059669';
    }

    let iconSvg;
    if (status === 'maintenance') {
        // Wrench icon
        iconSvg = '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" stroke-width="2" stroke="white" fill="none"/>';
    } else if (!isOnline) {
        // X icon
        iconSvg = '<path d="M6 6l12 12M6 18L18 6" stroke="white" stroke-width="3" stroke-linecap="round" fill="none"/>';
    } else {
        // Simple CCTV icon
        iconSvg = '<path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.98z"/>';
    }

    const icon = L.divIcon({
        className: 'cctv-marker',
        html: `
            <div style="
                position: relative;
                width: 44px;
                height: 44px;
                cursor: pointer;
            ">
                <div style="
                    width: 44px;
                    height: 44px;
                    background: linear-gradient(135deg, ${color} 0%, ${darkColor} 100%);
                    border: 3px solid white;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style="transform: rotate(45deg);">
                        ${iconSvg}
                    </svg>
                </div>
            </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 44],
    });

    iconCache.set(cacheKey, icon);
    return icon;
};

const buildBoundsFromCameras = (cameras = []) => {
    const validCameras = Array.isArray(cameras) ? cameras.filter(hasValidCoords) : [];
    if (validCameras.length === 0) {
        return null;
    }

    return L.latLngBounds(validCameras.map((camera) => [
        parseFloat(camera.latitude),
        parseFloat(camera.longitude),
    ]));
};

const normalizeBounds = (bounds) => {
    if (!bounds) return null;
    if (typeof bounds.getSouth === 'function') {
        return {
            south: bounds.getSouth(),
            west: bounds.getWest(),
            north: bounds.getNorth(),
            east: bounds.getEast(),
        };
    }
    if (bounds.south !== undefined) {
        return bounds;
    }
    return null;
};

const isCameraInBounds = (camera, bounds, padding = 0.02) => {
    const normalizedBounds = normalizeBounds(bounds);
    if (!normalizedBounds || !hasValidCoords(camera)) {
        return true;
    }

    const lat = parseFloat(camera.latitude);
    const lng = parseFloat(camera.longitude);

    return lat >= normalizedBounds.south - padding
        && lat <= normalizedBounds.north + padding
        && lng >= normalizedBounds.west - padding
        && lng <= normalizedBounds.east + padding;
};

const getGroupMarkerColor = (cameras = []) => {
    const counts = cameras.reduce((acc, camera) => {
        const state = getCameraAvailabilityState(camera);
        acc[state] = (acc[state] || 0) + 1;
        return acc;
    }, {});
    const total = cameras.length || 1;
    const offlineCount = counts.offline || 0;
    const degradedCount = counts.degraded || 0;
    const suspectCount = counts.suspect || 0;
    const unhealthyRatio = (offlineCount + degradedCount + suspectCount) / total;

    if (offlineCount === cameras.length) {
        return { color: '#6b7280', darkColor: '#4b5563' };
    }
    if (unhealthyRatio >= 0.45 || degradedCount > 0 || suspectCount > 0) {
        return { color: '#f59e0b', darkColor: '#d97706' };
    }
    return { color: '#0ea5e9', darkColor: '#0284c7' };
};

const getGroupMarkerProfile = (kind = 'group', count = 0) => {
    const normalizedCount = Math.min(count, 999);
    const digits = String(normalizedCount).length;

    if (kind === 'area') {
        return {
            size: 58,
            borderRadius: 22,
            fontSize: digits >= 3 ? 18 : 22,
            ringOpacity: 0.2,
            shadow: '0 14px 32px rgba(15,23,42,0.24)',
            countLabel: count > 999 ? '999+' : String(count),
            glowSize: 72,
        };
    }

    if (kind === 'cluster') {
        return {
            size: 50,
            borderRadius: 20,
            fontSize: digits >= 3 ? 17 : 20,
            ringOpacity: 0.22,
            shadow: '0 12px 28px rgba(15,23,42,0.24)',
            countLabel: count > 999 ? '999+' : String(count),
            glowSize: 66,
        };
    }

    return {
        size: 50,
        borderRadius: 18,
        fontSize: digits >= 3 ? 16 : 19,
        ringOpacity: 0.26,
        shadow: '0 10px 24px rgba(15,23,42,0.22)',
        countLabel: count > 999 ? '999+' : String(count),
        glowSize: 62,
    };
};

const createGroupIcon = (count, cameras = [], kind = 'group') => {
    const hasDegraded = cameras.some((camera) => getCameraAvailabilityState(camera) === 'degraded');
    const allOffline = cameras.every((camera) => getCameraAvailabilityState(camera) === 'offline');
    const countLabel = count > 999 ? '999+' : String(count);
    const colorKey = `${kind}-${countLabel}-${hasDegraded}-${allOffline}`;
    if (iconCache.has(colorKey)) {
        return iconCache.get(colorKey);
    }

    const { color, darkColor } = getGroupMarkerColor(cameras);
    const profile = getGroupMarkerProfile(kind, count);
    const icon = L.divIcon({
        className: 'cctv-group-marker',
        html: `
            <div style="
                display:flex;
                align-items:center;
                justify-content:center;
                width:${profile.size}px;
                height:${profile.size}px;
                background:linear-gradient(135deg, ${color} 0%, ${darkColor} 100%);
                border:2px solid rgba(255,255,255,0.88);
                border-radius:${profile.borderRadius}px;
                box-shadow:${profile.shadow};
                backdrop-filter:blur(10px);
                color:white;
                font-weight:700;
                position:relative;
                overflow:hidden;
                cursor:pointer;
                transition:transform 160ms ease, box-shadow 160ms ease;
            ">
                <div style="
                    position:absolute;
                    inset:0;
                    border-radius:${Math.max(profile.borderRadius - 3, 12)}px;
                    inset:3px;
                    border:1px solid rgba(255,255,255,${profile.ringOpacity});
                    box-sizing:border-box;
                    pointer-events:none;
                "></div>
                <div style="
                    position:absolute;
                    top:-10px;
                    left:50%;
                    width:${profile.glowSize}px;
                    height:${Math.round(profile.glowSize * 0.62)}px;
                    transform:translateX(-50%);
                    background:radial-gradient(circle, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.06) 55%, rgba(255,255,255,0) 100%);
                    pointer-events:none;
                "></div>
                <span style="
                    position:relative;
                    font-size:${profile.fontSize}px;
                    line-height:1;
                    font-weight:800;
                    letter-spacing:-0.04em;
                    text-shadow:0 1px 2px rgba(15,23,42,0.18);
                ">${profile.countLabel}</span>
            </div>
        `,
        iconSize: [profile.size, profile.size],
        iconAnchor: [profile.size / 2, profile.size / 2],
    });

    iconCache.set(colorKey, icon);
    return icon;
};

const bucketCamerasByCoordinate = (cameras, zoom) => {
    const precision = zoom >= 15 ? 4 : (zoom >= 13 ? 3 : 2);
    const grouped = new Map();

    cameras.forEach((camera) => {
        if (!hasValidCoords(camera)) {
            return;
        }

        const lat = parseFloat(camera.latitude);
        const lng = parseFloat(camera.longitude);
        const key = `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(camera);
    });

    return Array.from(grouped.values())
        .map((group) => {
            const first = group[0];
            const centroid = getCentroidFromCameras(group);
            const boundsCenter = getBoundsCenterFromCameras(group);
            const center = centroid || boundsCenter || {
                latitude: parseFloat(first.latitude),
                longitude: parseFloat(first.longitude),
            };
            const areaBreakdown = group.reduce((acc, camera) => {
                const areaName = String(camera.area_name || '').trim() || 'Tanpa Area';
                acc[areaName] = (acc[areaName] || 0) + 1;
                return acc;
            }, {});
            const dominantAreaEntry = Object.entries(areaBreakdown)
                .sort((left, right) => right[1] - left[1])[0];
            const bounds = buildBoundsFromCameras(group);

            if (!bounds || Number.isNaN(center.latitude) || Number.isNaN(center.longitude)) {
                return null;
            }

            return {
                key: `${precision}-${center.latitude.toFixed(5)}-${center.longitude.toFixed(5)}-${group.length}-${first.id}`,
                latitude: center.latitude,
                longitude: center.longitude,
                count: group.length,
                cameras: group,
                center,
                bounds,
                dominantAreaName: dominantAreaEntry?.[0] || null,
                statusSummary: {
                    onlineCount: group.filter((camera) => {
                        const state = getCameraAvailabilityState(camera);
                        return state !== 'offline' && state !== 'degraded' && state !== 'suspect' && camera.status !== 'maintenance';
                    }).length,
                    degradedCount: group.filter((camera) => {
                        const state = getCameraAvailabilityState(camera);
                        return state === 'degraded' || state === 'suspect';
                    }).length,
                    offlineCount: group.filter((camera) => {
                        const state = getCameraAvailabilityState(camera);
                        return state === 'offline' || camera.status === 'maintenance';
                    }).length,
                },
            };
        })
        .filter(Boolean)
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            if (left.latitude !== right.latitude) {
                return left.latitude - right.latitude;
            }
            return left.longitude - right.longitude;
        });
};

// Map controller
function MapController({ viewportCommand, onViewportChange, onCommandApplied }) {
    const map = useMap();
    const lastAppliedCommandRef = useRef(null);

    useMapEvents({
        dragstart() {
            onViewportChange?.({
                hasUserInteracted: true,
                viewportMode: 'user_controlled',
            });
        },
        zoomend() {
            onViewportChange?.({
                currentZoom: typeof map.getZoom === 'function' ? map.getZoom() : null,
                currentBounds: typeof map.getBounds === 'function' ? normalizeBounds(map.getBounds()) : null,
            });
        },
        moveend() {
            onViewportChange?.({
                currentZoom: typeof map.getZoom === 'function' ? map.getZoom() : null,
                currentBounds: typeof map.getBounds === 'function' ? normalizeBounds(map.getBounds()) : null,
            });
        },
    });

    useEffect(() => {
        if (viewportCommand?.id && viewportCommand.id !== lastAppliedCommandRef.current) {
            if (viewportCommand.bounds?.isValid?.()) {
                map.fitBounds(viewportCommand.bounds, {
                    paddingTopLeft: [50, 80],
                    paddingBottomRight: [50, 40],
                    maxZoom: viewportCommand.maxZoom || 16,
                });
            } else if (viewportCommand.center) {
                map.setView(viewportCommand.center, viewportCommand.zoom || 15, { animate: true, duration: 0.5 });
            }

            lastAppliedCommandRef.current = viewportCommand.id;
            onCommandApplied?.(viewportCommand);
        }
    }, [map, onCommandApplied, viewportCommand]);

    useEffect(() => {
        onViewportChange?.({
            currentZoom: typeof map.getZoom === 'function' ? map.getZoom() : null,
            currentBounds: typeof map.getBounds === 'function' ? normalizeBounds(map.getBounds()) : null,
        });
    }, [map, onViewportChange]);

    return null;
}

// Camera Marker - dengan support untuk grouped markers dan status
const CameraMarker = memo(({ camera, onClick }) => {
    if (!hasValidCoords(camera)) return null;
    // Gunakan display coordinates jika ada (untuk offset)
    const lat = camera._displayLat ?? parseFloat(camera.latitude);
    const lng = camera._displayLng ?? parseFloat(camera.longitude);
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
    const availabilityState = getCameraAvailabilityState(camera);
    const isOnline = availabilityState !== 'offline';
    const status = camera.status || 'active';

    return (
        <Marker
            position={[lat, lng]}
            icon={createCameraIcon(status, isTunnel, isOnline, availabilityState)}
            eventHandlers={{ click: () => onClick(camera) }}
        />
    );
});
CameraMarker.displayName = 'CameraMarker';

const AggregateMarker = memo(({ marker, onClick }) => (
    (Number.isFinite(marker?.latitude) && Number.isFinite(marker?.longitude))
        ? (
            <Marker
                position={[marker.latitude, marker.longitude]}
                icon={createGroupIcon(marker.count, marker.cameras, marker.kind)}
                eventHandlers={{ click: () => onClick(marker) }}
            />
        )
        : null
));
AggregateMarker.displayName = 'AggregateMarker';

const ImperativeMarkerLayer = memo(({ cameras = [], onClick }) => {
    const map = useMap();
    const layerGroupRef = useRef(null);
    const markersRef = useRef(new Map());
    const cameraLookupRef = useRef(new Map());
    const onClickRef = useRef(onClick);
    const supportsImperativeMarkers = typeof L.layerGroup === 'function' && typeof L.marker === 'function';

    useEffect(() => {
        onClickRef.current = onClick;
    }, [onClick]);

    useEffect(() => {
        cameraLookupRef.current = new Map(cameras.map((camera) => [camera.id, camera]));
    }, [cameras]);

    useEffect(() => {
        if (!supportsImperativeMarkers) {
            return undefined;
        }

        if (!layerGroupRef.current) {
            const layerGroup = L.layerGroup();
            layerGroup.addTo?.(map);
            layerGroupRef.current = layerGroup;
        }

        const layerGroup = layerGroupRef.current;
        const nextIds = new Set();

        cameras.forEach((camera) => {
            if (!hasValidCoords(camera)) {
                return;
            }

            const lat = camera._displayLat ?? parseFloat(camera.latitude);
            const lng = camera._displayLng ?? parseFloat(camera.longitude);
            const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
            const availabilityState = getCameraAvailabilityState(camera);
            const isOnline = availabilityState !== 'offline';
            const status = camera.status || 'active';
            const icon = createCameraIcon(status, isTunnel, isOnline, availabilityState);

            nextIds.add(camera.id);
            let marker = markersRef.current.get(camera.id);
            if (!marker) {
                marker = L.marker([lat, lng], { icon });
                marker.on?.('click', () => {
                    const currentCamera = cameraLookupRef.current.get(camera.id);
                    if (currentCamera) {
                        onClickRef.current?.(currentCamera);
                    }
                });
                marker.addTo?.(layerGroup);
                layerGroup.addLayer?.(marker);
                markersRef.current.set(camera.id, marker);
                return;
            }

            marker.setLatLng?.([lat, lng]);
            marker.setIcon?.(icon);
        });

        markersRef.current.forEach((marker, cameraId) => {
            if (nextIds.has(cameraId)) {
                return;
            }

            layerGroup.removeLayer?.(marker);
            marker.remove?.();
            markersRef.current.delete(cameraId);
        });

        return undefined;
    }, [cameras, map, supportsImperativeMarkers]);

    useEffect(() => () => {
        if (!supportsImperativeMarkers) {
            return;
        }

        markersRef.current.forEach((marker) => {
            layerGroupRef.current?.removeLayer?.(marker);
            marker.remove?.();
        });
        markersRef.current.clear();
        layerGroupRef.current?.remove?.();
        layerGroupRef.current = null;
    }, [supportsImperativeMarkers]);

    if (!supportsImperativeMarkers) {
        return (
            <>
                {cameras.map((camera) => (
                    <CameraMarker key={camera.id} camera={camera} onClick={onClick} />
                ))}
            </>
        );
    }

    return null;
});
ImperativeMarkerLayer.displayName = 'ImperativeMarkerLayer';

// Main MapView
const MapView = memo(({
    cameras = [],
    areas = [],
    defaultCenter = [-7.1507, 111.8815],
    defaultZoom = 11, // Zoom level untuk skala kabupaten
    className = '',
    focusedCameraId = null, // ID kamera yang akan difokuskan
    onFocusHandled = null, // Callback setelah fokus ditangani
    selectedArea: controlledSelectedArea = undefined,
    onAreaChange = null,
    showAreaFilter = true,
    adsConfig = null,
    onCameraOpen = null,
}) => {
    const [internalSelectedArea, setInternalSelectedArea] = useState('all');
    const selectedAreaValue = controlledSelectedArea ?? internalSelectedArea;
    const [modalCamera, setModalCamera] = useState(null);
    const [mapSettings, setMapSettings] = useState({
        latitude: defaultCenter[0],
        longitude: defaultCenter[1],
        zoom: defaultZoom,
        name: 'Semua Lokasi'
    });
    const [pendingFocusCamera, setPendingFocusCamera] = useState(null);
    const [viewportCommand, setViewportCommand] = useState(null);
    const [viewportState, setViewportState] = useState({
        currentZoom: defaultZoom,
        currentBounds: null,
        hasUserInteracted: false,
        viewportMode: 'initial',
        lastAppliedArea: selectedAreaValue,
        lastAppliedFocusCameraId: null,
    });
    const [debouncedViewportState, setDebouncedViewportState] = useState({
        currentZoom: defaultZoom,
        currentBounds: null,
    });
    const initialViewportAppliedRef = useRef(false);
    const commandCounterRef = useRef(0);
    const previousSelectedAreaRef = useRef(selectedAreaValue);
    const lastFocusedCameraIdRef = useRef(null);

    // Opt-in GPS "Cek CCTV terdekat" — only requests location on explicit button press.
    const {
        position: rawUserLocation,
        loading: isLocating,
        error: locateError,
        requestLocation,
        clearPosition,
    } = useGeolocation();

    // A fix at exactly (0,0) is a bogus/zeroed reading (Null Island), not a real location in our
    // coverage area. Treat only finite, non-null-island coordinates as usable so the marker, fly-to,
    // and nearby summary all agree on what counts as "located".
    const userLocation = useMemo(() => {
        if (!rawUserLocation) {
            return null;
        }
        const { latitude, longitude } = rawUserLocation;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }
        if (latitude === 0 && longitude === 0) {
            return null;
        }
        return rawUserLocation;
    }, [rawUserLocation]);

    const handleLocateMe = useCallback(() => {
        requestLocation();
    }, [requestLocation]);

    const setSelectedAreaValue = useCallback((value) => {
        if (typeof onAreaChange === 'function') {
            onAreaChange(value);
            return;
        }
        setInternalSelectedArea(value);
    }, [onAreaChange]);

    // Load map settings from backend
    useEffect(() => {
        settingsService.getMapCenter().then(res => {
            if (res.success && res.data) {
                setMapSettings(res.data);
            }
        }).catch(() => { });
    }, []);

    const enqueueViewportCommand = useCallback((command) => {
        commandCounterRef.current += 1;
        setViewportCommand({
            id: commandCounterRef.current,
            ...command,
        });
    }, []);

    // When the user shares their location, fly the map there at neighborhood zoom so nearby
    // cameras become visible. A new position object on each request re-triggers this.
    useEffect(() => {
        if (!userLocation) {
            return;
        }
        enqueueViewportCommand({
            type: 'focus_user',
            center: [userLocation.latitude, userLocation.longitude],
            zoom: USER_LOCATION_ZOOM,
        });
    }, [userLocation, enqueueViewportCommand]);

    useEffect(() => {
        if (!focusedCameraId || focusedCameraId === lastFocusedCameraIdRef.current) {
            return;
        }

        const camera = cameras.find(c => c.id === focusedCameraId);
        if (!camera || !hasValidCoords(camera)) {
            return;
        }

        lastFocusedCameraIdRef.current = focusedCameraId;
        if (camera.area_name && selectedAreaValue !== camera.area_name && selectedAreaValue !== 'all') {
            setSelectedAreaValue('all');
        }

        setPendingFocusCamera(camera);
        enqueueViewportCommand({
            type: 'focus_camera',
            center: [parseFloat(camera.latitude), parseFloat(camera.longitude)],
            zoom: 17,
        });
        onFocusHandled?.();
    }, [cameras, enqueueViewportCommand, focusedCameraId, onFocusHandled, selectedAreaValue, setSelectedAreaValue]);

    useEffect(() => {
        if (pendingFocusCamera) {
            const timer = setTimeout(() => {
                if (typeof onCameraOpen === 'function') {
                    onCameraOpen(pendingFocusCamera);
                } else {
                    setModalCamera(pendingFocusCamera);
                }
                setPendingFocusCamera(null);
            }, 600);
            return () => clearTimeout(timer);
        }
    }, [onCameraOpen, pendingFocusCamera]);

    useEffect(() => {
        const previousSelectedArea = previousSelectedAreaRef.current;
        if (previousSelectedArea !== selectedAreaValue) {
            setPendingFocusCamera(null);
            setViewportState((current) => ({
                ...current,
                hasUserInteracted: false,
                viewportMode: 'programmatic',
            }));
        }
    }, [selectedAreaValue]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedViewportState({
                currentZoom: viewportState.currentZoom,
                currentBounds: viewportState.currentBounds,
            });
        }, VIEWPORT_RECALC_DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [viewportState.currentBounds, viewportState.currentZoom]);

    const camerasWithCoords = useMemo(() => cameras.filter(hasValidCoords), [cameras]);

    // Summary shown after locating: how many cameras sit within NEARBY_RADIUS_METERS of the user,
    // plus the single nearest one. Straight-line (haversine); honest "garis lurus" wording.
    const nearbyMessage = useMemo(() => {
        if (!userLocation) {
            return null;
        }
        const ranked = sortCamerasByDistance(camerasWithCoords, userLocation);
        const nearest = ranked.find((camera) => Number.isFinite(camera._distanceMeters));
        if (!nearest) {
            return 'Belum ada CCTV dengan koordinat.';
        }
        const nearestName = nearest.name?.trim() || 'CCTV terdekat';
        const nearestLabel = `${nearestName} (${formatDistanceLabel(nearest._distanceMeters)})`;
        const withinRadius = ranked.filter((camera) => (
            Number.isFinite(camera._distanceMeters) && camera._distanceMeters <= NEARBY_RADIUS_METERS
        )).length;

        return withinRadius > 0
            ? `${withinRadius} CCTV dalam ${NEARBY_RADIUS_LABEL} · terdekat ${nearestLabel}`
            : `Tidak ada CCTV dalam ${NEARBY_RADIUS_LABEL}. Terdekat ${nearestLabel}`;
    }, [userLocation, camerasWithCoords]);

    const camerasWithCoordsByAreaKey = useMemo(() => {
        const nextMap = new Map();
        camerasWithCoords.forEach((camera) => {
            const areaKey = normalizeAreaKey(camera?.area_name);
            if (!areaKey) return;
            if (!nextMap.has(areaKey)) {
                nextMap.set(areaKey, []);
            }
            nextMap.get(areaKey).push(camera);
        });
        return nextMap;
    }, [camerasWithCoords]);

    const areaSummaryList = useMemo(() => (
        buildAreaSummaryList(areas, camerasWithCoords)
    ), [areas, camerasWithCoords]);

    const areaSummaryByKey = useMemo(() => {
        const nextMap = new Map();
        areaSummaryList.forEach((summary) => {
            nextMap.set(summary.areaKey, summary);
        });
        return nextMap;
    }, [areaSummaryList]);

    const areaNames = useMemo(() => {
        return areaSummaryList.map((summary) => summary.areaName);
    }, [areaSummaryList]);

    const areaCounts = useMemo(() => {
        const nextMap = new Map();
        areaSummaryList.forEach((summary) => {
            nextMap.set(summary.areaName, summary.cameraCount);
        });
        return nextMap;
    }, [areaSummaryList]);

    const filteredBase = useMemo(() => {
        if (selectedAreaValue === 'all') {
            return camerasWithCoords;
        }
        return camerasWithCoordsByAreaKey.get(normalizeAreaKey(selectedAreaValue)) || [];
    }, [camerasWithCoords, camerasWithCoordsByAreaKey, selectedAreaValue]);

    const visibleBase = useMemo(() => (
        filteredBase.filter((camera) => isCameraInBounds(camera, debouncedViewportState.currentBounds))
    ), [debouncedViewportState.currentBounds, filteredBase]);

    const effectiveZoom = debouncedViewportState.currentZoom || mapSettings.zoom || defaultZoom;
    const hasMultipleCamerasInScope = filteredBase.length > 1;
    const shouldForceAllAreaSuperAggregate = selectedAreaValue === 'all'
        && hasMultipleCamerasInScope
        && effectiveZoom < ALL_AREA_SUPER_AGGREGATE_ZOOM;

    const shouldUseAllAreaSuperAggregateMarkers = shouldForceAllAreaSuperAggregate;
    const shouldUseAggregateMarkers = filteredBase.length > DENSE_AREA_THRESHOLD
        && effectiveZoom >= ALL_AREA_SUPER_AGGREGATE_ZOOM
        && effectiveZoom < AREA_AGGREGATE_ZOOM;
    const shouldUseGroupedMarkers = filteredBase.length > DENSE_AREA_THRESHOLD && effectiveZoom >= AREA_AGGREGATE_ZOOM && effectiveZoom < INDIVIDUAL_MARKER_ZOOM;
    const shouldUseMicroBucketMarkers = effectiveZoom >= INDIVIDUAL_MARKER_ZOOM && visibleBase.length > MAX_VISIBLE_INDIVIDUAL_MARKERS;
    const shouldShowZoomHint = filteredBase.length > DENSE_AREA_THRESHOLD && effectiveZoom < INDIVIDUAL_MARKER_ZOOM;
    const spatialClusterSource = selectedAreaValue === 'all' ? filteredBase : visibleBase;

    const allAreaSuperAggregateMarkers = useMemo(() => {
        if (!shouldUseAllAreaSuperAggregateMarkers) {
            return [];
        }

        return areaSummaryList
            .filter((summary) => summary.hasValidAnchor && summary.cameraCount > 0)
            .map((summary) => ({
                key: `area-${summary.areaKey}-${summary.cameraCount}`,
                kind: 'area',
                areaName: summary.areaName,
                latitude: summary.anchor.latitude,
                longitude: summary.anchor.longitude,
                count: summary.cameraCount,
                cameras: summary.cameras,
                bounds: buildBoundsFromCameras(summary.cameras),
                statusSummary: {
                    onlineCount: summary.onlineCount,
                    degradedCount: summary.degradedCount,
                    offlineCount: summary.offlineCount,
                },
            }))
            .filter((marker) => Number.isFinite(marker.latitude)
                && Number.isFinite(marker.longitude)
                && marker.bounds);
    }, [areaSummaryList, shouldUseAllAreaSuperAggregateMarkers]);

    const areaAggregateMarkers = useMemo(() => {
        if (!shouldUseAggregateMarkers) {
            return [];
        }

        return bucketCamerasByCoordinate(spatialClusterSource, effectiveZoom).map((group) => ({
            ...group,
            kind: selectedAreaValue === 'all' ? 'cluster' : 'bucket',
        }));
    }, [effectiveZoom, selectedAreaValue, shouldUseAggregateMarkers, spatialClusterSource]);

    const groupedVisibleMarkers = useMemo(() => {
        if (!shouldUseGroupedMarkers) {
            return [];
        }
        return bucketCamerasByCoordinate(spatialClusterSource, effectiveZoom).map((group) => ({
            ...group,
            kind: 'bucket',
        }));
    }, [effectiveZoom, shouldUseGroupedMarkers, spatialClusterSource]);

    const microBucketMarkers = useMemo(() => {
        if (!shouldUseMicroBucketMarkers) {
            return [];
        }

        return bucketCamerasByCoordinate(visibleBase, INDIVIDUAL_MARKER_ZOOM - 1).map((group) => ({
            ...group,
            kind: 'bucket',
        }));
    }, [shouldUseMicroBucketMarkers, visibleBase]);

    const visibleIndividualMarkers = useMemo(() => {
        if (shouldUseAllAreaSuperAggregateMarkers || shouldUseAggregateMarkers || shouldUseGroupedMarkers || shouldUseMicroBucketMarkers) {
            return [];
        }
        return applyMarkerOffset(visibleBase);
    }, [shouldUseAggregateMarkers, shouldUseAllAreaSuperAggregateMarkers, shouldUseGroupedMarkers, shouldUseMicroBucketMarkers, visibleBase]);

    const stats = useMemo(() => {
        const maintenance = filteredBase.filter(c => c.status === 'maintenance').length;
        const offline = filteredBase.filter(c => c.status !== 'maintenance' && getCameraAvailabilityState(c) === 'offline').length;
        const online = filteredBase.filter(c => c.status !== 'maintenance' && getCameraAvailabilityState(c) !== 'offline' && !c.is_tunnel).length;
        const tunnel = filteredBase.filter(c => c.status !== 'maintenance' && getCameraAvailabilityState(c) !== 'offline' && (c.is_tunnel === 1 || c.is_tunnel === true)).length;
        return { online, tunnel, offline: offline + maintenance };
    }, [filteredBase]);

    const buildAreaViewportCommand = useCallback((areaName) => {
        if (areaName !== 'all') {
            const summary = areaSummaryByKey.get(normalizeAreaKey(areaName));
            const areaCameras = camerasWithCoordsByAreaKey.get(normalizeAreaKey(areaName)) || [];
            const focusZoom = resolveAreaFocusZoom(
                summary?.coverage_scope,
                summary?.viewport_zoom_override,
                15
            );
            const shouldPreferBounds = isBroadAreaCoverage(summary?.coverage_scope);

            if (areaCameras.length > 0) {
                const areaBounds = buildBoundsFromCameras(areaCameras);
                if (areaBounds && shouldPreferBounds) {
                    return {
                        type: 'focus_area',
                        bounds: areaBounds,
                        maxZoom: focusZoom,
                        areaName: summary?.areaName || areaName,
                    };
                }
            }

            if (summary?.anchor) {
                return {
                    type: 'focus_area',
                    center: [summary.anchor.latitude, summary.anchor.longitude],
                    zoom: focusZoom,
                    areaName: summary.areaName,
                };
            }
        }

        return {
            type: 'focus_default',
            center: [mapSettings.latitude || defaultCenter[0], mapSettings.longitude || defaultCenter[1]],
            zoom: mapSettings.zoom || defaultZoom,
            areaName: 'all',
        };
    }, [areaSummaryByKey, camerasWithCoordsByAreaKey, defaultCenter, defaultZoom, mapSettings]);

    useEffect(() => {
        if (!initialViewportAppliedRef.current && selectedAreaValue) {
            enqueueViewportCommand(buildAreaViewportCommand(selectedAreaValue));
            initialViewportAppliedRef.current = true;
        }
    }, [buildAreaViewportCommand, enqueueViewportCommand, selectedAreaValue]);

    useEffect(() => {
        if (!initialViewportAppliedRef.current) {
            return;
        }

        const previousSelectedArea = previousSelectedAreaRef.current;
        if (previousSelectedArea !== selectedAreaValue) {
            enqueueViewportCommand(buildAreaViewportCommand(selectedAreaValue));
            previousSelectedAreaRef.current = selectedAreaValue;
        }
    }, [buildAreaViewportCommand, enqueueViewportCommand, selectedAreaValue]);

    const openModal = useCallback((camera) => {
        if (typeof onCameraOpen === 'function') {
            onCameraOpen(camera);
            return;
        }
        setModalCamera(camera);
    }, [onCameraOpen]);

    const handleAggregateMarkerClick = useCallback((marker) => {
        if (marker.kind === 'area' && marker.areaName) {
            enqueueViewportCommand(buildAreaViewportCommand(marker.areaName));
            return;
        }

        const targetBounds = marker.bounds || buildBoundsFromCameras(marker.cameras);
        if (!targetBounds) {
            return;
        }

        enqueueViewportCommand({
            type: 'focus_group',
            bounds: targetBounds,
            maxZoom: INDIVIDUAL_MARKER_ZOOM,
        });
    }, [buildAreaViewportCommand, enqueueViewportCommand]);

    const handleAreaChange = (e) => {
        const nextArea = e?.target?.value || 'all';
        setSelectedAreaValue(nextArea);
    };

    const handleResetView = useCallback(() => {
        clearPosition();
        setViewportState((current) => ({
            ...current,
            hasUserInteracted: false,
            viewportMode: 'programmatic',
        }));
        enqueueViewportCommand(buildAreaViewportCommand(selectedAreaValue));
    }, [buildAreaViewportCommand, clearPosition, enqueueViewportCommand, selectedAreaValue]);

    const handleViewportChange = useCallback((nextState) => {
        setViewportState((current) => ({
            ...current,
            ...nextState,
        }));
    }, []);

    const handleCommandApplied = useCallback((command) => {
        const isUserFocus = command.type === 'focus_camera' || command.type === 'focus_user';
        setViewportState((current) => ({
            ...current,
            viewportMode: isUserFocus ? 'user_controlled' : 'programmatic',
            lastAppliedArea: command.areaName || current.lastAppliedArea,
            lastAppliedFocusCameraId: command.type === 'focus_camera' ? focusedCameraId : current.lastAppliedFocusCameraId,
            hasUserInteracted: isUserFocus ? true : current.hasUserInteracted,
        }));
    }, [focusedCameraId]);

    if (cameras.length === 0 || camerasWithCoords.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl min-h-[400px] ${className}`}>
                <div className="text-center p-6">
                    <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
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
                center={defaultCenter}
                zoom={defaultZoom}
                className="w-full h-full"
                style={{ minHeight: '450px', zIndex: 1 }}
                zoomControl={false}
            >
                {/* Layer Control - Pilihan Peta (posisi topright) */}
                <LayersControl position="topright">
                    {/* Hybrid - Google Satellite dengan Label (Default) */}
                    <LayersControl.BaseLayer checked name="Hybrid">
                        <TileLayer
                            attribution='&copy; Google'
                            url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                            maxZoom={20}
                        />
                    </LayersControl.BaseLayer>

                    {/* Street Map */}
                    <LayersControl.BaseLayer name="Street">
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                    </LayersControl.BaseLayer>
                </LayersControl>

                <ZoomControl position="bottomright" />
                <MapController
                    viewportCommand={viewportCommand}
                    onViewportChange={handleViewportChange}
                    onCommandApplied={handleCommandApplied}
                />
                {allAreaSuperAggregateMarkers.map((marker) => (
                    <AggregateMarker key={marker.key} marker={marker} onClick={handleAggregateMarkerClick} />
                ))}
                {areaAggregateMarkers.map((marker) => (
                    <AggregateMarker key={marker.key} marker={marker} onClick={handleAggregateMarkerClick} />
                ))}
                {groupedVisibleMarkers.map((marker) => (
                    <AggregateMarker key={marker.key} marker={marker} onClick={handleAggregateMarkerClick} />
                ))}
                {microBucketMarkers.map((marker) => (
                    <AggregateMarker key={marker.key} marker={marker} onClick={handleAggregateMarkerClick} />
                ))}
                <ImperativeMarkerLayer cameras={visibleIndividualMarkers} onClick={openModal} />
                {userLocation && (
                    <Marker
                        position={[userLocation.latitude, userLocation.longitude]}
                        icon={createUserLocationIcon()}
                    />
                )}
            </MapContainer>

            <MapTopChrome
                showAreaFilter={showAreaFilter}
                selectedAreaValue={selectedAreaValue}
                mapName={mapSettings.name}
                camerasWithCoordsCount={camerasWithCoords.length}
                areaNames={areaNames}
                areaCounts={areaCounts}
                shouldShowZoomHint={shouldShowZoomHint}
                onAreaChange={handleAreaChange}
                onResetView={handleResetView}
                onLocateMe={handleLocateMe}
                isLocating={isLocating}
                locateError={locateError}
                nearbyMessage={nearbyMessage}
            />

            <div className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] w-full -translate-x-1/2 px-3">
                <div
                    className="mx-auto inline-flex max-w-[calc(100%-3rem)] items-center gap-1.5 overflow-hidden rounded-full border border-white/50 bg-white/72 px-2 py-1.5 shadow-[0_16px_36px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/72 sm:gap-2 sm:px-3"
                    data-testid="map-status-bar"
                >
                    {/* "di peta" is load-bearing: this bar counts only cameras that have coordinates,
                        so 317 here vs 667 in the stats bar is not a contradiction. Tunnel pill dropped
                        (internal jargon, and it read 0 publicly anyway). */}
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium leading-none tabular-nums text-content">
                        <span className="h-1.5 w-1.5 rounded-full bg-status-live" />
                        {stats.online} online di peta
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium leading-none tabular-nums text-content-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-status-idle" />
                        {stats.offline} offline
                    </span>
                </div>
            </div>

            {modalCamera && typeof onCameraOpen !== 'function' && (
                <VideoPopup
                    camera={modalCamera}
                    onClose={() => setModalCamera(null)}
                    adsConfig={adsConfig}
                    modalTestId="map-popup-modal"
                    bodyTestId="map-video-body"
                />
            )}
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;


