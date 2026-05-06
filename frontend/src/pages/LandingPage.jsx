/*
 * Purpose: Compose the public CCTV landing experience across full/simple modes, compact discovery, mobile quick access, standardized popup streams, map/grid views, and popups.
 * Caller: App public root route.
 * Deps: React, Router search params, branding/camera/toast contexts, landing hooks, landing components, publicGrowthService.
 * MainFuncs: LandingPage, LandingPageContent, DeferredSurfaceFallback.
 * SideEffects: Fetches public config/discovery data, updates metadata, opens video popups, manages multiview state.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBranding } from '../contexts/BrandingContext';
import { updateMetaTags } from '../utils/metaUpdater';
import { useCameras, CameraProvider } from '../contexts/CameraContext';
import { ToastProvider, useToast } from '../contexts/ToastContext';
import { useCameraStatusTracker } from '../hooks/useCameraStatusTracker';
import { useCameraHistory } from '../hooks/useCameraHistory';
import { useLandingModeState } from '../hooks/public/useLandingModeState';
import { useLandingReachability } from '../hooks/public/useLandingReachability';
import { useLandingPublicConfig } from '../hooks/public/useLandingPublicConfig';
import { useLandingInteractions } from '../hooks/public/useLandingInteractions';
import LandingNavbar from '../components/landing/LandingNavbar';
import LandingHero from '../components/landing/LandingHero';
import LandingFooter from '../components/landing/LandingFooter';
import LandingCamerasSection from '../components/landing/LandingCamerasSection';
import LandingPublicTopStack from '../components/landing/LandingPublicTopStack';
import LandingDiscoveryStrip from '../components/landing/LandingDiscoveryStrip';
import LandingQuickAccessStrip from '../components/landing/LandingQuickAccessStrip';
import LandingMobileDock from '../components/landing/LandingMobileDock';
import LandingSmartFeed from '../components/landing/LandingSmartFeed';
import MultiViewButton from '../components/MultiView/MultiViewButton';
import InlineAdSlot from '../components/ads/InlineAdSlot';
import GlobalAdScript from '../components/ads/GlobalAdScript';
import { isAdsMobileViewport, shouldRenderAdSlot } from '../components/ads/adsConfig';
import { resolvePublicPopupCamera } from '../services/publicCameraResolver';
import publicGrowthService from '../services/publicGrowthService';
import lazyWithRetry from '../utils/lazyWithRetry';

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

function LandingPageContent() {
    const { branding, loading: brandingLoading } = useBranding();
    const { cameras, deviceTier } = useCameras();
    const { addToast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [activePopupSource, setActivePopupSource] = useState('grid');
    const [publicDiscovery, setPublicDiscovery] = useState(null);
    const [discoveryLoading, setDiscoveryLoading] = useState(true);
    const { favorites, recentCameras, toggleFavorite, isFavorite, addRecentCamera } = useCameraHistory();

    const {
        layoutMode,
        viewMode,
        setViewMode,
        toggleLayoutMode,
    } = useLandingModeState(searchParams, setSearchParams);

    useLandingReachability();

    const {
        saweriaEnabled,
        saweriaLink,
        saweriaLeaderboardLink,
        landingSettings,
        adsConfig,
        publicConfigLoading,
    } = useLandingPublicConfig();

    const {
        popup,
        multiCameras,
        showMulti,
        maxReached,
        maxStreams,
        setShowMulti,
        setPopup,
        handleAddMulti,
        handleRemoveMulti,
        handleCameraClick,
        handlePopupClose,
    } = useLandingInteractions({
        cameras,
        layoutMode,
        viewMode,
        deviceTier,
        searchParams,
        setSearchParams,
        addToast,
        addRecentCamera,
    });

    useCameraStatusTracker(cameras, addToast);

    const disableHeavyEffects = deviceTier === 'low';
    const isMobileAdsViewport = isAdsMobileViewport();
    const isPublicModalActive = Boolean(popup);
    const shouldHideFixedUiForPopup = isPublicModalActive && adsConfig?.popup?.hideFloatingWidgetsOnPopup !== false;
    const shouldHideFloatingWidgets = (showMulti && viewMode === 'grid') || shouldHideFixedUiForPopup;
    const shouldSuspendSocialBar = isPublicModalActive && adsConfig?.popup?.hideSocialBarOnPopup !== false;
    const showSocialBar = !shouldSuspendSocialBar && shouldRenderAdSlot(adsConfig, 'socialBar', isMobileAdsViewport);
    const showFooterBanner = shouldRenderAdSlot(adsConfig, 'footerBanner', isMobileAdsViewport);
    const showAfterCamerasNative = shouldRenderAdSlot(adsConfig, 'afterCamerasNative', isMobileAdsViewport);
    const favoriteCameras = useMemo(() => (
        cameras.filter((camera) => favorites.includes(camera.id)).slice(0, 5)
    ), [cameras, favorites]);
    const recentCameraItems = useMemo(() => (
        recentCameras
            .map((recentCamera) => cameras.find((camera) => camera.id === recentCamera.id) || recentCamera)
            .slice(0, 5)
    ), [cameras, recentCameras]);
    const quickAccessCount = favoriteCameras.length + recentCameraItems.length;
    const favoriteCount = favoriteCameras.length;

    useEffect(() => {
        if (branding) {
            updateMetaTags(branding);
        }
    }, [branding]);

    useEffect(() => {
        let mounted = true;

        publicGrowthService.getDiscovery({ limit: 6 })
            .then((response) => {
                if (mounted) {
                    setPublicDiscovery(response.data || null);
                }
            })
            .catch(() => {
                if (mounted) {
                    setPublicDiscovery(null);
                }
            })
            .finally(() => {
                if (mounted) {
                    setDiscoveryLoading(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!popup && activePopupSource !== 'grid') {
            setActivePopupSource('grid');
        }
    }, [activePopupSource, popup]);

    const handleGridPopupOpen = useCallback(async (camera) => {
        setActivePopupSource('grid');
        const resolvedCamera = await resolvePublicPopupCamera(camera, cameras);
        handleCameraClick(resolvedCamera || camera);
    }, [cameras, handleCameraClick]);

    const handleMapPopupOpen = useCallback((camera) => {
        setActivePopupSource('map');
        handleCameraClick(camera);
    }, [handleCameraClick]);

    const handleUnifiedPopupClose = useCallback(() => {
        handlePopupClose();
        setActivePopupSource('grid');
    }, [handlePopupClose]);

    const scrollToElement = useCallback((elementId) => {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    const handleMobileHomeClick = useCallback(() => {
        if (typeof window.scrollTo === 'function') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, []);

    const handleMobileQuickAccessClick = useCallback(() => {
        scrollToElement('public-quick-access');
    }, [scrollToElement]);

    if (layoutMode === 'simple') {
        return (
            <div key="simple-mode">
                {showSocialBar && <GlobalAdScript slotKey="social-bar" script={adsConfig.slots.socialBar.script} />}
                <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-gray-950" />}>
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
                        hideFloatingWidgets={shouldHideFloatingWidgets}
                        announcement={landingSettings.announcement}
                        eventBanner={landingSettings.eventBanner}
                        publicConfigLoading={publicConfigLoading || brandingLoading}
                        publicDiscovery={publicDiscovery}
                        discoveryLoading={discoveryLoading}
                        recentCameras={recentCameraItems}
                        favoriteCameras={favoriteCameras}
                        onQuickCameraOpen={handleGridPopupOpen}
                        smartFeedCameras={cameras}
                    />
                </Suspense>

                <MultiViewButton
                    count={multiCameras.length}
                    onClick={() => setShowMulti(true)}
                    maxReached={maxReached}
                    maxStreams={maxStreams}
                />
                {!popup && (
                    <LandingMobileDock
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
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
                            onClose={handleUnifiedPopupClose}
                            adsConfig={adsConfig}
                            modalTestId={activePopupSource === 'map' ? 'map-popup-modal' : 'grid-popup-modal'}
                            bodyTestId={activePopupSource === 'map' ? 'map-video-body' : 'grid-video-body'}
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
            <div className="min-h-screen bg-gray-50 pb-24 dark:bg-gray-950 flex flex-col sm:pb-0">
                <LandingNavbar branding={branding} layoutMode={layoutMode} onLayoutToggle={toggleLayoutMode} />
                <LandingPublicTopStack
                    layoutMode="full"
                    loading={publicConfigLoading || brandingLoading}
                    eventBanner={landingSettings.eventBanner}
                    announcement={landingSettings.announcement}
                />

                <LandingHero
                    branding={branding}
                    landingSettings={landingSettings}
                    disableHeavyEffects={disableHeavyEffects}
                    onCameraClick={setPopup}
                />

                <LandingDiscoveryStrip
                    discovery={publicDiscovery}
                    loading={discoveryLoading}
                    onCameraClick={handleGridPopupOpen}
                />

                <LandingSmartFeed
                    cameras={cameras}
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
                />

                {showAfterCamerasNative && (
                    <InlineAdSlot
                        slotKey="after-cameras-native"
                        label="Sponsored"
                        script={adsConfig.slots.afterCamerasNative.script}
                        className="mt-2"
                        minHeightClassName="min-h-[120px]"
                    />
                )}

                {saweriaEnabled && saweriaLeaderboardLink && (
                    <Suspense fallback={<DeferredSurfaceFallback className="mx-auto mt-6 min-h-[140px] max-w-7xl" />}>
                        <SaweriaLeaderboard leaderboardLink={saweriaLeaderboardLink} />
                    </Suspense>
                )}

                <div className="flex-1" />

                {showFooterBanner && (
                    <InlineAdSlot
                        slotKey="footer-banner"
                        label="Sponsored"
                        script={adsConfig.slots.footerBanner.script}
                        className="mt-6"
                        minHeightClassName="min-h-[120px]"
                    />
                )}

                <LandingFooter
                    saweriaEnabled={saweriaEnabled}
                    saweriaLink={saweriaLink}
                    branding={branding}
                />

                <MultiViewButton
                    count={multiCameras.length}
                    onClick={() => setShowMulti(true)}
                    maxReached={maxReached}
                    maxStreams={maxStreams}
                />
                {!popup && (
                    <LandingMobileDock
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
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
                            onClose={handleUnifiedPopupClose}
                            adsConfig={adsConfig}
                            modalTestId={activePopupSource === 'map' ? 'map-popup-modal' : 'grid-popup-modal'}
                            bodyTestId={activePopupSource === 'map' ? 'map-video-body' : 'grid-video-body'}
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

                {!shouldHideFloatingWidgets && (
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

export default function LandingPage() {
    return (
        <ToastProvider>
            <CameraProvider>
                <LandingPageContent />
            </CameraProvider>
        </ToastProvider>
    );
}
