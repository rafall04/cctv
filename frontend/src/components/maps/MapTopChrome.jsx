/*
 * Purpose: Render public map top chrome controls without blocking Leaflet layer controls.
 * Caller: MapView public CCTV map.
 * Deps: React props from MapView, ui/Icons for the GPS pin glyph.
 * MainFuncs: MapTopChrome.
 * SideEffects: Emits area filter, reset, and locate-me events through callback props.
 */

import { Icons } from '../ui/Icons.jsx';

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
    onLocateMe,
    isLocating = false,
    locateError = null,
    nearbyMessage = null,
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

                {typeof onLocateMe === 'function' && (
                    <div
                        data-testid="map-locate-panel"
                        className="pointer-events-auto rounded-2xl border border-white/55 bg-white/78 p-1.5 shadow-[0_14px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/72"
                    >
                        <button
                            type="button"
                            onClick={onLocateMe}
                            disabled={isLocating}
                            aria-busy={isLocating}
                            data-testid="map-locate-me"
                            aria-label="Cek CCTV terdekat dari lokasi saya"
                            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/40 bg-white/70 px-3 py-2 text-[11px] font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-gray-800/85 dark:text-gray-200 dark:hover:bg-gray-800"
                        >
                            <Icons.MapPin />
                            {isLocating ? 'Mencari lokasi…' : 'Cek CCTV terdekat'}
                        </button>
                        {locateError && (
                            <p
                                data-testid="map-locate-error"
                                role="alert"
                                className="mt-1.5 px-1 text-[11px] font-medium text-red-600 dark:text-red-400"
                            >
                                {locateError}
                            </p>
                        )}
                        {!locateError && nearbyMessage && (
                            <p
                                data-testid="map-locate-nearby"
                                role="status"
                                aria-live="polite"
                                title="Jarak garis lurus (bukan jarak tempuh)"
                                className="mt-1.5 px-1 text-[11px] font-medium text-gray-600 dark:text-gray-300"
                            >
                                {nearbyMessage}
                            </p>
                        )}
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
