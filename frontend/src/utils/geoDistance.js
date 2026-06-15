/*
 * Purpose: Geographic distance helpers (haversine) for public camera lists — straight-line
 *          distance between camera coordinates, human labels, and distance-first sorting.
 * Caller: RelatedCamerasStrip, LandingPage related cameras, areaPublicRanking.
 * Deps: mapCoordinateUtils.getValidCoordinatePair for coordinate normalization.
 * MainFuncs: haversineMeters, formatDistanceLabel, sortCamerasByDistance.
 * SideEffects: None.
 */

import { getValidCoordinatePair } from './mapCoordinateUtils.js';

const EARTH_RADIUS_METERS = 6371000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Straight-line (great-circle) distance in meters between two camera-like objects
 * (each carrying latitude/longitude). Returns null when either side lacks valid coords.
 */
export function haversineMeters(origin, target) {
    const a = getValidCoordinatePair(origin);
    const b = getValidCoordinatePair(target);
    if (!a || !b) {
        return null;
    }

    const dLat = toRadians(b.latitude - a.latitude);
    const dLng = toRadians(b.longitude - a.longitude);
    const lat1 = toRadians(a.latitude);
    const lat2 = toRadians(b.latitude);

    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Human-readable Indonesian distance label. Straight-line, so callers should make the
 * "garis lurus" meaning clear in surrounding copy. Returns null for invalid input.
 *   < 1 km  → rounded to nearest 10 m  ("350 m")
 *   >= 1 km → one decimal, comma separator ("1,2 km")
 */
export function formatDistanceLabel(meters) {
    if (meters == null || !Number.isFinite(meters) || meters < 0) {
        return null;
    }

    const rounded = Math.round(meters / 10) * 10;
    if (rounded < 1000) {
        return `${rounded} m`;
    }

    return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/**
 * Return a new array of cameras (shallow copies) each tagged with `_distanceMeters`
 * (number | null) relative to `origin`, sorted nearest-first. Cameras with a computable
 * distance always rank before those without; `tiebreaker` resolves equal/missing distances
 * (e.g. same-area + viewer ranking) so existing ordering is preserved as a fallback.
 */
export function sortCamerasByDistance(cameras = [], origin = null, tiebreaker = () => 0) {
    return cameras
        .map((camera) => ({
            ...camera,
            _distanceMeters: haversineMeters(origin, camera),
        }))
        .sort((left, right) => {
            const leftHas = Number.isFinite(left._distanceMeters);
            const rightHas = Number.isFinite(right._distanceMeters);

            if (leftHas && rightHas) {
                if (left._distanceMeters !== right._distanceMeters) {
                    return left._distanceMeters - right._distanceMeters;
                }
                return tiebreaker(left, right);
            }
            if (leftHas) return -1;
            if (rightHas) return 1;
            return tiebreaker(left, right);
        });
}
