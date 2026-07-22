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
import lazyWithRetry from '../../utils/lazyWithRetry';
import LayoutModeToggle from './LayoutModeToggle';
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
    // backdrop-blur on a sticky header re-composites the scrolling content behind it on every frame —
    // the worst scroll-jank offender on weak GPUs. Drop it under the lite experience (or low/reduced-motion).
    const disableAnimations = disableHeavyEffects || shouldDisableAnimations();
    const handleLayoutChange = (nextMode) => {
        if (nextMode !== layoutMode) {
            onLayoutToggle();
        }
    };

    return (
        <header className={`sticky top-0 z-[1001] bg-surface ${disableAnimations ? '' : 'supports-[backdrop-filter]:bg-surface/85 supports-[backdrop-filter]:backdrop-blur-lg'} border-b border-edge`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-14">
                    <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity" title={branding.company_name}>
                        <div className="w-8 h-8 rounded-control bg-primary flex items-center justify-center text-white">
                            <span className="text-sm font-bold">{branding.logo_text}</span>
                        </div>
                    </Link>

                    <div className="flex items-center gap-2">
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
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
                                disableHeavyEffects
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
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
                            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
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
    return (
        <footer className="mt-4 py-6 border-t border-edge bg-surface-sunken sm:mt-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center space-y-3">
                    <div className="flex flex-col items-center gap-2">
                        <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 dark:bg-primary/10 px-4 py-2">
                            <div className="w-7 h-7 rounded-control bg-primary flex items-center justify-center text-white">
                                <span className="text-xs font-bold">{branding.logo_text}</span>
                            </div>
                            <span className="text-sm font-bold text-primary-600 dark:text-primary-400">{branding.company_name}</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-500">
                        <span>&copy; {new Date().getFullYear()} {branding.company_name}</span>
                        <a
                            href="#feedback"
                            onClick={(e) => {
                                e.preventDefault();
                                document.querySelector('[data-feedback-widget]')?.click();
                            }}
                            className="hover:text-emerald-500 transition-colors"
                        >
                            Feedback
                        </a>
                        {saweriaEnabled && saweriaLink && (
                            <a
                                href={saweriaLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-emerald-500 transition-colors"
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
 * Compact by design. This block used to eat roughly a quarter of a phone screen to
 * deliver three numbers: a two-gradient panel, a `STATUS KAMERA` pill in 0.22em
 * uppercase tracking, two lines of prose that only restated the heading
 * ("Ringkasan cepat kamera publik saat ini." / "Pantau kondisi kamera sebelum
 * membuka live view."), and three `text-3xl` tiles in emerald/rose/sky.
 *
 * The numbers are the entire payload, so they are now one wrapping row: a dot for
 * state, the figure in tabular-nums, and its noun. Same information, ~44px instead
 * of ~250px, and the live grid starts above the fold.
 */
function SimpleStatusOverview() {
    const { cameras, loading } = useCameras();

    const onlineCount = useMemo(() => cameras.reduce((total, camera) => (
        (camera?.is_online === 1 || camera?.is_online === true) ? total + 1 : total
    ), 0), [cameras]);
    const offlineCount = Math.max(cameras.length - onlineCount, 0);
    const stats = [
        { label: 'online', value: onlineCount, dot: 'bg-status-live' },
        { label: 'offline', value: offlineCount, dot: 'bg-status-idle' },
        { label: 'total', value: cameras.length, dot: null },
    ];

    return (
        <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
            {/*
              * A fixed three-column grid instead of a wrapping flex row. The wrap
              * looked ragged on narrow phones ("749 total" dangling alone on line
              * two); three equal columns keep the figures aligned at every width
              * and can never wrap unevenly.
              */}
            <div className="rounded-card border border-edge bg-surface px-4 py-2.5">
                <h2 className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">Status kamera</h2>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {stats.map((stat) => (
                        <span key={stat.label} className="flex min-w-0 items-baseline gap-1.5 text-sm">
                            {stat.dot && (
                                <span className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${stat.dot}`} aria-hidden="true"></span>
                            )}
                            <span className="font-semibold tabular-nums text-content">
                                {loading ? '…' : stat.value}
                            </span>
                            <span className="truncate text-xs text-content-muted">{stat.label}</span>
                        </span>
                    ))}
                </div>
            </div>
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
        <div className="min-h-screen bg-gray-50 pb-24 dark:bg-gray-950 flex flex-col sm:pb-0">
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

            <SimpleStatusOverview />

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
