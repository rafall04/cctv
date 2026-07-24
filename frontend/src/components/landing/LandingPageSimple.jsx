/**
 * Purpose: Renders the lightweight public landing mode with status, compact discovery, compact smart feed, camera list, and footer.
 * Caller: LandingPage when layoutMode is simple.
 * Deps: Camera, branding, theme, landing config, discovery/quick access strips, ads, feedback, and support components.
 * MainFuncs: LandingPageSimple, SimpleHeader, SimpleStatusOverview, SimpleFooter.
 * SideEffects: Lazy-loads optional floating widgets and ad slots.
 */
import { Suspense, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useBranding } from '../../contexts/BrandingContext';
import { useCameras } from '../../contexts/CameraContext';
import InlineAdSlot from '../ads/InlineAdSlot';
import { isAdsMobileViewport, shouldRenderAdSlot } from '../ads/adsConfig';
import { shouldDisableAnimations } from '../../utils/animationControl';
import { setLitePreference } from '../../utils/publicExperienceMode';
import { getPublicCameraStats } from '../../utils/publicCameraStats';
import { groupCamerasByCity } from '../../utils/publicCityMapping';
import lazyWithRetry from '../../utils/lazyWithRetry';
import LayoutModeToggle from './LayoutModeToggle';
import LandingBezelTicks from './LandingBezelTicks';
import LandingPublicTopStack from './LandingPublicTopStack';
import LandingDiscoveryStrip from './LandingDiscoveryStrip';
import LandingQuickAccessStrip from './LandingQuickAccessStrip';
import DeferUntilVisible from './DeferUntilVisible';
import useDeferredMount from '../../hooks/public/useDeferredMount';
import { GridSkeleton, CameraCardSkeleton } from '../ui/Skeleton';

const FeedbackWidget = lazyWithRetry(() => import('../FeedbackWidget'), 'feedback-widget-inline');
const SaweriaSupport = lazyWithRetry(() => import('../SaweriaSupport'), 'saweria-support-inline');

const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>,
    Bolt: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
};

