/*
 * Purpose: Render public map top chrome controls without blocking Leaflet layer controls.
 * Caller: MapView public CCTV map.
 * Deps: React props from MapView, ui/Icons for the GPS pin glyph.
 * MainFuncs: MapTopChrome.
 * SideEffects: Emits area filter, reset, and locate-me events through callback props.
 */

import { Icons } from '../ui/Icons.jsx';

/*
 * These panels float over a moving map, so they stay opaque rather than tinted:
 * a translucent slab over satellite imagery is exactly where text legibility dies.
 * The previous version leaned on arbitrary values — `bg-white/78`, `border-white/55`
 * and a bespoke `shadow-[0_14px_30px_rgba(15,23,42,0.12)]` repeated three times —
 * none of which existed anywhere else in the app.
 */
const PANEL_CLASS = 'pointer-events-auto rounded-card border border-edge bg-surface p-1.5 shadow-e2';
// No hover lift: these sit on top of a draggable map, and controls that jump on
// hover read as instability right where the user is trying to aim.
const CONTROL_CLASS = 'rounded-control border border-edge px-3 py-2 text-[11px] font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60';

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
                    <div data-testid="map-area-filter-panel" className={PANEL_CLASS}>
                        <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
                            {/* Was "Area View" in uppercase with 0.22em tracking — an English
                                label shouting on an Indonesian UI. */}
                            <span className="text-[11px] font-medium text-content-muted">
                                Area
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <select
                                value={selectedAreaValue}
                                onChange={onAreaChange}
                                data-testid="map-area-select"
                                className="min-w-0 flex-1 rounded-control border-0 bg-transparent px-2.5 py-2 text-xs font-medium text-content focus:outline-none focus:ring-2 focus:ring-primary sm:text-sm"
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
                                className={CONTROL_CLASS}
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                )}

                {typeof onLocateMe === 'function' && (
                    <div data-testid="map-locate-panel" className={PANEL_CLASS}>
                        <button
                            type="button"
                            onClick={onLocateMe}
                            disabled={isLocating}
                            aria-busy={isLocating}
                            data-testid="map-locate-me"
                            aria-label="Cek CCTV terdekat dari lokasi saya"
                            className={`flex w-full items-center justify-center gap-1.5 ${CONTROL_CLASS}`}
                        >
                            <Icons.MapPin />
                            {isLocating ? 'Mencari lokasi…' : 'Cek CCTV terdekat'}
                        </button>
                        {locateError && (
                            <p
                                data-testid="map-locate-error"
                                role="alert"
                                className="mt-1.5 px-1 text-[11px] font-medium text-status-fault"
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
                                className="mt-1.5 px-1 text-[11px] font-medium text-content-muted"
                            >
                                {nearbyMessage}
                            </p>
                        )}
                    </div>
                )}

                {shouldShowZoomHint && (
                    <div
                        data-testid="map-zoom-hint"
                        className="pointer-events-none inline-flex max-w-fit items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1.5 text-[11px] font-medium text-content-muted shadow-e2"
                    >
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                        Zoom in untuk lihat kamera individual
                    </div>
                )}
            </div>
        </div>
    );
}
