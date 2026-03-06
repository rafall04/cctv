import { lazy, Suspense, useEffect } from 'react';
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
import LandingPageSimple from '../components/LandingPageSimple';
import MultiViewButton from '../components/MultiView/MultiViewButton';
import MultiViewLayout from '../components/MultiView/MultiViewLayout';
import VideoPopup from '../components/MultiView/VideoPopup';
import SaweriaLeaderboard from '../components/SaweriaLeaderboard';

const FeedbackWidget = lazy(() => import('../components/FeedbackWidget'));
const SaweriaSupport = lazy(() => import('../components/SaweriaSupport'));

function LandingPageContent() {
    const { branding } = useBranding();
    const { cameras, deviceTier } = useCameras();
    const { addToast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const { favorites, toggleFavorite, isFavorite, addRecentCamera } = useCameraHistory();

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
    const shouldHideFloatingWidgets = showMulti && viewMode === 'grid';

    useEffect(() => {
        if (branding) {
            updateMetaTags(branding);
        }
    }, [branding]);

    if (layoutMode === 'simple') {
        return (
            <div key="simple-mode">
                <LandingPageSimple
                    onCameraClick={handleCameraClick}
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
                    hideFloatingWidgets={shouldHideFloatingWidgets}
                />

                <MultiViewButton
                    count={multiCameras.length}
                    onClick={() => setShowMulti(true)}
                    maxReached={maxReached}
                    maxStreams={maxStreams}
                />

                {popup && <VideoPopup camera={popup} onClose={handlePopupClose} />}
                {showMulti && multiCameras.length > 0 && (
                    <MultiViewLayout
                        cameras={multiCameras}
                        onRemove={handleRemoveMulti}
                        onClose={() => setShowMulti(false)}
                    />
                )}
            </div>
        );
    }

    return (
        <div key="full-mode">
            <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
                <LandingNavbar branding={branding} layoutMode={layoutMode} onLayoutToggle={toggleLayoutMode} />

                <LandingHero
                    branding={branding}
                    landingSettings={landingSettings}
                    disableHeavyEffects={disableHeavyEffects}
                    onCameraClick={setPopup}
                />

                <LandingCamerasSection
                    onCameraClick={handleCameraClick}
                    onAddMulti={handleAddMulti}
                    multiCameras={multiCameras}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    landingSettings={landingSettings}
                    selectedCamera={popup}
                    favorites={favorites}
                    onToggleFavorite={toggleFavorite}
                    isFavorite={isFavorite}
                />

                {saweriaEnabled && saweriaLeaderboardLink && (
                    <SaweriaLeaderboard leaderboardLink={saweriaLeaderboardLink} />
                )}

                <div className="flex-1" />
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

                {popup && <VideoPopup camera={popup} onClose={handlePopupClose} />}
                {showMulti && multiCameras.length > 0 && (
                    <MultiViewLayout
                        cameras={multiCameras}
                        onRemove={handleRemoveMulti}
                        onClose={() => setShowMulti(false)}
                    />
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
