/*
 * Purpose: Render minimal public camera metadata and popup actions before or below live playback.
 * Caller: VideoPopup public single-camera modal.
 * Deps: landingCameraInsights utility, publicGrowthShare utility, and caller-provided share/favorite handlers.
 * MainFuncs: CameraDetailPanel.
 * SideEffects: Invokes share and favorite callbacks.
 */

import { getPublicCameraQuality } from '../../utils/landingCameraInsights';
import { buildAreaPath } from '../../utils/publicGrowthShare';

function metric(camera, key) {
    return Number(camera?.[key] ?? camera?.viewer_stats?.[key] ?? 0);
}

/*
 * Colour for a quality key now lives here, in the presentation layer, instead of
 * being baked into the data helper. Only states that mean something get a colour:
 * a fault is red, a warning amber, everything else stays quiet text so the row
 * does not turn into five competing pills again.
 */
const QUALITY_TONE = {
    maintenance: 'text-status-fault',
    offline: 'text-status-idle',
    busy: 'text-status-live',
};

const BUTTON_CLASS = 'rounded-control border border-edge px-3 py-2 text-xs font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface-raised';

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
            className="border-b border-edge bg-surface px-3 py-2.5"
        >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                    {/* Five filled pills became one line of text separated by dots. The
                        counts are ambient context for the video above them, not headlines. */}
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="max-w-[13rem] truncate text-sm font-semibold text-content sm:max-w-xs">
                            {areaName}
                        </span>
                        <span className={`font-medium ${QUALITY_TONE[quality.key] || 'text-content-muted'}`}>
                            {quality.label}
                        </span>
                        <span className="text-content-subtle" aria-hidden="true">·</span>
                        <span className="tabular-nums text-content-muted">{liveViewers} live</span>
                        <span className="text-content-subtle" aria-hidden="true">·</span>
                        <span className="tabular-nums text-content-muted">{totalViews} views</span>
                        {hasPlayback && (
                            <>
                                <span className="text-content-subtle" aria-hidden="true">·</span>
                                <span className="text-content-muted">Playback tersedia</span>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button type="button" onClick={onShare} className={BUTTON_CLASS}>
                        Bagikan
                    </button>
                    {onToggleFavorite && (
                        <button
                            type="button"
                            onClick={() => onToggleFavorite(camera.id)}
                            className={`${BUTTON_CLASS} ${isFavorite ? 'border-amber-300/40 text-amber-300' : ''}`}
                        >
                            {isFavorite ? 'Favorit' : 'Tambah favorit'}
                        </button>
                    )}
                    <a href={buildAreaPath(camera)} className={BUTTON_CLASS}>
                        Buka area
                    </a>
                </div>
            </div>
        </section>
    );
}
