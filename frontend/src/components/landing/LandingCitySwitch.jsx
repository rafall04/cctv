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
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-tight transition-colors ${
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
        <div className="flex items-center gap-2.5">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-content-subtle">Kota</span>
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
                {renderChip('all', 'Semua', totalCount, selectedCity === 'all')}
                {cityOptions.map((city) => renderChip(city.key, city.label, city.count, selectedCity === city.key))}
            </div>
        </div>
    );
}
