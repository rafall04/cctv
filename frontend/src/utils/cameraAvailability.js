const VALID_AVAILABILITY_STATES = new Set(['online', 'degraded', 'offline', 'maintenance']);

export function getCameraAvailabilityState(camera = {}) {
    if (camera.status === 'maintenance') {
        return 'maintenance';
    }

    if (VALID_AVAILABILITY_STATES.has(camera.availability_state)) {
        return camera.availability_state;
    }

    return camera.is_online === 0 ? 'offline' : 'online';
}

export function isCameraHardOffline(camera = {}) {
    return getCameraAvailabilityState(camera) === 'offline';
}

export function isCameraPlayable(camera = {}) {
    const availabilityState = getCameraAvailabilityState(camera);
    return availabilityState !== 'maintenance' && availabilityState !== 'offline';
}

export function isCameraDegraded(camera = {}) {
    return getCameraAvailabilityState(camera) === 'degraded';
}
