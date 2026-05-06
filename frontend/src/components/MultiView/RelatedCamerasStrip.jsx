/*
 * Purpose: Render a compact list of related public cameras inside the video popup.
 * Caller: VideoPopup public single-camera modal.
 * Deps: React props and caller-provided camera open handler.
 * MainFuncs: RelatedCamerasStrip.
 * SideEffects: Invokes related camera click callback.
 */

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
            className="border-t border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/70"
        >
            <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">CCTV Terkait</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">{cameras.length} kamera</span>
            </div>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                {cameras.slice(0, 5).map((camera) => (
                    <button
                        key={camera.id}
                        type="button"
                        onClick={() => onCameraClick?.(camera)}
                        className="min-h-[62px] w-[min(15rem,calc(100vw-4rem))] shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-primary/10 sm:w-56"
                    >
                        <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            <span>{metric(camera, 'live_viewers')} live</span>
                            <span>{metric(camera, 'total_views')} views</span>
                        </div>
                    </button>
                ))}
            </div>
        </section>
    );
}
