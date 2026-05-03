/**
 * Purpose: Builds public map area aggregate summaries from area metadata and camera coordinates.
 * Caller: MapView area filter and aggregate marker flows.
 * Deps: camera availability and map coordinate utilities.
 * MainFuncs: getCentroidFromCameras, buildAreaSummaryList.
 * SideEffects: Logs a warning when an area aggregate has no valid anchor.
 */
import { getCameraAvailabilityState } from './cameraAvailability.js';
import {
    getBoundsCenterFromCameras,
    getValidCoordinatePair,
    hasValidCoords,
    normalizeAreaKey,
} from './mapCoordinateUtils.js';

export function getCentroidFromCameras(cameras = []) {
    const validCameras = Array.isArray(cameras) ? cameras.filter(hasValidCoords) : [];
    if (validCameras.length === 0) {
        return null;
    }

    const totals = validCameras.reduce((acc, camera) => {
        const lat = parseFloat(camera.latitude);
        const lng = parseFloat(camera.longitude);

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return acc;
        }

        acc.latitude += lat;
        acc.longitude += lng;
        acc.count += 1;
        return acc;
    }, { latitude: 0, longitude: 0, count: 0 });

    if (totals.count === 0) {
        return null;
    }

    return {
        latitude: totals.latitude / totals.count,
        longitude: totals.longitude / totals.count,
    };
}

export function buildAreaSummaryList(areas = [], cameras = []) {
    const normalizedAreas = new Map();
    areas.forEach((area) => {
        const key = normalizeAreaKey(area?.name);
        if (!key || normalizedAreas.has(key)) {
            return;
        }
        normalizedAreas.set(key, area);
    });

    const groups = new Map();
    cameras.forEach((camera) => {
        const normalizedKey = normalizeAreaKey(camera?.area_name);
        if (!normalizedKey) {
            return;
        }

        if (!groups.has(normalizedKey)) {
            groups.set(normalizedKey, {
                areaKey: normalizedKey,
                areaName: String(camera.area_name || '').trim(),
                cameras: [],
                onlineCount: 0,
                offlineCount: 0,
                degradedCount: 0,
            });
        }

        const group = groups.get(normalizedKey);
        if (!group.areaName && camera.area_name) {
            group.areaName = String(camera.area_name).trim();
        }

        group.cameras.push(camera);
        const availabilityState = getCameraAvailabilityState(camera);
        if (availabilityState === 'offline' || camera.status === 'maintenance') {
            group.offlineCount += 1;
        } else {
            group.onlineCount += 1;
        }
        if (availabilityState === 'degraded' || availabilityState === 'suspect') {
            group.degradedCount += 1;
        }
    });

    return Array.from(groups.values())
        .map((group) => {
            const areaData = normalizedAreas.get(group.areaKey);
            const centroid = getCentroidFromCameras(group.cameras);
            const areaMaster = getValidCoordinatePair(areaData);
            const boundsCenter = getBoundsCenterFromCameras(group.cameras);
            const anchor = centroid || areaMaster || boundsCenter;

            if (!anchor) {
                console.warn('[MapView] Area aggregate missing valid anchor', {
                    areaName: group.areaName,
                    cameraCount: group.cameras.length,
                    source: 'missing_coordinates',
                });
                return {
                    ...group,
                    cameraCount: group.cameras.length,
                    hasValidAnchor: false,
                    source: 'missing_coordinates',
                    anchor: null,
                };
            }

            return {
                ...group,
                coverage_scope: areaData?.coverage_scope || 'default',
                viewport_zoom_override: areaData?.viewport_zoom_override ?? null,
                cameraCount: group.cameras.length,
                hasValidAnchor: true,
                source: centroid ? 'centroid' : (areaMaster ? 'area_master' : 'bounds_center'),
                anchor,
            };
        })
        .sort((left, right) => left.areaName.localeCompare(right.areaName));
}
