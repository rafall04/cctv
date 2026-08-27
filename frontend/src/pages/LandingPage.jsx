/*
 * Purpose: Compose the public CCTV landing experience across full/simple modes, compact discovery, mobile quick access, standardized popup streams, map/grid views, rich popups, and related cameras.
 * Caller: App public root route.
 * Deps: React, Router search params, branding/camera/toast contexts, landing hooks, landing components.
 * MainFuncs: LandingPage, LandingPageContent, DeferredSurfaceFallback.
 * SideEffects: Fetches public config/discovery data, opens video popups, computes popup-related cameras, manages multiview state, and pauses background refresh while public video surfaces are active.
 */

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBranding } from '../contexts/BrandingContext';
import { useCameras, CameraProvider } from '../contexts/CameraContext';
import { ToastProvider, useToast } from '../contexts/ToastContext';
import { useCameraStatusTracker } from '../hooks/useCameraStatusTracker';
import { useCameraHistory } from '../hooks/useCameraHistory';
import { useLandingModeState } from '../hooks/public/useLandingModeState';
import { useLandingPublicConfig } from '../hooks/public/useLandingPublicConfig';
import { useLandingPageController } from '../hooks/public/useLandingPageController';
import { useDeferredPublicFloatingWidgets } from '../hooks/public/useDeferredPublicFloatingWidgets';
import { useLitePublicExperience } from '../hooks/public/useLitePublicExperience';
import LandingNavbar from '../components/landing/LandingNavbar';
import LandingHero from '../components/landing/LandingHero';
import LandingFooter from '../components/landing/LandingFooter';
import LandingCamerasSection from '../components/landing/LandingCamerasSection';
import LandingPublicTopStack from '../components/landing/LandingPublicTopStack';
import CommercialSlot from '../components/commerce/CommercialSlot.jsx';
import LandingDiscoveryStrip from '../components/landing/LandingDiscoveryStrip';
import LandingQuickAccessStrip from '../components/landing/LandingQuickAccessStrip';
import LandingMobileDock from '../components/landing/LandingMobileDock';
import MultiViewButton from '../components/MultiView/MultiViewButton';
import InlineAdSlot from '../components/ads/InlineAdSlot';
import DeferUntilVisible from '../components/landing/DeferUntilVisible';
import GlobalAdScript from '../components/ads/GlobalAdScript';
import { isAdsMobileViewport, shouldRenderAdSlot } from '../components/ads/adsConfig';
import lazyWithRetry from '../utils/lazyWithRetry';
import { sortCamerasByDistance } from '../utils/geoDistance';

const LandingPageSimple = lazyWithRetry(() => import('../components/landing/LandingPageSimple'), 'landing-page-simple');
const MultiViewLayout = lazyWithRetry(() => import('../components/MultiView/MultiViewLayout'), 'multi-view-layout');
const VideoPopup = lazyWithRetry(() => import('../components/MultiView/VideoPopup'), 'video-popup');
const SaweriaLeaderboard = lazyWithRetry(() => import('../components/SaweriaLeaderboard'), 'saweria-leaderboard');
const FeedbackWidget = lazyWithRetry(() => import('../components/FeedbackWidget'), 'feedback-widget');
const SaweriaSupport = lazyWithRetry(() => import('../components/SaweriaSupport'), 'saweria-support');

function DeferredSurfaceFallback({ className = '' }) {
    return (
        <div
            className={`rounded-3xl border border-gray-200/70 bg-white/80 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70 ${className}`}
            aria-hidden="true"
        />
    );
}

