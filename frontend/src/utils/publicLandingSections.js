/*
 * Purpose: Provide pure public landing list shaping helpers for discovery, quick access, and responsive grid windows.
 * Caller: Public landing discovery, quick access, and results grid components.
 * Deps: Device capability detection utility.
 * MainFuncs: buildLandingDiscoverySections, sliceLandingQuickAccessCameras, getAdaptiveGridWindow.
 * SideEffects: None.
 */

import { getDeviceCapabilities } from './deviceDetector';

export const LANDING_DISCOVERY_LIMIT = 8;
export const QUICK_ACCESS_LIMIT = 5;

const DEFAULT_GRID_WINDOW = {
    initialVisibleCount: 24,
    loadMoreCount: 24,
    priorityThumbnailCount: 6,
};

const COMPACT_GRID_WINDOW = {
    initialVisibleCount: 12,
    loadMoreCount: 12,
    priorityThumbnailCount: 2,
};

function formatCount(value) {
    return Number(value || 0).toLocaleString('id-ID');
}

function getItems(discovery, key) {
    return Array.isArray(discovery?.[key]) ? discovery[key] : [];
}

export function buildLandingDiscoverySections(discovery = {}) {
    return [
        {
            key: 'live_now',
            label: 'Sedang Ramai',
            metricLabel: 'penonton',
            items: getItems(discovery, 'live_now'),
            type: 'camera',
            metric: (camera) => camera.live_viewers,
        },
        {
            key: 'top_cameras',
            label: 'Paling Ditonton',
            metricLabel: 'views',
            items: getItems(discovery, 'top_cameras'),
            type: 'camera',
            metric: (camera) => camera.total_views,
        },
        {
            key: 'popular_areas',
            label: 'Area Populer',
            metricLabel: 'views',
            items: getItems(discovery, 'popular_areas'),
            type: 'area',
            metric: (area) => area.total_views,
        },
        {
            key: 'new_cameras',
            label: 'Kamera Terbaru',
            metricLabel: 'views',
            items: getItems(discovery, 'new_cameras'),
            type: 'camera',
            metric: (camera) => camera.total_views,
        },
    ].filter((section) => section.items.length > 0);
}

export function sliceLandingQuickAccessCameras({
    favoriteCameras = [],
    recentCameras = [],
    limit = QUICK_ACCESS_LIMIT,
} = {}) {
    return {
        favoriteCameras: favoriteCameras.slice(0, limit),
        recentCameras: recentCameras.slice(0, limit),
    };
}

export function getAdaptiveGridWindow(capabilities = getDeviceCapabilities()) {
    if (capabilities?.isMobile || capabilities?.tier === 'low') {
        return COMPACT_GRID_WINDOW;
    }

    return DEFAULT_GRID_WINDOW;
}

export function formatLandingDiscoveryCount(value) {
    return formatCount(value);
}
