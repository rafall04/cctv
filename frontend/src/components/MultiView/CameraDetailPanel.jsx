/*
 * Purpose: Render compact public camera trust metadata and popup actions before or below live playback.
 * Caller: VideoPopup public single-camera modal.
 * Deps: landingCameraInsights utility and caller-provided share/favorite handlers.
 * MainFuncs: CameraDetailPanel.
 * SideEffects: Invokes share and favorite callbacks.
 */

import { getPublicCameraQuality } from '../../utils/landingCameraInsights';

function metric(camera, key) {
    return Number(camera?.[key] ?? camera?.viewer_stats?.[key] ?? 0);
}

function getAreaHref(camera) {
    const areaSlug = camera?.area_slug || camera?.areaSlug || camera?.area_name || camera?.areaName;
    return areaSlug ? `/area/${encodeURIComponent(areaSlug)}` : '/';
}

export default function CameraDetailPanel({
    camera,
    isFavorite = false,
    onShare,
    onToggleFavorite,
}) {
    const quality = getPublicCameraQuality(camera);
    const liveViewers = metric(camera, 'live_viewers');
    const totalViews = metric(camera, 'total_views');
    const hasPlayback = camera?.enable_recording === 1 || camera?.enable_recording === true;
    const areaName = camera?.area_name || camera?.areaName || 'Area publik';

    return (
        <section
            data-testid="camera-detail-panel"
            className="border-b border-gray-200 bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900"
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${quality.className}`}>
                            {quality.label}
                        </span>
                        <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                            {liveViewers} live
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                            {totalViews} views
                        </span>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${hasPlayback ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                            {hasPlayback ? 'Playback tersedia' : 'Live only'}
                        </span>
                    </div>
                    <div className="mt-2 min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{areaName}</div>
                        {(camera?.location || camera?.description) && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                                {camera.location || camera.description}
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={onShare}
                        className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 transition hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
                    >
                        Bagikan
                    </button>
                    {onToggleFavorite && (
                        <button
                            type="button"
                            onClick={() => onToggleFavorite(camera.id)}
                            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${isFavorite ? 'bg-amber-400 text-white hover:bg-amber-500' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20'}`}
                        >
                            {isFavorite ? 'Favorit' : 'Tambah favorit'}
                        </button>
                    )}
                    <a
                        href={getAreaHref(camera)}
                        className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        Buka area
                    </a>
                </div>
            </div>
        </section>
    );
}
