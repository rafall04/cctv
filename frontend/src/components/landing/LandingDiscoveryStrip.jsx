/*
 * Purpose: Render compact mobile-safe public discovery tabs with capped active lists shared by full and simple public landing modes.
 * Caller: LandingPage and LandingPageSimple.
 * Deps: React state/memo hooks, React Router Link, sanitized public discovery payloads.
 * MainFuncs: LandingDiscoveryStrip, DiscoveryCameraButton, DiscoveryAreaLink.
 * SideEffects: Invokes caller-provided camera click handlers.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildLandingDiscoverySections, formatLandingDiscoveryCount, LANDING_DISCOVERY_LIMIT } from '../../utils/publicLandingSections';

function DiscoverySkeleton() {
    return (
        <section data-testid="landing-discovery-strip-loading" className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
            <div className="h-[116px] animate-pulse rounded-card border border-edge bg-surface" />
        </section>
    );
}

const ITEM_CLASS = 'group flex min-h-[72px] w-[min(18rem,calc(100vw-4rem))] shrink-0 items-center gap-3 rounded-card border border-edge bg-surface px-3 py-2 text-left transition-colors hover:border-edge-strong hover:bg-primary/5 sm:w-[250px]';

function DiscoveryCameraButton({ camera, metricLabel, metricValue, onCameraClick }) {
    return (
        <button type="button" onClick={() => onCameraClick?.(camera)} className={ITEM_CLASS}>
            {/* Was a red "LIVE" tile. Red is reserved for faults now (see LandingCameraCard),
                and every card in this strip is live anyway, so the badge said nothing. */}
            <span className="flex h-2 w-2 shrink-0 rounded-full bg-status-live" aria-hidden="true"></span>
            <span className="sr-only">Siaran langsung</span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-content">{camera.name}</div>
                <div className="mt-0.5 truncate text-xs text-content-muted">{camera.area_name || camera.location || 'Area publik'}</div>
                <div className="mt-1 text-xs font-medium tabular-nums text-content-subtle">
                    {formatLandingDiscoveryCount(metricValue)} {metricLabel}
                </div>
            </div>
        </button>
    );
}

function DiscoveryAreaLink({ area }) {
    return (
        <Link to={`/area/${area.slug}`} className={ITEM_CLASS}>
            <span className="shrink-0 text-content-subtle" aria-hidden="true">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                    <circle cx="12" cy="11" r="3" />
                </svg>
            </span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-content">{area.name}</div>
                <div className="mt-0.5 truncate text-xs text-content-muted tabular-nums">{formatLandingDiscoveryCount(area.camera_count)} kamera publik</div>
                <div className="mt-1 text-xs font-medium tabular-nums text-content-subtle">
                    {formatLandingDiscoveryCount(area.total_views)}x ditonton
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
    maxItemsPerSection = LANDING_DISCOVERY_LIMIT,
}) {
    const sections = useMemo(() => buildLandingDiscoverySections(discovery), [discovery]);
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
            <div className="min-w-0 max-w-full overflow-hidden rounded-card border border-edge bg-surface p-2 sm:p-3">
                {/* A single tab is not a choice — show its name as a plain heading instead. */}
                {sections.length > 1 ? (
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
                                    className={`shrink-0 rounded-control px-3 py-2 text-xs font-medium transition-colors ${
                                        active
                                            ? 'bg-primary text-white'
                                            : 'text-content-muted hover:bg-surface-raised hover:text-content'
                                    }`}
                                >
                                    {section.label}
                                    <span className={`ml-2 tabular-nums ${active ? 'text-white/70' : 'text-content-subtle'}`}>
                                        {formatLandingDiscoveryCount(section.items.length)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <h2 className="px-1 pb-2 text-xs font-medium text-content-muted">{activeSection.label}</h2>
                )}

                {hiddenItemCount > 0 && (
                    <div className="px-1 pb-1 text-[11px] font-medium tabular-nums text-content-subtle">
                        Menampilkan {formatLandingDiscoveryCount(activeItems.length)} dari {formatLandingDiscoveryCount(activeSection.items.length)}
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
