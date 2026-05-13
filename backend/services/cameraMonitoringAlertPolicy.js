/*
Purpose: Pure policy helpers for Telegram CCTV monitoring alert decisions.
Caller: cameraHealthService and focused monitoring policy tests.
Deps: internal ingest policy resolver.
MainFuncs: normalizeMonitoringOnline, getMonitoringAlertTransition, shouldUseStrictInternalMonitoring.
SideEffects: None.
*/

import { resolveInternalIngestPolicy } from '../utils/internalIngestPolicy.js';

const ONLINE_MONITORING_STATES = new Set(['online', 'passive', 'stale']);
const OFFLINE_MONITORING_STATES = new Set(['offline', 'probe_failed', 'unresolved']);

export function normalizeMonitoringOnline(state) {
    if (ONLINE_MONITORING_STATES.has(state)) {
        return 1;
    }

    if (OFFLINE_MONITORING_STATES.has(state)) {
        return 0;
    }

    return null;
}

export function getMonitoringAlertTransition(previousState, nextState) {
    const previousOnline = normalizeMonitoringOnline(previousState);
    const nextOnline = normalizeMonitoringOnline(nextState);

    if (previousOnline === null || nextOnline === null || previousOnline === nextOnline) {
        return null;
    }

    return nextOnline === 1 ? 'online' : 'offline';
}

export function shouldUseStrictInternalMonitoring(camera = {}) {
    if (camera.delivery_type !== 'internal_hls' || !camera.private_rtsp_url) {
        return false;
    }

    const policy = resolveInternalIngestPolicy(camera, {
        internal_ingest_policy_default: camera.area_internal_ingest_policy_default,
        internal_on_demand_close_after_seconds: camera.area_internal_on_demand_close_after_seconds,
    });

    return policy.mode === 'always_on';
}
