import { useCallback, useMemo, useRef, useState } from 'react';

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

    const defaultGridAreaNames = useMemo(() => {
        const names = areas
            .filter((area) => area?.show_on_grid_default === 1 || area?.show_on_grid_default === true)
            .map((area) => area.name)
            .filter(Boolean);
        return new Set(names);
    }, [areas]);

    const gridAreaScopedCameras = useMemo(() => {
        if (viewMode !== 'grid' || selectedArea !== 'all') {
            return areaFilteredCameras;
        }

        if (defaultGridAreaNames.size === 0) {
            return areaFilteredCameras;
        }

        return areaFilteredCameras.filter((camera) => (
            camera?.area_name && defaultGridAreaNames.has(camera.area_name)
        ));
    }, [areaFilteredCameras, defaultGridAreaNames, selectedArea, viewMode]);

    const filteredForGrid = useMemo(() => {
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
    }, [gridAreaScopedCameras, connectionTab, favorites]);

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
