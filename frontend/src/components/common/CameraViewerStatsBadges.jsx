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
    // Truncate, never round up: 1170 views must read "1.1k", not "1.2k" (which implies 1200+).
    // Integer math (count is an integer) avoids float drift at the tenth boundary, so exact
    // values like 1200 stay "1.2k" instead of slipping to "1.1k".
    const tenths = Math.floor(count / (scale.value / 10));
    const whole = Math.floor(tenths / 10);
    const decimal = tenths % 10;
    const formatted = whole >= 100 ? String(whole) : `${whole}.${decimal}`;
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

    // These were two filled pills with their own background, ring and bold weight,
    // stacked on a card that already carried several other pills. Counters are
    // ambient information, so they now read as quiet text and let the thumbnail
    // stay the loudest thing on the card. `tabular-nums` stops the numbers from
    // jittering as viewer counts tick up and down in place.
    const containerClass = isOverlay ? 'text-white/85' : 'text-content-muted';
    const liveDotClass = liveViewers > 0 ? 'bg-status-live' : 'bg-status-idle';

    return (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] font-medium tabular-nums ${containerClass} ${className}`}>
            <span className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${liveDotClass}`} aria-hidden="true"></span>
                {formatCompactCount(liveViewers)} live
            </span>
            <span className="inline-flex items-center">
                {formatCompactCount(totalViews)} views
            </span>
        </div>
    );
}
