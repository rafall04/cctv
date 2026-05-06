/*
 * Purpose: Derive public-safe camera quality labels and compact smart feed groups from camera payloads.
 * Caller: Public landing cards and smart feed components.
 * Deps: Browser Date and camera viewer/stat fields already returned by public camera APIs.
 * MainFuncs: getPublicCameraQuality, buildPublicSmartFeedSections.
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

function sortByMetric(cameras, key) {
    return [...cameras].sort((left, right) => {
        const byMetric = getMetric(right, key) - getMetric(left, key);
        if (byMetric !== 0) {
            return byMetric;
        }
        return (left?.name || '').localeCompare(right?.name || '');
    });
}

function sortByNewest(cameras) {
    return [...cameras].sort((left, right) => {
        const rightDate = normalizeDate(right?.created_at)?.getTime() || 0;
        const leftDate = normalizeDate(left?.created_at)?.getTime() || 0;
        if (rightDate !== leftDate) {
            return rightDate - leftDate;
        }
        return Number(right?.id || 0) - Number(left?.id || 0);
    });
}

export function getPublicCameraQuality(camera, now = new Date()) {
    if (camera?.status === 'maintenance') {
        return {
            key: 'maintenance',
            label: 'Gangguan',
            className: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
        };
    }

    if (isOffline(camera)) {
        return {
            key: 'offline',
            label: 'Offline',
            className: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
        };
    }

    if (getMetric(camera, 'live_viewers') >= BUSY_VIEWER_THRESHOLD) {
        return {
            key: 'busy',
            label: 'Ramai',
            className: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300',
        };
    }

    if (isNewCamera(camera, now)) {
        return {
            key: 'new',
            label: 'Baru',
            className: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300',
        };
    }

    if (getMetric(camera, 'total_views') >= TOP_VIEW_THRESHOLD) {
        return {
            key: 'top',
            label: 'Sering Dilihat',
            className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
        };
    }

    if (isOnline(camera) && camera?.is_tunnel !== 1) {
        return {
            key: 'stable',
            label: 'Stabil',
            className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
        };
    }

    return {
        key: 'live',
        label: 'Live',
        className: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    };
}

export function buildPublicSmartFeedSections(cameras = [], now = new Date(), limit = 6) {
    const availableCameras = cameras.filter((camera) => camera && camera.status !== 'maintenance' && !isOffline(camera));
    const usedCameraIds = new Set();
    const takeUnique = (items) => {
        const nextItems = [];
        items.forEach((camera) => {
            if (nextItems.length >= limit || usedCameraIds.has(camera.id)) {
                return;
            }
            usedCameraIds.add(camera.id);
            nextItems.push(camera);
        });
        return nextItems;
    };

    const busyCameras = takeUnique(sortByMetric(availableCameras.filter((camera) => getMetric(camera, 'live_viewers') > 0), 'live_viewers'));
    const recentCreatedCameras = availableCameras.filter((camera) => camera.created_at && isNewCamera(camera, now));
    const newestSourceCameras = recentCreatedCameras.length > 0
        ? recentCreatedCameras
        : availableCameras.filter((camera) => camera.created_at);
    const newestCameras = takeUnique(sortByNewest(newestSourceCameras));
    const topCameras = takeUnique(sortByMetric(availableCameras.filter((camera) => getMetric(camera, 'total_views') > 0), 'total_views'));
    const recommendedCameras = takeUnique(sortByMetric(availableCameras.filter((camera) => camera.is_tunnel !== 1), 'total_views'));

    return [
        { key: 'busy', title: 'Sedang Ramai', cameras: busyCameras },
        { key: 'newest', title: 'Kamera Terbaru', cameras: newestCameras },
        { key: 'top', title: 'Paling Banyak Ditonton', cameras: topCameras },
        { key: 'recommended', title: 'Rekomendasi Hari Ini', cameras: recommendedCameras },
    ].filter((section) => section.cameras.length > 0);
}