function LandingPageContent({ onRefreshPauseChange }) {
    const { branding, loading: brandingLoading } = useBranding();
    const { cameras, deviceTier } = useCameras();
    const { addToast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const { favorites, recentCameras, toggleFavorite, isFavorite, addRecentCamera } = useCameraHistory();

    const {
        layoutMode,
        viewMode,
        setViewMode,
        toggleLayoutMode,
    } = useLandingModeState(searchParams, setSearchParams);

    const {
        saweriaEnabled,
        saweriaLink,
        saweriaLeaderboardLink,
        landingSettings,
        adsConfig,
        publicConfigLoading,
    } = useLandingPublicConfig();

    const {
        publicDiscovery,
        discoveryLoading,
        popup,
        multiCameras,
        showMulti,
        maxReached,
        maxStreams,
        activePopupSource,
        setShowMulti,
        handleAddMulti,
        handleRemoveMulti,
        handleGridPopupOpen,
        handleMapPopupOpen,
        handlePopupClose,
        handleMobileHomeClick,
        handleMobileQuickAccessClick,
        handleMobileViewModeChange,
    } = useLandingPageController({
        branding,
        cameras,
        layoutMode,
        viewMode,
        setViewMode,
        deviceTier,
        searchParams,
        setSearchParams,
        addToast,
        addRecentCamera,
        onRefreshPauseChange,
    });

    useCameraStatusTracker(cameras, addToast);

    // Single, reliable "lite" gate. deviceTier alone almost never reports 'low' on real low-end phones
    // (deviceMemory is absent on iOS/Firefox and quantized on Android), so we also treat mobile,
    // Save-Data, and slow networks as constrained — with an explicit user opt-out. Drives heavy-effect
    // gating, floating-widget deferral, and (via CameraContext) the background refresh cadence.
    const lite = useLitePublicExperience({ deviceTier });
    const disableHeavyEffects = lite;
    const isMobileAdsViewport = isAdsMobileViewport();
    const isPublicModalActive = Boolean(popup);
    const shouldHideFixedUiForPopup = isPublicModalActive && adsConfig?.popup?.hideFloatingWidgetsOnPopup !== false;
    const shouldHideFloatingWidgets = (showMulti && viewMode === 'grid') || shouldHideFixedUiForPopup;
    const shouldRenderFloatingWidgets = useDeferredPublicFloatingWidgets({
        enabled: !shouldHideFloatingWidgets,
        deviceTier,
        lite,
    });
    const shouldSuspendSocialBar = isPublicModalActive && adsConfig?.popup?.hideSocialBarOnPopup !== false;
    const showSocialBar = !shouldSuspendSocialBar && shouldRenderAdSlot(adsConfig, 'socialBar', isMobileAdsViewport);
    const showFooterBanner = shouldRenderAdSlot(adsConfig, 'footerBanner', isMobileAdsViewport);
    const showAfterCamerasNative = shouldRenderAdSlot(adsConfig, 'afterCamerasNative', isMobileAdsViewport);
    const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
    const cameraById = useMemo(() => new Map(cameras.map((camera) => [camera.id, camera])), [cameras]);
    const favoriteCameras = useMemo(() => (
        cameras.filter((camera) => favoriteIds.has(camera.id)).slice(0, 5)
    ), [cameras, favoriteIds]);
    const recentCameraItems = useMemo(() => (
        recentCameras
            .slice(0, 5)
            .map((recentCamera) => cameraById.get(recentCamera.id) || recentCamera)
    ), [cameraById, recentCameras]);
    const quickAccessCount = favoriteCameras.length + recentCameraItems.length;
    const favoriteCount = favoriteCameras.length;
    const relatedPopupCameras = useMemo(() => {
        if (!popup) {
            return [];
        }

        // Nearest-first; same-area + viewer ranking is the tiebreaker when distance is
        // equal or unavailable (cameras without coordinates fall back to this order).
        const rankByAreaThenViewers = (left, right) => {
            const leftSameArea = left.area_name && left.area_name === popup.area_name ? 1 : 0;
            const rightSameArea = right.area_name && right.area_name === popup.area_name ? 1 : 0;
            if (leftSameArea !== rightSameArea) {
                return rightSameArea - leftSameArea;
            }

            const liveDelta = Number(right.live_viewers || right.viewer_stats?.live_viewers || 0)
                - Number(left.live_viewers || left.viewer_stats?.live_viewers || 0);
            if (liveDelta !== 0) {
                return liveDelta;
            }

            return Number(right.total_views || right.viewer_stats?.total_views || 0)
                - Number(left.total_views || left.viewer_stats?.total_views || 0);
        };

        const candidates = cameras.filter((camera) => camera.id !== popup.id);
        return sortCamerasByDistance(candidates, popup, rankByAreaThenViewers).slice(0, 5);
    }, [cameras, popup]);

    const publicConfigReady = publicConfigLoading || brandingLoading;

    if (layoutMode === 'simple') {
        return (
            <div key="simple-mode">
                {showSocialBar && <GlobalAdScript slotKey="social-bar" script={adsConfig.slots.socialBar.script} />}
                <Suspense fallback={<div className="min-h-screen bg-surface-sunken" />}>
                    <LandingPageSimple
                        onCameraClick={handleGridPopupOpen}
                        onAddMulti={handleAddMulti}
                        multiCameras={multiCameras}
                        saweriaEnabled={saweriaEnabled}
                        saweriaLink={saweriaLink}
                        CamerasSection={LandingCamerasSection}
                        layoutMode={layoutMode}
                        onLayoutToggle={toggleLayoutMode}
                        favorites={favorites}
                        onToggleFavorite={toggleFavorite}
                        isFavorite={isFavorite}
                        viewMode={viewMode}
                        setViewMode={setViewMode}
                        adsConfig={adsConfig}
                        onMapCameraOpen={handleMapPopupOpen}
                        hideFloatingWidgets={!shouldRenderFloatingWidgets}
                        deviceTier={deviceTier}
                        disableHeavyEffects={disableHeavyEffects}
                        announcement={landingSettings.announcement}
                        eventBanner={landingSettings.eventBanner}
                        publicConfigLoading={publicConfigReady}
                        publicDiscovery={publicDiscovery}
                        discoveryLoading={discoveryLoading}
                        recentCameras={recentCameraItems}
                        favoriteCameras={favoriteCameras}
                        onQuickCameraOpen={handleGridPopupOpen}
                    />
                </Suspense>

                {!showMulti && (
                    <MultiViewButton
                        count={multiCameras.length}
                        onClick={() => setShowMulti(true)}
                        maxReached={maxReached}
                        maxStreams={maxStreams}
                    />
                )}
                {!popup && !showMulti && (
                    <LandingMobileDock
                        viewMode={viewMode}
                        onViewModeChange={handleMobileViewModeChange}
                        onHomeClick={handleMobileHomeClick}
                        onQuickAccessClick={handleMobileQuickAccessClick}
                        quickAccessCount={quickAccessCount}
                        favoriteCount={favoriteCount}
                    />
                )}

                {popup && (
                    <Suspense fallback={null}>
                        <VideoPopup
                            camera={popup}
                            onClose={handlePopupClose}
                            adsConfig={adsConfig}
                            modalTestId={activePopupSource === 'map' ? 'map-popup-modal' : 'grid-popup-modal'}
                            bodyTestId={activePopupSource === 'map' ? 'map-video-body' : 'grid-video-body'}
                            relatedCameras={relatedPopupCameras}
                            onRelatedCameraClick={(camera) => handleGridPopupOpen(camera, { replaceHistory: true })}
                            isFavorite={isFavorite}
                            onToggleFavorite={toggleFavorite}
                        />
                    </Suspense>
                )}
                {showMulti && multiCameras.length > 0 && (
                    <Suspense fallback={null}>
                        <MultiViewLayout
                            cameras={multiCameras}
                            onRemove={handleRemoveMulti}
                            onClose={() => setShowMulti(false)}
                        />
                    </Suspense>
                )}
            </div>
        );
    }

    return (
        <div key="full-mode">
            {showSocialBar && <GlobalAdScript slotKey="social-bar" script={adsConfig.slots.socialBar.script} />}
            <div className="min-h-screen bg-surface-sunken pb-24 flex flex-col sm:pb-0">
                <LandingNavbar branding={branding} layoutMode={layoutMode} onLayoutToggle={toggleLayoutMode} />
                {/* Landmark for skip-to-content / screen-reader navigation. flex-1 keeps the
                    footer pinned to the bottom exactly as the previous flat layout did. */}
                <main id="main-content" className="flex flex-1 flex-col">
                    <LandingPublicTopStack
                        layoutMode="full"
                        loading={publicConfigReady}
                        eventBanner={landingSettings.eventBanner}
                        announcement={landingSettings.announcement}
                    />

                    <LandingHero
                        branding={branding}
                        landingSettings={landingSettings}
                        disableHeavyEffects={disableHeavyEffects}
                        onCameraClick={handleGridPopupOpen}
                    />

                    {/*
                      * One ranked discovery surface, not two. LandingSmartFeed used to render
                      * directly below this strip showing the same cameras again under different
                      * headings ("Paling Ditonton" here vs "Paling Banyak Ditonton" there), so
                      * the page repeated its top six cameras across four sections. This strip
                      * wins because its ranking is backend-aggregated and it also covers areas,
                      * which the camera-only feed could not.
                      */}
                    <LandingDiscoveryStrip
                        discovery={publicDiscovery}
                        loading={discoveryLoading}
                        onCameraClick={handleGridPopupOpen}
                    />

                    <LandingQuickAccessStrip
                        recentCameras={recentCameraItems}
                        favoriteCameras={favoriteCameras}
                        onCameraClick={handleGridPopupOpen}
                        forceVisible
                    />

                    <LandingCamerasSection
                        onCameraClick={handleGridPopupOpen}
                        onAddMulti={handleAddMulti}
                        multiCameras={multiCameras}
                        viewMode={viewMode}
                        setViewMode={setViewMode}
                        landingSettings={landingSettings}
                        selectedCamera={popup}
                        adsConfig={adsConfig}
                        onMapCameraOpen={handleMapPopupOpen}
                        favorites={favorites}
                        onToggleFavorite={toggleFavorite}
                        isFavorite={isFavorite}
                        disableHeavyEffects={disableHeavyEffects}
                    />

                    {/* Below the fold: hold the third-party ad script until the slot is within
                        300px of the viewport, so it never competes with the camera grid for
                        bandwidth or main thread during the initial load. */}
                    {showAfterCamerasNative && (
                        <DeferUntilVisible minHeight={120}>
                            <InlineAdSlot
                                slotKey="after-cameras-native"
                                script={adsConfig.slots.afterCamerasNative.script}
                                className="mt-2"
                                minHeightClassName="min-h-[120px]"
                            />
                        </DeferUntilVisible>
                    )}

                    {/* Partner offer, above the house promo. No camera and no area in context,
                        so only target_mode='all' offers can ever appear here — see the note in
                        commercialSlotService; that is the home page's nature, not a miss. */}
                    {/* Promo sendiri ikut lewat arbiter dan tetap TIDAK digerbangi konfigurasi
                        iklan: ini iklan milik operator dan harus tetap tampil saat jaringan
                        pihak ketiga dimatikan. */}
                    {/*
                      * DIAM saat tampilan putar-ulang aktif. Mode itu memasang <Playback> DI DALAM
                      * beranda, dan Playback membawa slotnya sendiri yang punya cameraId — jadi
                      * tanpa penjaga ini satu gulungan memuat DUA blok komersial sekaligus, persis
                      * tumpukan yang arbiter ini dibuat untuk menghapus.
                      *
                      * Yang mengalah slot beranda, mengikuti aturan spesifisitas arbiter sendiri:
                      * kamera mengalahkan area mengalahkan semua. Ditemukan oleh penjaga e2e
                      * "paling banyak satu blok per halaman", bukan oleh mata.
                      */}
                    {viewMode !== 'playback' && (
                        <CommercialSlot placement="landing" className="mx-auto mt-6 w-full max-w-2xl px-4" />
                    )}

                    {saweriaEnabled && saweriaLeaderboardLink && (
                        <Suspense fallback={<DeferredSurfaceFallback className="mx-auto mt-6 min-h-[140px] max-w-7xl" />}>
                            <SaweriaLeaderboard leaderboardLink={saweriaLeaderboardLink} />
                        </Suspense>
                    )}

                    <div className="flex-1" />

                    {showFooterBanner && (
                        <DeferUntilVisible minHeight={120}>
                            <InlineAdSlot
                                slotKey="footer-banner"
                                script={adsConfig.slots.footerBanner.script}
                                className="mt-6"
                                minHeightClassName="min-h-[120px]"
                            />
                        </DeferUntilVisible>
                    )}
                </main>

                <LandingFooter
                    saweriaEnabled={saweriaEnabled}
                    saweriaLink={saweriaLink}
                    branding={branding}
                />

                {!showMulti && (
                    <MultiViewButton
                        count={multiCameras.length}
                        onClick={() => setShowMulti(true)}
                        maxReached={maxReached}
                        maxStreams={maxStreams}
                    />
                )}
                {!popup && !showMulti && (
                    <LandingMobileDock
                        viewMode={viewMode}
                        onViewModeChange={handleMobileViewModeChange}
                        onHomeClick={handleMobileHomeClick}
                        onQuickAccessClick={handleMobileQuickAccessClick}
                        quickAccessCount={quickAccessCount}
                        favoriteCount={favoriteCount}
                    />
                )}

                {popup && (
                    <Suspense fallback={null}>
                        <VideoPopup
                            camera={popup}
                            onClose={handlePopupClose}
                            adsConfig={adsConfig}
                            modalTestId={activePopupSource === 'map' ? 'map-popup-modal' : 'grid-popup-modal'}
                            bodyTestId={activePopupSource === 'map' ? 'map-video-body' : 'grid-video-body'}
                            relatedCameras={relatedPopupCameras}
                            onRelatedCameraClick={(camera) => handleGridPopupOpen(camera, { replaceHistory: true })}
                            isFavorite={isFavorite}
                            onToggleFavorite={toggleFavorite}
                        />
                    </Suspense>
                )}
                {showMulti && multiCameras.length > 0 && (
                    <Suspense fallback={null}>
                        <MultiViewLayout
                            cameras={multiCameras}
                            onRemove={handleRemoveMulti}
                            onClose={() => setShowMulti(false)}
                        />
                    </Suspense>
                )}

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
        </div>
    );
}

function LandingPageShell() {
    const [refreshPaused, setRefreshPaused] = useState(false);

    return (
        <CameraProvider autoRefresh={!refreshPaused}>
            <LandingPageContent onRefreshPauseChange={setRefreshPaused} />
        </CameraProvider>
    );
}

export default function LandingPage() {
    return (
        <ToastProvider>
            <LandingPageShell />
        </ToastProvider>
    );
}

