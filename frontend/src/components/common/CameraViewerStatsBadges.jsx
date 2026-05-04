/*
 * Purpose: Render compact live viewer and lifetime view counters for camera surfaces.
 * Caller: LandingCameraCard and VideoPopup.
 * Deps: React props only.
 * MainFuncs: formatCompactCount, getCameraViewerStats, CameraViewerStatsBadges.
 * SideEffects: None.
 */

export function formatCompactCount(value) {
    const count = Number.parseInt(value, 10);
    if (!Number.isFinite(count) || count <= 0) {
        return '0';
    }
    if (count < 1000) {
        return String(count);
    }

    const suffixes = [
        { value: 1000000, suffix: 'm' },
        { value: 1000, suffix: 'k' },
    ];
    const scale = suffixes.find((item) => count >= item.value);
    const scaled = count / scale.value;
    const rounded = Math.round(scaled * 10) / 10;
    const formatted = scaled >= 100 ? Math.round(scaled).toString() : rounded.toFixed(1);
    return `${formatted.replace(/\.0$/, '')}${scale.suffix}`;
}

export function getCameraViewerStats(camera) {
    const stats = camera?.viewer_stats || {};
    return {
        liveViewers: Number.parseInt(stats.live_viewers, 10) || 0,
        totalViews: Number.parseInt(stats.total_views, 10) || 0,
    };
}

export default function CameraViewerStatsBadges({
    camera,
    className = '',
    tone = 'panel',
}) {
    const { liveViewers, totalViews } = getCameraViewerStats(camera);
    const isOverlay = tone === 'overlay';
    const containerClass = isOverlay
        ? 'text-white/90'
        : 'text-gray-600 dark:text-gray-300';
    const liveClass = isOverlay
        ? 'bg-emerald-400/15 text-emerald-100 ring-1 ring-emerald-300/30'
        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    const viewsClass = isOverlay
        ? 'bg-white/10 text-white ring-1 ring-white/15'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';

    return (
        <div className={`flex flex-wrap items-center gap-2 text-[11px] font-semibold ${containerClass} ${className}`}>
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${liveClass}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${liveViewers > 0 ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
                {formatCompactCount(liveViewers)} live
            </span>
            <span className={`inline-flex items-center rounded-lg px-2 py-1 ${viewsClass}`}>
                {formatCompactCount(totalViews)} views
            </span>
        </div>
    );
}
