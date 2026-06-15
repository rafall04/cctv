/*
 * Purpose: Render a minimal related public camera rail inside the video popup.
 * Caller: VideoPopup public single-camera modal.
 * Deps: React props, geoDistance label helper, and caller-provided camera open handler.
 * MainFuncs: RelatedCamerasStrip.
 * SideEffects: Invokes related camera click callback.
 */

import { formatDistanceLabel } from '../../utils/geoDistance.js';

function metric(camera, key) {
    return Number(camera?.[key] ?? camera?.viewer_stats?.[key] ?? 0);
}

export default function RelatedCamerasStrip({
    cameras = [],
    onCameraClick,
}) {
    if (!cameras.length) {
        return null;
    }

    return (
        <section
            data-testid="related-cameras-strip"
            className="border-t border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/70"
        >
            <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Terkait</h3>
            </div>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                {cameras.slice(0, 3).map((camera) => {
                    const viewersText = metric(camera, 'live_viewers') > 0
                        ? `${metric(camera, 'live_viewers')} live`
                        : `${metric(camera, 'total_views')} views`;
                    const distanceLabel = formatDistanceLabel(camera?._distanceMeters);

                    return (
                        <button
                            key={camera.id}
                            type="button"
                            onClick={() => onCameraClick?.(camera)}
                            className="min-h-[52px] w-[min(13rem,calc(100vw-4rem))] shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-primary/10 sm:w-48"
                        >
                            <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                            <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                                <span>{viewersText}</span>
                                {distanceLabel && (
                                    <>
                                        <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">&middot;</span>
                                        <span
                                            className="inline-flex items-center gap-0.5 text-gray-500 dark:text-gray-400"
                                            title="Jarak garis lurus dari kamera yang sedang diputar"
                                        >
                                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-6.5 7-11a7 7 0 10-14 0c0 4.5 7 11 7 11z" />
                                                <circle cx="12" cy="10" r="2.5" />
                                            </svg>
                                            {distanceLabel}
                                        </span>
                                    </>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
