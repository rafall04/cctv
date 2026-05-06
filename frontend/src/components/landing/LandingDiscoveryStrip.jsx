/*
 * Purpose: Render compact mobile-safe public discovery tabs with capped active lists shared by full and simple public landing modes.
 * Caller: LandingPage and LandingPageSimple.
 * Deps: React state/memo hooks, React Router Link, sanitized public discovery payloads.
 * MainFuncs: LandingDiscoveryStrip, DiscoveryCameraButton, DiscoveryAreaLink.
 * SideEffects: Invokes caller-provided camera click handlers.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

function formatCount(value) {
    return Number(value || 0).toLocaleString('id-ID');
}

function getItems(discovery, key) {
    return Array.isArray(discovery?.[key]) ? discovery[key] : [];
}

function buildSections(discovery) {
    return [
        {
            key: 'live_now',
            label: 'Sedang Ramai',
            metricLabel: 'penonton',
            items: getItems(discovery, 'live_now'),
            type: 'camera',
            metric: (camera) => camera.live_viewers,
        },
        {
            key: 'top_cameras',
            label: 'Paling Ditonton',
            metricLabel: 'views',
            items: getItems(discovery, 'top_cameras'),
            type: 'camera',
            metric: (camera) => camera.total_views,
        },
        {
            key: 'popular_areas',
            label: 'Area Populer',
            metricLabel: 'views',
            items: getItems(discovery, 'popular_areas'),
            type: 'area',
            metric: (area) => area.total_views,
        },
        {
            key: 'new_cameras',
            label: 'Kamera Terbaru',
            metricLabel: 'views',
            items: getItems(discovery, 'new_cameras'),
            type: 'camera',
            metric: (camera) => camera.total_views,
        },
    ].filter((section) => section.items.length > 0);
}

function DiscoverySkeleton() {
    return (
        <section data-testid="landing-discovery-strip-loading" className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
            <div className="h-[116px] animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" />
        </section>
    );
}

function DiscoveryCameraButton({ camera, metricLabel, metricValue, onCameraClick }) {
    return (
        <button
            type="button"
            onClick={() => onCameraClick?.(camera)}
            className="group flex min-h-[72px] w-[min(18rem,calc(100vw-4rem))] shrink-0 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-primary/60 hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-primary/10 sm:w-[250px]"
        >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[10px] font-bold text-red-600 dark:bg-red-500/10 dark:text-red-300">
                LIVE
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{camera.area_name || camera.location || 'Area publik'}</div>
                <div className="mt-1 text-xs font-semibold text-primary">
                    {formatCount(metricValue)} {metricLabel}
                </div>
            </div>
        </button>
    );
}

function DiscoveryAreaLink({ area }) {
    return (
        <Link
            to={`/area/${area.slug}`}
            className="group flex min-h-[72px] w-[min(18rem,calc(100vw-4rem))] shrink-0 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-primary/60 hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-primary/10 sm:w-[250px]"
        >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                AREA
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{area.name}</div>
                <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{formatCount(area.camera_count)} kamera publik</div>
                <div className="mt-1 text-xs font-semibold text-primary">
                    {formatCount(area.total_views)}x ditonton
                </div>
            </div>
        </Link>
    );
}

export default function LandingDiscoveryStrip({
    discovery = {},
    loading = false,
    onCameraClick,
    className = '',
    maxItemsPerSection = 8,
}) {
    const sections = useMemo(() => buildSections(discovery), [discovery]);
    const [activeKey, setActiveKey] = useState('');
    const activeSection = sections.find((section) => section.key === activeKey) || sections[0];
    const activeItems = activeSection?.items.slice(0, maxItemsPerSection) || [];
    const hiddenItemCount = Math.max((activeSection?.items.length || 0) - activeItems.length, 0);

    if (loading) {
        return <DiscoverySkeleton />;
    }

    if (!sections.length || !activeSection) {
        return null;
    }

    return (
        <section id="public-discovery" data-testid="landing-discovery-strip" className={`mx-auto w-full max-w-full overflow-hidden px-3 py-3 sm:max-w-7xl sm:px-6 lg:px-8 ${className}`}>
            <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-gray-200 bg-white/85 p-2 shadow-sm dark:border-gray-800 dark:bg-gray-900/85 sm:p-3">
                <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]" role="tablist" aria-label="Discovery CCTV publik">
                    {sections.map((section) => {
                        const active = section.key === activeSection.key;
                        return (
                            <button
                                key={section.key}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setActiveKey(section.key)}
                                className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                                    active
                                        ? 'bg-primary text-white shadow-sm'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                                }`}
                            >
                                {section.label}
                                <span className={`ml-2 rounded-lg px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-white text-gray-500 dark:bg-gray-900 dark:text-gray-400'}`}>
                                    {section.items.length}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {hiddenItemCount > 0 && (
                    <div className="px-1 pb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        Menampilkan {activeItems.length} dari {activeSection.items.length}
                    </div>
                )}

                <div data-testid="landing-discovery-strip-list" className="flex min-w-0 max-w-full gap-2 overflow-x-auto pt-1 [-webkit-overflow-scrolling:touch]">
                    {activeItems.map((item) => (
                        activeSection.type === 'area' ? (
                            <DiscoveryAreaLink key={`area-${item.id}`} area={item} />
                        ) : (
                            <DiscoveryCameraButton
                                key={`${activeSection.key}-${item.id}`}
                                camera={item}
                                metricLabel={activeSection.metricLabel}
                                metricValue={activeSection.metric(item)}
                                onCameraClick={onCameraClick}
                            />
                        )
                    ))}
                </div>
            </div>
        </section>
    );
}
