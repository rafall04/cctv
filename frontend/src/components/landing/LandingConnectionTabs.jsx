/*
 * Purpose: Grid ranking/quality filter chips for the public landing (Semua / Stabil /
 *          Paling Ramai / Terbaru / Favorit). "Tunnel" was removed — it is internal
 *          transport jargon and must never surface on a public page (same rule the card
 *          and MapView already enforce).
 * Caller: LandingCamerasSection contextual controls (grid view).
 * Deps: Camera viewer stats and favorites arrays.
 * MainFuncs: LandingConnectionTabs.
 * SideEffects: Invokes caller-provided tab change handler.
 */

export default function LandingConnectionTabs({
    connectionTab,
    onChange,
    areaFilteredCameras,
    favorites,
    favoritesInAreaCount,
}) {
    const stableCount = areaFilteredCameras.filter((camera) => camera.is_tunnel !== 1).length;
    const newestCount = areaFilteredCameras.filter((camera) => camera.created_at).length || areaFilteredCameras.length;

    const tabs = [
        { key: 'all', label: 'Semua', count: areaFilteredCameras.length, dot: null },
        { key: 'stable', label: 'Stabil', count: stableCount, dot: 'bg-status-live' },
        { key: 'popular', label: 'Paling Ramai', count: areaFilteredCameras.length, dot: 'bg-data' },
        { key: 'newest', label: 'Terbaru', count: newestCount, dot: 'bg-content-subtle' },
    ];
    if (favorites.length > 0) {
        tabs.push({ key: 'favorites', label: 'Favorit', count: favoritesInAreaCount, dot: 'bg-status-warn' });
    }

    return (
        <div className="flex w-fit flex-wrap gap-1 rounded-control border border-edge bg-surface-sunken p-1">
            {tabs.map((tab) => {
                const active = connectionTab === tab.key;
                return (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => onChange(tab.key)}
                        aria-pressed={active}
                        className={`flex items-center gap-1.5 rounded-[calc(var(--radius-control)-0.25rem)] px-3 py-1.5 text-sm font-medium transition-colors ${
                            active
                                ? 'bg-surface text-content shadow-e1'
                                : 'text-content-muted hover:text-content'
                        }`}
                    >
                        {tab.dot && <span className={`h-1.5 w-1.5 rounded-full ${tab.dot}`} aria-hidden="true"></span>}
                        {tab.label}
                        <span className="font-mono tabular-nums text-content-subtle">({tab.count})</span>
                    </button>
                );
            })}
        </div>
    );
}
