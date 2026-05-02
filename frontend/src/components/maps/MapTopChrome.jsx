/*
 * Purpose: Render public map top chrome controls without blocking Leaflet layer controls.
 * Caller: MapView public CCTV map.
 * Deps: React props from MapView.
 * MainFuncs: MapTopChrome.
 * SideEffects: Emits area filter and reset events through callback props.
 */

export default function MapTopChrome({
    showAreaFilter,
    selectedAreaValue,
    mapName,
    camerasWithCoordsCount,
    areaNames,
    areaCounts,
    shouldShowZoomHint,
    onAreaChange,
    onResetView,
}) {
    return (
        <div
            data-testid="map-top-chrome"
            className="pointer-events-none absolute left-3 right-3 top-3 z-[1000] flex items-start justify-between gap-3"
        >
            <div
                data-testid="map-top-chrome-controls"
                className="pointer-events-none flex max-w-[min(100%,24rem)] flex-col gap-2"
            >
                {showAreaFilter && (
                    <div
                        data-testid="map-area-filter-panel"
                        className="pointer-events-auto rounded-2xl border border-white/55 bg-white/78 p-1.5 shadow-[0_14px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/72"
                    >
                        <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
                                Area View
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <select
                                value={selectedAreaValue}
                                onChange={onAreaChange}
                                data-testid="map-area-select"
                                className="min-w-0 flex-1 rounded-xl border-0 bg-transparent px-2.5 py-2 text-xs font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-white sm:text-sm"
                            >
                                <option value="all">{mapName || 'Semua Lokasi'} ({camerasWithCoordsCount})</option>
                                {areaNames.map(area => (
                                    <option key={area} value={area}>
                                        {area} ({areaCounts.get(area) || 0})
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={onResetView}
                                data-testid="map-reset-view"
                                className="rounded-xl border border-white/40 bg-white/70 px-3 py-2 text-[11px] font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-gray-800/85 dark:text-gray-200 dark:hover:bg-gray-800"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                )}

                {shouldShowZoomHint && (
                    <div
                        data-testid="map-zoom-hint"
                        className="pointer-events-none inline-flex max-w-fit items-center gap-2 rounded-full border border-white/55 bg-white/78 px-3 py-1.5 text-[11px] font-medium text-gray-600 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/72 dark:text-gray-300"
                    >
                        <span className="inline-flex h-2 w-2 rounded-full bg-sky-500" />
                        Zoom in untuk lihat kamera individual
                    </div>
                )}
            </div>
        </div>
    );
}
