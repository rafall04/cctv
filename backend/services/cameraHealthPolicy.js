/*
Purpose: Resolve external camera health monitoring modes from camera, area, and global defaults.
Caller: CameraHealthService and direct policy tests.
Deps: cameraDelivery utility.
MainFuncs: normalizeExternalHealthMode(), resolveExternalHealthMode().
SideEffects: None.
*/

import {
    getEffectiveDeliveryType,
    normalizeExternalHealthMode as normalizeCameraExternalHealthMode,
} from '../utils/cameraDelivery.js';

export const normalizeExternalHealthMode = normalizeCameraExternalHealthMode;

export function resolveExternalHealthMode(camera, defaults = {}) {
    const explicitMode = normalizeExternalHealthMode(camera?.external_health_mode);
    if (explicitMode !== 'default') {
        return explicitMode;
    }

    const areaOverrideMode = normalizeExternalHealthMode(camera?.area_external_health_mode_override);
    if (areaOverrideMode !== 'default') {
        return areaOverrideMode;
    }

    const deliveryType = getEffectiveDeliveryType(camera);

    if (deliveryType === 'external_mjpeg') {
        return defaults.external_mjpeg || 'passive_first';
    }

    if (deliveryType === 'external_hls') {
        return defaults.external_hls || 'hybrid_probe';
    }

    if (deliveryType === 'external_flv') {
        return defaults.external_flv || 'passive_first';
    }

    if (deliveryType === 'external_embed') {
        return defaults.external_embed || 'passive_first';
    }

    if (deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
        return defaults[deliveryType] || 'disabled';
    }

    return 'hybrid_probe';
}
