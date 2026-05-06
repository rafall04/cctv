/*
 * Purpose: Manage public landing camera search, area selection, ranking tabs, and grid/map filtering.
 * Caller: LandingCamerasSection.
 * Deps: React hooks.
 * MainFuncs: useLandingCameraFilters.
 * SideEffects: Tracks local UI filter state and focused map camera state.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

function getCameraMetric(camera, key) {
    return Number(camera?.[key] ?? camera?.viewer_stats?.[key] ?? 0);
}

function sortByNewest(left, right) {
    const rightCreated = String(right?.created_at || '');
    const leftCreated = String(left?.created_at || '');
    const byCreated = rightCreated.localeCompare(leftCreated);
    if (byCreated !== 0) {
        return byCreated;
    }
    return Number(right?.id || 0) - Number(left?.id || 0);
}

function sortGridCameras(cameras, connectionTab) {
    const nextCameras = [...cameras];

    if (connectionTab === 'popular') {
        return nextCameras.sort((left, right) => {
            const byLive = getCameraMetric(right, 'live_viewers') - getCameraMetric(left, 'live_viewers');
            if (byLive !== 0) {
                return byLive;
            }
            const byViews = getCameraMetric(right, 'total_views') - getCameraMetric(left, 'total_views');
            if (byViews !== 0) {
                return byViews;
            }
            return (left?.name || '').localeCompare(right?.name || '');
        });
    }

    if (connectionTab === 'newest') {
        return nextCameras.sort(sortByNewest);
    }

    return cameras;
}

export function useLandingCameraFilters(cameras, areas, favorites, viewMode, onCameraClick) {
    const [connectionTab, setConnectionTab] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedArea, setSelectedArea] = useState('all');
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const [focusedCameraId, setFocusedCameraId] = useState(null);
    const searchInputRef = useRef(null);
    const searchContainerRef = useRef(null);

    const areaOptions = useMemo(() => {
        const names = new Set();
        areas.forEach((area) => {
            if (area?.name) {
                names.add(area.name);
            }
        });
        cameras.forEach((camera) => {
            if (camera?.area_name) {
                names.add(camera.area_name);
            }
        });
        return Array.from(names).sort((left, right) => left.localeCompare(right));
    }, [areas, cameras]);

    const searchFilteredCameras = useMemo(() => {
        if (!searchQuery.trim()) {
            return cameras;
        }

        const query = searchQuery.toLowerCase().trim();
        return cameras.filter((camera) => {
            const name = (camera.name || '').toLowerCase();
            const location = (camera.location || '').toLowerCase();
            const areaName = (camera.area_name || '').toLowerCase();

            return name.includes(query)
                || location.includes(query)
                || areaName.includes(query);
        });
    }, [cameras, searchQuery]);

    const areaFilteredCameras = useMemo(() => {
        if (selectedArea === 'all') {
            return searchFilteredCameras;
        }
        return searchFilteredCameras.filter((camera) => camera.area_name === selectedArea);
    }, [searchFilteredCameras, selectedArea]);

    const defaultGridAreaConfigs = useMemo(() => {
        const configs = new Map();
        areas.forEach((area) => {
            if (!area?.name) {
                return;
            }
            if (!(area?.show_on_grid_default === 1 || area?.show_on_grid_default === true)) {
                return;
            }

            const rawLimit = area?.grid_default_camera_limit;
            const parsedLimit = rawLimit === null || rawLimit === undefined || rawLimit === ''
                ? null
                : Number.parseInt(rawLimit, 10);

            configs.set(area.name, {
                limit: Number.isNaN(parsedLimit) ? null : parsedLimit,
            });
        });
        return configs;
    }, [areas]);

    const gridAreaScopedCameras = useMemo(() => {
        if (viewMode !== 'grid' || selectedArea !== 'all') {
            return areaFilteredCameras;
        }

        if (defaultGridAreaConfigs.size === 0) {
            return areaFilteredCameras;
        }

        const grouped = new Map();
        areaFilteredCameras.forEach((camera) => {
            if (!camera?.area_name || !defaultGridAreaConfigs.has(camera.area_name)) {
                return;
            }
            if (!grouped.has(camera.area_name)) {
                grouped.set(camera.area_name, []);
            }
            grouped.get(camera.area_name).push(camera);
        });

        const scoped = [];
        grouped.forEach((areaCameras, areaName) => {
            const { limit } = defaultGridAreaConfigs.get(areaName) || {};
            const sortedAreaCameras = [...areaCameras].sort((left, right) => {
                const leftOnline = left?.is_online === 1 || left?.is_online === true ? 1 : 0;
                const rightOnline = right?.is_online === 1 || right?.is_online === true ? 1 : 0;
                if (leftOnline !== rightOnline) {
                    return rightOnline - leftOnline;
                }

                return (left?.name || '').localeCompare(right?.name || '');
            });

            if (limit && limit > 0) {
                scoped.push(...sortedAreaCameras.slice(0, limit));
            } else {
                scoped.push(...sortedAreaCameras);
            }
        });

        return scoped;
    }, [areaFilteredCameras, defaultGridAreaConfigs, selectedArea, viewMode]);

    const filteredForGrid = useMemo(() => {
        if (connectionTab === 'popular' || connectionTab === 'newest') {
            return sortGridCameras(areaFilteredCameras, connectionTab);
        }
        if (connectionTab === 'stable') {
            return gridAreaScopedCameras.filter((camera) => camera.is_tunnel !== 1);
        }
        if (connectionTab === 'tunnel') {
            return gridAreaScopedCameras.filter((camera) => camera.is_tunnel === 1);
        }
        if (connectionTab === 'favorites') {
            return gridAreaScopedCameras.filter((camera) => favorites.includes(camera.id));
        }
        return gridAreaScopedCameras;
    }, [areaFilteredCameras, gridAreaScopedCameras, connectionTab, favorites]);

    const favoritesInAreaCount = useMemo(() => (
        areaFilteredCameras.filter((camera) => favorites.includes(camera.id)).length
    ), [areaFilteredCameras, favorites]);

    const displayCameras = viewMode === 'map' ? areaFilteredCameras : filteredForGrid;

    const handleSearchChange = useCallback((value) => {
        setSearchQuery(value);
        setShowSearchDropdown(value.trim().length > 0);
    }, []);

    const clearSearch = useCallback(() => {
        setSearchQuery('');
        setShowSearchDropdown(false);
        searchInputRef.current?.focus();
    }, []);

    const handleAreaChange = useCallback((valueOrEvent) => {
        const nextArea = typeof valueOrEvent === 'string'
            ? valueOrEvent
            : valueOrEvent?.target?.value || 'all';

        setSelectedArea(nextArea);
        setFocusedCameraId(null);
    }, []);

    const handleCameraSelect = useCallback((camera) => {
        if (viewMode === 'map') {
            if (selectedArea !== 'all' && camera.area_name && camera.area_name !== selectedArea) {
                setSelectedArea('all');
            }
            setFocusedCameraId(camera.id);
        } else {
            onCameraClick(camera);
        }
        setSearchQuery('');
        setShowSearchDropdown(false);
    }, [onCameraClick, selectedArea, viewMode]);

    const handleFocusHandled = useCallback(() => {
        setFocusedCameraId(null);
    }, []);

    return {
        connectionTab,
        setConnectionTab,
        searchQuery,
        setSearchQuery: handleSearchChange,
        selectedArea,
        setSelectedArea,
        showSearchDropdown,
        setShowSearchDropdown,
        focusedCameraId,
        areaOptions,
        searchFilteredCameras,
        areaFilteredCameras,
        filteredForGrid,
        favoritesInAreaCount,
        displayCameras,
        searchInputRef,
        searchContainerRef,
        clearSearch,
        handleAreaChange,
        handleCameraSelect,
        handleFocusHandled,
    };
}

export default useLandingCameraFilters;
