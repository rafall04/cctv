import { Suspense } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useBranding } from '../contexts/BrandingContext';
import { useCameras } from '../contexts/CameraContext';
import InlineAdSlot from './ads/InlineAdSlot';
import { isAdsMobileViewport, shouldRenderAdSlot } from './ads/adsConfig';
import { shouldDisableAnimations } from '../utils/animationControl';
import lazyWithRetry from '../utils/lazyWithRetry';
import LayoutModeToggle from './landing/LayoutModeToggle';
import LandingPublicTopStack from './landing/LandingPublicTopStack';

const FeedbackWidget = lazyWithRetry(() => import('./FeedbackWidget'), 'feedback-widget-inline');
const SaweriaSupport = lazyWithRetry(() => import('./SaweriaSupport'), 'saweria-support-inline');

const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>,
};

function SimpleHeader({ branding, layoutMode, onLayoutToggle }) {
    const { isDark, toggleTheme } = useTheme();
    const disableAnimations = shouldDisableAnimations();
    const handleLayoutChange = (nextMode) => {
        if (nextMode !== layoutMode) {
            onLayoutToggle();
        }
    };

    return (
        <header className={`sticky top-0 z-[1001] bg-white/90 dark:bg-gray-900/90 ${disableAnimations ? '' : 'backdrop-blur-xl'} border-b border-emerald-200/30 dark:border-emerald-700/30`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-14">
                    <a href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity" title={branding.company_name}>
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white shadow-lg shadow-primary/30">
                            <span className="text-sm font-bold">{branding.logo_text}</span>
                        </div>
                    </a>

                    <div className="flex items-center gap-2">
                        <LayoutModeToggle
                            layoutMode={layoutMode}
                            onChange={handleLayoutChange}
                            compact
                        />
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
        <footer className="mt-4 py-6 border-t border-emerald-200/30 dark:border-emerald-700/30 bg-gradient-to-r from-emerald-50/50 to-green-50/50 dark:from-emerald-950/20 dark:to-green-950/20 sm:mt-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center space-y-3">
                    <div className="flex flex-col items-center gap-2">
                        <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 dark:bg-primary/10 px-4 py-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white shadow-lg shadow-primary/20">
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

function SimpleStatusOverview() {
    const { cameras, loading } = useCameras();

    const onlineCount = cameras.filter((camera) => camera?.is_online === 1 || camera?.is_online === true).length;
    const offlineCount = Math.max(cameras.length - onlineCount, 0);

    return (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl border border-emerald-200/40 bg-white/90 p-4 shadow-sm dark:border-emerald-700/30 dark:bg-gray-900/70">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">Status CCTV Publik</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Ringkasan cepat untuk kondisi kamera yang sedang dimuat di mode simpel.
                        </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:min-w-[320px]">
                        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center dark:bg-emerald-500/10">
                            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Online</div>
                            <div className="mt-1 text-2xl font-bold text-emerald-800 dark:text-emerald-200">{loading ? '...' : onlineCount}</div>
                        </div>
                        <div className="rounded-xl bg-rose-50 px-4 py-3 text-center dark:bg-rose-500/10">
                            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-rose-700 dark:text-rose-300">Offline</div>
                            <div className="mt-1 text-2xl font-bold text-rose-800 dark:text-rose-200">{loading ? '...' : offlineCount}</div>
                        </div>
                        <div className="rounded-xl bg-sky-50 px-4 py-3 text-center dark:bg-sky-500/10">
                            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">Total</div>
                            <div className="mt-1 text-2xl font-bold text-sky-800 dark:text-sky-200">{loading ? '...' : cameras.length}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
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
}) {
    const { branding } = useBranding();
    const showFooterBanner = shouldRenderAdSlot(adsConfig, 'footerBanner', isAdsMobileViewport());

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
            <SimpleHeader
                branding={branding}
                layoutMode={layoutMode}
                onLayoutToggle={onLayoutToggle}
            />

            <LandingPublicTopStack
                layoutMode="simple"
                loading={publicConfigLoading}
                eventBanner={eventBanner}
                announcement={announcement}
            />

            <SimpleStatusOverview />

            <main className="flex-1 min-h-0 pb-4 sm:pb-6">
                {CamerasSection && (
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
                />
                )}
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

            {!hideFloatingWidgets && (
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
