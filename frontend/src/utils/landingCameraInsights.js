/*
 * Purpose: Derive public-safe camera quality labels from camera payloads.
 * Caller: Public landing camera cards and the multiview camera detail panel.
 * Deps: Browser Date and camera viewer/stat fields already returned by public camera APIs.
 * MainFuncs: getPublicCameraQuality.
 * SideEffects: None.
 */

const NEW_CAMERA_DAYS = 7;
const BUSY_VIEWER_THRESHOLD = 5;
const TOP_VIEW_THRESHOLD = 50;

function getMetric(camera, key) {
    return Number(camera?.[key] ?? camera?.viewer_stats?.[key] ?? 0);
}

function isOnline(camera) {
    return camera?.is_online === 1 || camera?.is_online === true || camera?.status === 'active';
}

function isOffline(camera) {
    return camera?.status === 'offline' || camera?.is_online === 0 || camera?.is_online === false;
}

function normalizeDate(value) {
    if (!value) {
        return null;
    }

    const normalizedValue = typeof value === 'string' ? value.replace(' ', 'T') : value;
    const date = new Date(normalizedValue);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isNewCamera(camera, now) {
    const createdAt = normalizeDate(camera?.created_at);
    if (!createdAt) {
        return false;
    }

    const ageMs = now.getTime() - createdAt.getTime();
    return ageMs >= 0 && ageMs <= NEW_CAMERA_DAYS * 24 * 60 * 60 * 1000;
}

/*
 * Returns DATA ONLY — a stable `key` plus its Indonesian `label`.
 *
 * This used to also return a `className` string of hardcoded Tailwind colours
 * (rose / sky / violet / amber / emerald / slate), which meant a pure data
 * helper was quietly deciding how six more hues entered the palette, out of
 * reach of the token layer. Callers now map `key` to a semantic token
 * themselves, so the colour decision lives where colour belongs.
 */
export function getPublicCameraQuality(camera, now = new Date()) {
    if (camera?.status === 'maintenance') {
        return { key: 'maintenance', label: 'Gangguan' };
    }

    if (isOffline(camera)) {
        return { key: 'offline', label: 'Offline' };
    }

    if (getMetric(camera, 'live_viewers') >= BUSY_VIEWER_THRESHOLD) {
        return { key: 'busy', label: 'Ramai' };
    }

    if (isNewCamera(camera, now)) {
        return { key: 'new', label: 'Baru' };
    }

    if (getMetric(camera, 'total_views') >= TOP_VIEW_THRESHOLD) {
        return { key: 'top', label: 'Sering Dilihat' };
    }

    if (isOnline(camera) && camera?.is_tunnel !== 1) {
        return { key: 'stable', label: 'Stabil' };
    }

    return { key: 'live', label: 'Live' };
}
