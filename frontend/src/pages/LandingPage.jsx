import { useEffect, useState, useCallback, useRef, memo, lazy, Suspense, startTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPublicSaweriaConfig } from '../services/saweriaService';
import { useBranding } from '../contexts/BrandingContext';
import { updateMetaTags } from '../utils/metaUpdater';
import { testMediaMTXConnection } from '../utils/connectionTester';
import { getApiUrl } from '../config/config.js';
import { useCameras, CameraProvider } from '../contexts/CameraContext';
import { ToastProvider, useToast } from '../contexts/ToastContext';
import { useCameraStatusTracker } from '../hooks/useCameraStatusTracker';
import { useCameraHistory } from '../hooks/useCameraHistory';
import { Icons } from '../components/ui/Icons';

import LandingNavbar from '../components/landing/LandingNavbar';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHero from '../components/landing/LandingHero';
import LandingCamerasSection from '../components/landing/LandingCamerasSection';
import LandingStatsBar from '../components/landing/LandingStatsBar';

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
    const [searchParams, setSearchParams] = useSearchParams();
    const [layoutMode, setLayoutMode] = useState(() => {
        const queryMode = searchParams.get('mode');
        if (queryMode === 'simple' || queryMode === 'full') return queryMode;
        try {
            const savedMode = localStorage.getItem('landing_layout_mode');
            if (savedMode === 'simple' || savedMode === 'full') return savedMode;
        } catch (err) {
            console.warn('Failed to read localStorage:', err);
        }
        return 'full';
    });
    const isInitialMount = useRef(true);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            const queryMode = searchParams.get('mode');
            if (!queryMode) {
                setSearchParams({ mode: layoutMode }, { replace: true });
            }
        }
    }, []);

    useEffect(() => {
        if (isInitialMount.current) return;
        const queryMode = searchParams.get('mode');
        if ((queryMode === 'simple' || queryMode === 'full') && queryMode !== layoutMode) {
            setLayoutMode(queryMode);
            try {
                localStorage.setItem('landing_layout_mode', queryMode);
            } catch (err) {
                console.warn('Failed to save to localStorage:', err);
            }
        }
    }, [searchParams]);

    const toggleLayoutMode = useCallback(() => {
        const newMode = layoutMode === 'full' ? 'simple' : 'full';
        
        // Use startTransition to avoid Suspense hydration errors
        startTransition(() => {
            setLayoutMode(newMode);
            setSearchParams({ mode: newMode }, { replace: true });
        });
        
        try {
            localStorage.setItem('landing_layout_mode', newMode);
        } catch (err) {
            console.warn('Failed to save to localStorage:', err);
        }
    }, [layoutMode, setSearchParams]);

    const [popup, setPopup] = useState(null);
    const [multiCameras, setMultiCameras] = useState([]);
    const [viewMode, setViewMode] = useState('map');
    const [showMulti, setShowMulti] = useState(false);
    const { addToast } = useToast();
    const [maxReached, setMaxReached] = useState(false);

    const [saweriaLink, setSaweriaLink] = useState('https://saweria.co/raflialdi');
    const [saweriaLeaderboardLink, setSaweriaLeaderboardLink] = useState('');
    const [saweriaEnabled, setSaweriaEnabled] = useState(true);

    const [landingSettings, setLandingSettings] = useState({
        area_coverage: 'Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>',
        hero_badge: 'LIVE STREAMING 24 JAM',
        section_title: 'CCTV Publik'
    });

    const maxStreams = deviceTier === 'low' ? 2 : deviceTier === 'mid' ? 4 : 6;

    const [serverStatus, setServerStatus] = useState('checking');
    const [serverLatency, setServerLatency] = useState(-1);

    useEffect(() => {
        let isMounted = true;

        const checkServerConnectivity = async () => {
            try {
                let apiUrl;
                const hostname = window.location.hostname;
                const protocol = window.location.protocol;

                if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
                    apiUrl = '/api/health';
                } else if (protocol === 'https:') {
                    const frontendDomain = import.meta.env.VITE_FRONTEND_DOMAIN || hostname;
                    if (hostname === frontendDomain) {
                        const baseUrl = getApiUrl();
                        apiUrl = `${baseUrl.replace(/\/$/, '')}/health`;
                    } else {
                        apiUrl = `${protocol}//${hostname.replace('cctv.', 'api-cctv.')}/health`;
                    }
                } else {
                    const baseUrl = getApiUrl();
                    apiUrl = `${baseUrl.replace(/\/$/, '')}/health`;
                }

                const result = await testMediaMTXConnection(apiUrl);

                if (isMounted) {
                    if (result.reachable) {
                        setServerStatus('online');
                        setServerLatency(result.latency);
                    } else {
                        setServerStatus('offline');
                    }
                }
            } catch (err) {
                if (isMounted) {
                    setServerStatus('offline');
                }
            }
        };

        checkServerConnectivity();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [saweriaRes, landingRes] = await Promise.all([
                    getPublicSaweriaConfig().catch((err) => {
                        console.warn('Saweria config fetch failed, using defaults:', err);
                        return { success: true, data: { enabled: true, saweria_link: 'https://saweria.co/raflialdi' } };
                    }),
                    fetch(`${getApiUrl()}/api/settings/landing-page`)
                        .then(res => res.json())
                        .catch(() => ({ success: false }))
                ]);

                if (saweriaRes && saweriaRes.data) {
                    setSaweriaEnabled(saweriaRes.data.enabled !== false);
                    if (saweriaRes.data.saweria_link) {
                        setSaweriaLink(saweriaRes.data.saweria_link);
                    }
                    if (saweriaRes.data.leaderboard_link) {
                        setSaweriaLeaderboardLink(saweriaRes.data.leaderboard_link);
                    }
                }

                if (landingRes && landingRes.success && landingRes.data) {
                    setLandingSettings(landingRes.data);
                }
            } catch (err) {
                console.error('Failed to fetch data:', err);
            }
        };
        fetchData();
    }, []);

    useEffect(() => {
        if (branding) {
            updateMetaTags(branding);
        }
    }, [branding]);

    const handleAddMulti = useCallback((camera) => {
        setMultiCameras(prev => {
            const exists = prev.some(c => c.id === camera.id);

            if (exists) {
                addToast(`"${camera.name}" removed from Multi-View`, 'info');
                setMaxReached(false);
                return prev.filter(c => c.id !== camera.id);
            }

            if (prev.length >= maxStreams) {
                addToast(`Maximum ${maxStreams} cameras allowed in Multi-View mode (${deviceTier}-end device)`, 'warning');
                setMaxReached(true);
                setTimeout(() => setMaxReached(false), 3000);
                return prev;
            }

            addToast(`"${camera.name}" added to Multi-View (${prev.length + 1}/${maxStreams})`, 'success');
            return [...prev, camera];
        });
    }, [addToast, maxStreams, deviceTier]);

    const handleRemoveMulti = useCallback((id) => {
        setMultiCameras(prev => {
            const camera = prev.find(c => c.id === id);
            if (camera) {
                addToast(`"${camera.name}" removed from Multi-View`, 'info');
            }
            const next = prev.filter(c => c.id !== id);
            if (next.length === 0) setShowMulti(false);
            setMaxReached(false);
            return next;
        });
    }, [addToast]);

    useCameraStatusTracker(cameras, addToast);
    const { favorites, recentCameras, toggleFavorite, isFavorite, addRecentCamera } = useCameraHistory();

    const disableHeavyEffects = deviceTier === 'low';

    // Handle camera URL param - auto open popup when camera param exists (only in map/grid mode)
    useEffect(() => {
        if (viewMode === 'playback') return; // Don't open popup in playback mode
        
        const cameraIdFromUrl = searchParams.get('camera');
        if (cameraIdFromUrl && cameras.length > 0) {
            const camera = cameras.find(c => c.id === parseInt(cameraIdFromUrl));
            if (camera) {
                // Check if camera is available (not offline/maintenance)
                const isAvailable = camera.status !== 'maintenance' && camera.is_online !== 0;
                if (isAvailable) {
                    setPopup(camera);
                }
            }
        }
    }, [cameras, searchParams, viewMode]);

    // Handle camera selection and update URL
    const handleCameraClick = useCallback((camera) => {
        setPopup(camera);
        addRecentCamera(camera);
        // Update URL for shareable links
        const currentMode = searchParams.get('mode') || layoutMode;
        setSearchParams({ camera: camera.id.toString(), mode: currentMode }, { replace: false });
    }, [searchParams, layoutMode, setSearchParams, addRecentCamera]);

    // Handle popup close - reset URL to remove camera param
    const handlePopupClose = useCallback(() => {
        setPopup(null);
        // Reset URL by removing camera param but keep mode
        const currentMode = searchParams.get('mode') || layoutMode;
        setSearchParams({ mode: currentMode }, { replace: false });
    }, [searchParams, layoutMode, setSearchParams]);

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

                <Hero 
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

                <Suspense fallback={null}>
                    <FeedbackWidget />
                </Suspense>
                <Suspense fallback={null}>
                    <SaweriaSupport />
                </Suspense>
            </div>
        </div>
    );
}

