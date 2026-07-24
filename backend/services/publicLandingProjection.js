/*
 * Purpose: Strip internal health/runtime/policy fields from a public landing camera object
 *          AFTER availability enrichment, so GET /api/cameras/active stays lean and never
 *          leaks internal monitoring/health state to the public surface.
 * Caller: cameraService.getPublicLandingCameraList (final .map in the read-model pipeline).
 * Deps: none.
 * MainFuncs: stripInternalLandingFields.
 * SideEffects: none (returns a shallow copy; never mutates the input).
 *
 * Why here (not in cameraService.js): the public card keys off `availability_state` /
 * `is_online`, and the popup resolver uses `availability_*`. The fields below are consumed
 * only by backend enrichment (to derive availability) or by admin surfaces (which use a
 * separate admin projection), so they are internal to the public payload. Enrichment runs
 * BEFORE this strip, so removing them here does not affect availability computation.
 * `stream_key` is already omitted from PUBLIC_LANDING_CAMERA_PROJECTION, so it is not listed.
 */

export const PUBLIC_LANDING_INTERNAL_FIELDS = [
    'monitoring_state',
    'monitoring_reason',
    'last_runtime_signal_at',
    'last_runtime_signal_type',
    'last_health_check_at',
    'runtime_state_updated_at',
    'health_mode',
    'external_health_mode',
    'area_external_health_mode_override',
];

export function stripInternalLandingFields(camera) {
    if (!camera || typeof camera !== 'object') {
        return camera;
    }

    const publicCamera = { ...camera };
    for (const field of PUBLIC_LANDING_INTERNAL_FIELDS) {
        delete publicCamera[field];
    }
    return publicCamera;
}