function SimpleHeader({ branding, layoutMode, onLayoutToggle, disableHeavyEffects = false }) {
    const { isDark, toggleTheme } = useTheme();
    const { cameras } = useCameras();
    // backdrop-blur on a sticky header re-composites the scrolling content behind it on every frame —
    // the worst scroll-jank offender on weak GPUs. Drop it under the lite experience (or low/reduced-motion).
    const disableAnimations = disableHeavyEffects || shouldDisableAnimations();
    // Same canonical tally the Full navbar shows, so the operational pulse reads identically in both modes.
    const onlineCount = useMemo(() => getPublicCameraStats(cameras).online, [cameras]);
    const handleLayoutChange = (nextMode) => {
        if (nextMode !== layoutMode) {
            onLayoutToggle();
        }
    };

    return (
        <header className={`sticky top-0 z-[1001] bg-surface ${disableAnimations ? '' : 'supports-[backdrop-filter]:bg-surface/85 supports-[backdrop-filter]:backdrop-blur-lg'} border-b border-edge`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-14">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <Link to="/" className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-90" title={branding.company_name}>
                            <div className="relative">
                                <div className="flex h-8 w-8 items-center justify-center rounded-control bg-primary text-white">
                                    <span className="text-sm font-bold">{branding.logo_text}</span>
                                </div>
                                {onlineCount > 0 && (
                                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-status-live ring-2 ring-surface" aria-hidden="true"></span>
                                )}
                            </div>
                        </Link>
                        {/* Operational pulse — the command-deck identity, trimmed for the compact simple
                            header: live online count in mono. The clock/tagline that ride the Full navbar
                            are dropped to keep this mode light. */}
                        <div className="flex min-w-0 items-center gap-1.5 rounded-control border border-edge bg-surface-sunken px-2 py-1" title="Kamera daring sekarang">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full bg-status-live ${disableAnimations ? '' : 'animate-pulse'}`} aria-hidden="true"></span>
                            <span className="font-mono text-xs font-semibold tabular-nums text-content">{onlineCount}</span>
                            <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-status-live sm:inline">Online</span>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        <LayoutModeToggle
                            layoutMode={layoutMode}
                            onChange={handleLayoutChange}
                            compact
                        />
                        <button
                            type="button"
                            onClick={() => setLitePreference(!disableHeavyEffects)}
                            aria-pressed={disableHeavyEffects}
                            aria-label="Mode Hemat"
                            className={`inline-flex items-center gap-1.5 rounded-control border px-2.5 py-2 text-xs font-semibold transition-colors ${
                                disableHeavyEffects
                                    ? 'border-status-live/40 bg-status-live/10 text-status-live'
                                    : 'border-edge bg-surface text-content-muted hover:border-edge-strong hover:text-content'
                            }`}
                            title={disableHeavyEffects
                                ? 'Mode Hemat aktif — ketuk untuk efek penuh'
                                : 'Aktifkan Mode Hemat (ringan untuk perangkat lemah)'}
                        >
                            <Icons.Bolt />
                            <span className="hidden sm:inline">Hemat</span>
                        </button>
                        <button
                            onClick={toggleTheme}
                            className="rounded-control border border-edge bg-surface p-2 text-content-muted transition-colors hover:border-edge-strong hover:text-content"
                            title={isDark ? 'Light Mode' : 'Dark Mode'}
                        >
                            {isDark ? <Icons.Sun /> : <Icons.Moon />}
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}

function SimpleFooter({ branding, saweriaEnabled, saweriaLink }) {
    const { cameras } = useCameras();
    const { online, total } = useMemo(() => getPublicCameraStats(cameras), [cameras]);
    const cityCount = useMemo(() => groupCamerasByCity(cameras).length, [cameras]);
    const footerStats = [
        { key: 'unit', label: 'Unit', value: total, valueClass: 'text-content' },
        { key: 'kota', label: 'Kota', value: cityCount, valueClass: 'text-content' },
        { key: 'online', label: 'Online', value: online, valueClass: 'text-status-live' },
    ];

    return (
        <footer className="mt-4 py-6 border-t border-edge bg-surface-sunken sm:mt-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center space-y-3">
                    <div className="flex flex-col items-center gap-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-4 py-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-control bg-primary text-white">
                                <span className="text-xs font-bold">{branding.logo_text}</span>
                            </div>
                            <span className="text-sm font-bold text-primary-600 dark:text-primary-400">{branding.company_name}</span>
                        </div>

                        {/* Operational mono-stat cluster — echoes the Full footer's statistik board in a
                            compact hairline row: the network payload in three figures. */}
                        <div className="inline-flex items-stretch gap-px overflow-hidden rounded-control border border-edge bg-edge">
                            {footerStats.map((stat) => (
                                <div key={stat.key} className="flex items-baseline gap-1.5 bg-surface px-3 py-1.5">
                                    <span className={`font-mono text-sm font-bold tabular-nums ${stat.valueClass}`}>{stat.value}</span>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-subtle">{stat.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-content-subtle">
                        <span>&copy; {new Date().getFullYear()} {branding.company_name}</span>
                        <a
                            href="#feedback"
                            onClick={(e) => {
                                e.preventDefault();
                                document.querySelector('[data-feedback-widget]')?.click();
                            }}
                            className="transition-colors hover:text-content"
                        >
                            Feedback
                        </a>
                        {saweriaEnabled && saweriaLink && (
                            <a
                                href={saweriaLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="transition-colors hover:text-content"
                            >
                                Dukung
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </footer>
    );
}

/*
 * The public status deck, Simple-mode cut. Full mode pairs the spotlight thumbnail with
 * the metric board; Simple keeps only the board — no image, no drill-down modal, no
 * per-second clock — so it speaks the same command-deck language (mono metric grid,
 * instrument bezel, cyan "watching now") while staying cheap enough for weak devices.
 * The figures are the payload and stay honest: the SAME canonical tally as Full, so the
 * two modes never disagree on how many cameras are online.
 */
function SimpleStatusOverview({ disableHeavyEffects = false }) {
    const { cameras, loading } = useCameras();

    const { online, offline, total } = useMemo(() => getPublicCameraStats(cameras), [cameras]);
    // Kota (city) rollup — the public identity is a multi-city network, so cities are a
    // first-class metric here just as on the Full deck.
    const cities = useMemo(() => groupCamerasByCity(cameras), [cameras]);
    // Honest "watching now" = summed live viewers; no fabricated time-series sparkline.
    const liveViewersNow = useMemo(
        () => cameras.reduce(
            (sum, camera) => sum + Number(camera.live_viewers ?? camera.viewer_stats?.live_viewers ?? 0),
            0,
        ),
        [cameras],
    );

    const metrics = [
        { key: 'online', label: 'Online', value: online, valueClass: 'text-status-live' },
        { key: 'offline', label: 'Offline', value: offline, valueClass: offline > 0 ? 'text-status-fault' : 'text-content' },
        { key: 'total', label: 'Total', value: total, valueClass: 'text-content' },
        { key: 'kota', label: 'Kota', value: cities.length, valueClass: 'text-content' },
    ];

    return (
        <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
            <section className="relative rounded-card border border-edge bg-surface p-3.5" aria-label="Status jaringan kamera">
                <LandingBezelTicks />
                <h2 className="mb-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-content-subtle">Status kamera</h2>

                {/* Hairline 2×2 (→ 4-col on sm) metric grid. The numeral is the emphasis
                    (mono + tabular so it never twitches as counts refresh); colour on the
                    value encodes state — green online, red offline — not decoration. */}
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-edge bg-edge sm:grid-cols-4">
                    {metrics.map((metric) => (
                        <div key={metric.key} className="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
                            <span className={`font-mono text-xl font-bold leading-none tabular-nums ${metric.valueClass}`}>
                                {loading ? '…' : metric.value}
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-subtle">{metric.label}</span>
                        </div>
                    ))}
                </div>

                <div className="mt-2.5 flex items-center justify-between border-t border-edge pt-2.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-subtle">Menonton sekarang</span>
                    <span className="flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-data">
                        <span className={`h-1.5 w-1.5 rounded-full bg-data ${disableHeavyEffects ? '' : 'animate-pulse'}`} aria-hidden="true"></span>
                        {liveViewersNow.toLocaleString('id-ID')}
                    </span>
                </div>

                {cities.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-subtle">Cakupan</span>
                        {cities.slice(0, 3).map((city) => (
                            <span key={city.key} className="rounded-full border border-edge px-2 py-0.5 font-mono text-[10px] text-content-muted">
                                {city.label} <span className="text-content-subtle">{city.count}</span>
                            </span>
                        ))}
                        {cities.length > 3 && (
                            <span className="font-mono text-[10px] text-content-subtle">+{cities.length - 3} kota</span>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}

// Cheap placeholder shown for one frame while the heavy camera workspace mounts under the lite
// experience — mirrors the real section's outer spacing so revealing the grid does not shift layout.
function CamerasMountSkeleton() {
    return (
        <section className="py-8 pb-16 sm:py-12 sm:pb-24" aria-hidden="true">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <GridSkeleton items={6} columns={2} SkeletonComponent={CameraCardSkeleton} />
            </div>
        </section>
    );
}

export default function LandingPageSimple({
    onCameraClick,
    onAddMulti,
    multiCameras,
    saweriaEnabled,
    saweriaLink,
    CamerasSection,
    layoutMode,
    onLayoutToggle,
    favorites,
    onToggleFavorite,
    isFavorite,
    viewMode,
    setViewMode,
    adsConfig = null,
    onMapCameraOpen = null,
    hideFloatingWidgets = false,
    announcement,
    eventBanner,
    publicConfigLoading = false,
    publicDiscovery = null,
    discoveryLoading = false,
    recentCameras = [],
    favoriteCameras = [],
    onQuickCameraOpen,
    disableHeavyEffects = false,
}) {
    const { branding } = useBranding();
    const showFooterBanner = shouldRenderAdSlot(adsConfig, 'footerBanner', isAdsMobileViewport());
    const shouldRenderFloatingWidgets = !hideFloatingWidgets;
    // Under the lite experience, let the cheap shell (header/status/discovery) paint first, then mount
    // the heavy camera workspace (filters + search index + cards) a frame later — kills the first-paint
    // freeze on weak CPUs. Capable devices mount it synchronously (no skeleton flash).
    const camerasReady = useDeferredMount({ enabled: disableHeavyEffects });

    // Secondary discovery strip below the fold. Under the lite experience it is mounted only when
    // scrolled near the viewport, trimming initial mount/paint work on constrained devices.
    const quickAccessSection = (
        <LandingQuickAccessStrip
            recentCameras={recentCameras}
            favoriteCameras={favoriteCameras}
            onCameraClick={onQuickCameraOpen || onCameraClick}
            forceVisible
        />
    );

    return (
        <div className="min-h-screen bg-surface-sunken pb-24 flex flex-col sm:pb-0">
            <SimpleHeader
                branding={branding}
                layoutMode={layoutMode}
                onLayoutToggle={onLayoutToggle}
                disableHeavyEffects={disableHeavyEffects}
            />

            <LandingPublicTopStack
                layoutMode="simple"
                loading={publicConfigLoading}
                eventBanner={eventBanner}
                announcement={announcement}
            />

            <SimpleStatusOverview disableHeavyEffects={disableHeavyEffects} />

            <LandingDiscoveryStrip
                discovery={publicDiscovery}
                loading={discoveryLoading}
                onCameraClick={onCameraClick}
                className="pt-2"
            />

            {disableHeavyEffects
                ? <DeferUntilVisible minHeight={120}>{quickAccessSection}</DeferUntilVisible>
                : quickAccessSection}

            <main className="flex-1 min-h-0 pb-4 sm:pb-6">
                {CamerasSection && (camerasReady ? (
                    <CamerasSection
                        onCameraClick={onCameraClick}
                        onAddMulti={onAddMulti}
                        multiCameras={multiCameras}
                        viewMode={viewMode}
                        setViewMode={setViewMode}
                        adsConfig={adsConfig}
                        onMapCameraOpen={onMapCameraOpen}
                        favorites={favorites}
                        onToggleFavorite={onToggleFavorite}
                        isFavorite={isFavorite}
                        disableHeavyEffects={disableHeavyEffects}
                    />
                ) : (
                    <CamerasMountSkeleton />
                ))}
            </main>

            {showFooterBanner && (
                <InlineAdSlot
                    slotKey="footer-banner-simple"
                    label="Sponsored"
                    script={adsConfig.slots.footerBanner.script}
                    className="mt-2"
                    minHeightClassName="min-h-[120px]"
                />
            )}

            <SimpleFooter
                branding={branding}
                saweriaEnabled={saweriaEnabled}
                saweriaLink={saweriaLink}
            />

            {shouldRenderFloatingWidgets && (
                <>
                    <Suspense fallback={null}>
                        <FeedbackWidget />
                    </Suspense>

                    <Suspense fallback={null}>
                        <SaweriaSupport />
                    </Suspense>
                </>
            )}
        </div>
    );
}
