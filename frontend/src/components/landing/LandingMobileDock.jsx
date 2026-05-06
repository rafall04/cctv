/*
 * Purpose: Render a mobile-only public landing bottom navigation dock for common camera workflows.
 * Caller: LandingPage and LandingPageSimple.
 * Deps: React props and caller-provided view/scroll handlers.
 * MainFuncs: LandingMobileDock.
 * SideEffects: Invokes callbacks to change view mode or scroll public sections.
 */

import { Icons } from '../ui/Icons';

const NAV_ITEMS = [
    { key: 'home', label: 'Home' },
    { key: 'map', label: 'Map' },
    { key: 'grid', label: 'Grid' },
    { key: 'quick', label: 'Favorit' },
    { key: 'playback', label: 'Playback' },
];

function HomeIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M3 11.5L12 4l9 7.5" />
            <path d="M5 10.5V20h14v-9.5" />
            <path d="M9 20v-6h6v6" />
        </svg>
    );
}

function MapIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
    );
}

function GridIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
        </svg>
    );
}

function QuickIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
    );
}

function PlaybackIcon() {
    return (
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function DockIcon({ itemKey }) {
    switch (itemKey) {
        case 'home':
            return <HomeIcon />;
        case 'map':
            return <MapIcon />;
        case 'grid':
            return <GridIcon />;
        case 'quick':
            return <QuickIcon />;
        case 'playback':
            return <PlaybackIcon />;
        default:
            return <Icons.Camera />;
    }
}

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
            <div className="mx-auto grid max-w-md grid-cols-5 gap-1 sm:max-w-none">
                {NAV_ITEMS.map((item) => {
                    const active = item.key === viewMode;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => handleClick(item.key)}
                            aria-label={item.key === 'quick' && favoriteCount > 0 ? `${item.label} ${favoriteCount}` : item.label}
                            className={`relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold leading-none transition sm:text-[11px] ${
                                active
                                    ? 'bg-primary text-white'
                                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                            }`}
                        >
                            <span className="flex h-4 w-4 items-center justify-center">
                                <DockIcon itemKey={item.key} />
                            </span>
                            <span className="truncate">{item.label}</span>
                            {item.key === 'quick' && favoriteCount > 0 && (
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
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
