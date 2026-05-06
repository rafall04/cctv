/*
 * Purpose: Render a mobile-only public landing bottom navigation dock for common camera workflows.
 * Caller: LandingPage and LandingPageSimple.
 * Deps: React props and caller-provided view/scroll handlers.
 * MainFuncs: LandingMobileDock.
 * SideEffects: Invokes callbacks to change view mode or scroll public sections.
 */

const NAV_ITEMS = [
    { key: 'home', label: 'Home' },
    { key: 'map', label: 'Map' },
    { key: 'grid', label: 'Grid' },
    { key: 'quick', label: 'Favorit' },
    { key: 'playback', label: 'Playback' },
];

export default function LandingMobileDock({
    viewMode,
    onViewModeChange,
    onHomeClick,
    onQuickAccessClick,
    quickAccessCount = 0,
    favoriteCount = 0,
}) {
    const handleClick = (key) => {
        if (key === 'home') {
            onHomeClick?.();
            return;
        }

        if (key === 'quick') {
            onQuickAccessClick?.();
            return;
        }

        onViewModeChange?.(key);
    };

    return (
        <nav
            data-testid="landing-mobile-dock"
            className="fixed inset-x-3 bottom-3 z-[1200] rounded-2xl border border-gray-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/95 sm:hidden"
            aria-label="Navigasi publik mobile"
        >
            <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
                {NAV_ITEMS.map((item) => {
                    const active = item.key === viewMode;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => handleClick(item.key)}
                            className={`relative rounded-xl px-2 py-2 text-[11px] font-semibold transition ${
                                active
                                    ? 'bg-primary text-white'
                                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                            }`}
                        >
                            <span>{item.label}</span>
                            {item.key === 'quick' && favoriteCount > 0 && (
                                <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                                    {favoriteCount}
                                </span>
                            )}
                            {item.key === 'quick' && quickAccessCount > 0 && (
                                <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : 'bg-primary'}`} />
                            )}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