const Hero = memo(function Hero({ branding, landingSettings, disableHeavyEffects, onCameraClick }) {
    return (
        <>
            <header className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-transparent to-purple-500/10 dark:from-primary/5 dark:to-purple-500/5">
                {!disableHeavyEffects && (
                    <>
                        <div className="absolute top-0 left-1/4 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none"></div>
                        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
                    </>
                )}

                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 text-center">
                    {branding.show_powered_by === 'true' && (
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-100 dark:bg-primary/20 text-primary-600 dark:text-primary-400 text-xs font-semibold mb-3 shadow-sm">
                            <div className="w-5 h-5 rounded bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white text-[10px] font-bold">{branding.logo_text}</div>
                            <span>Powered by {branding.company_name}</span>
                        </div>
                    )}

                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold mb-4 shadow-sm">
                        <span className="relative flex h-2 w-2">
                            {!disableHeavyEffects && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        {landingSettings.hero_badge}
                    </div>
                    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-4">
                        {branding.hero_title}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-3 text-sm sm:text-base">
                        {branding.hero_subtitle}
                    </p>
                    <p className="text-gray-500 dark:text-gray-500 max-w-xl mx-auto mb-6 text-xs">
                        {branding.footer_text}
                    </p>

                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 mb-6">
                        <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                            <circle cx="12" cy="11" r="3" />
                        </svg>
                        <span
                            className="text-sm text-amber-700 dark:text-amber-400"
                            dangerouslySetInnerHTML={{ __html: landingSettings.area_coverage }}
                        />
                    </div>

                    <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-primary/20 flex items-center justify-center text-primary-600 dark:text-primary-400">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">HD Streaming</span>
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Multi-View</span>
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Aman</span>
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">24/7 Live</span>
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Playback</span>
                        </div>
                    </div>

                    <LandingStatsBar onCameraClick={onCameraClick} />
                </div>
            </header>
        </>
    );
});

export default function LandingPage() {
    return (
        <ToastProvider>
            <CameraProvider>
                <LandingPageContent />
            </CameraProvider>
        </ToastProvider>
    );
}
