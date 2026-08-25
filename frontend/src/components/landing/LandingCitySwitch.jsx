/*
 * Purpose: Primary geographic facet for the public landing — a scrollable row of city
 *          (kota) chips with per-city camera counts. Makes the multi-city network legible
 *          up front instead of hiding cities inside the finer area dropdown.
 * Caller: LandingCamerasSection contextual controls (grid + map views).
 * Deps: none (data comes from useLandingCameraFilters via publicCityMapping).
 * MainFuncs: LandingCitySwitch.
 * SideEffects: Invokes caller-provided city change handler.
 */

export default function LandingCitySwitch({ selectedCity, onChange, cityOptions, totalCount }) {
    // Nothing to switch between when the network only spans one city.
    if (!Array.isArray(cityOptions) || cityOptions.length <= 1) {
        return null;
    }

    const renderChip = (key, label, count, active) => (
        <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={`flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-0 ${
                active
                    ? 'border-primary bg-primary/10 text-content'
                    : 'border-edge bg-surface text-content-muted hover:border-edge-strong hover:text-content'
            }`}
        >
            {label}
            <span className={`tabular-nums ${active ? 'text-primary' : 'text-content-subtle'}`}>{count}</span>
        </button>
    );

    return (
        <div className="flex max-w-full items-center gap-2.5">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-content-subtle">Kota</span>
            {/* min-w-0 + max-w-full + [contain:paint] — see LandingDiscoveryStrip for the incident:
                a horizontal strip's overflow otherwise widens the document itself, and an in-app
                WebView fits its initial zoom to that width, shrinking the whole page. */}
            <div className="no-scrollbar -m-1 flex min-w-0 max-w-full gap-2 overflow-x-auto p-1 [contain:paint] [-webkit-overflow-scrolling:touch]">
                {renderChip('all', 'Semua', totalCount, selectedCity === 'all')}
                {cityOptions.map((city) => renderChip(city.key, city.label, city.count, selectedCity === city.key))}
            </div>
        </div>
    );
}
