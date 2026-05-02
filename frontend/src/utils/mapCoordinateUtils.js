/*
 * Purpose: Shared coordinate normalization helpers for map clustering and area focus logic.
 * Caller: MapView and focused unit tests.
 * Deps: Browser JavaScript number parsing only.
 * MainFuncs: hasValidCoords, normalizeAreaKey, getValidCoordinatePair, getBoundsCenterFromCameras.
 * SideEffects: None.
 */

export const hasValidCoords = (camera) => {
    const lat = parseFloat(camera?.latitude);
    const lng = parseFloat(camera?.longitude);
    return !Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0);
};

export const normalizeAreaKey = (value) => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const getValidCoordinatePair = (value) => {
    if (!value) {
        return null;
    }

    const lat = parseFloat(value.latitude);
    const lng = parseFloat(value.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng) || (lat === 0 && lng === 0)) {
        return null;
    }

    return { latitude: lat, longitude: lng };
};

export const getBoundsCenterFromCameras = (cameras = []) => {
    const validCameras = Array.isArray(cameras) ? cameras.filter(hasValidCoords) : [];
    if (validCameras.length === 0) {
        return null;
    }

    const latitudes = validCameras.map((camera) => parseFloat(camera.latitude));
    const longitudes = validCameras.map((camera) => parseFloat(camera.longitude));

    if (latitudes.some(Number.isNaN) || longitudes.some(Number.isNaN)) {
        return null;
    }

    return {
        latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
        longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    };
};
