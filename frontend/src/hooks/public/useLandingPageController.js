/*
 * Purpose: Own public landing discovery loading, popup resolution, refresh pause signaling, mobile view helpers, and metadata updates.
 * Caller: LandingPage shell and simple/full public landing renderers.
 * Deps: React hooks, branding metadata, public discovery service, popup resolver, landing interactions, map preload utility.
 * MainFuncs: useLandingPageController.
 * SideEffects: Fetches public discovery data, updates meta tags, resolves public popup streams, preloads map view, and reports refresh pause state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { updateMetaTags } from '../../utils/metaUpdater';
import { resolvePublicPopupCamera } from '../../services/publicCameraResolver';
import publicGrowthService from '../../services/publicGrowthService';
import { preloadLandingMapView } from '../../utils/preloadLandingMapView';
import useLandingInteractions from './useLandingInteractions';
import { useLandingReachability } from './useLandingReachability';

export function useLandingPageController({
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
}) {
    const [publicDiscovery, setPublicDiscovery] = useState(null);
    const [discoveryLoading, setDiscoveryLoading] = useState(true);
    const [activePopupSource, setActivePopupSource] = useState('grid');
    const streamResolveRequestRef = useRef(0);

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
        resolveUrlCamera: (camera) => resolvePublicPopupCamera(camera, cameras),
    });

    useLandingReachability();

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

    useEffect(() => {
        onRefreshPauseChange?.(Boolean(popup || showMulti));
    }, [onRefreshPauseChange, popup, showMulti]);

    const openResolvedPopup = useCallback(async (camera, options = {}, source = 'grid') => {
        const { replaceHistory = false } = options;
        const requestId = streamResolveRequestRef.current + 1;
        streamResolveRequestRef.current = requestId;
        const pendingCamera = {
            ...camera,
            _stream_resolution_pending: true,
        };

        setActivePopupSource(source);
        handleCameraClick(pendingCamera, { replaceHistory });

        try {
            const resolvedCamera = await resolvePublicPopupCamera(camera, cameras);
            if (streamResolveRequestRef.current !== requestId) {
                return;
            }

            const nextCamera = {
                ...(resolvedCamera || camera),
                _stream_resolution_pending: false,
            };
            handleCameraClick(nextCamera, { replaceHistory: true });
        } catch {
            if (streamResolveRequestRef.current === requestId) {
                handleCameraClick({
                    ...camera,
                    _stream_resolution_pending: false,
                }, { replaceHistory: true });
            }
        }
    }, [cameras, handleCameraClick]);

    const handleGridPopupOpen = useCallback((camera, options = {}) => {
        return openResolvedPopup(camera, options, 'grid');
    }, [openResolvedPopup]);

    const handleMapPopupOpen = useCallback((camera, options = {}) => {
        return openResolvedPopup(camera, options, 'map');
    }, [openResolvedPopup]);

    const handleUnifiedPopupClose = useCallback(() => {
        streamResolveRequestRef.current += 1;
        handlePopupClose();
        setActivePopupSource('grid');
    }, [handlePopupClose]);

    const scrollToElement = useCallback((elementId, offset = 72) => {
        const element = document.getElementById(elementId);
        if (element) {
            const top = element.getBoundingClientRect().top + window.scrollY - offset;
            window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
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

    const handleMobileViewModeChange = useCallback((nextMode) => {
        if (nextMode === 'map') {
            preloadLandingMapView();
        }

        setViewMode(nextMode);

        const scheduleScroll = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
        scheduleScroll(() => {
            scrollToElement('camera-workspace');
        });
    }, [scrollToElement, setViewMode]);

    const shouldPauseRefresh = useMemo(() => Boolean(popup || showMulti), [popup, showMulti]);

    return {
        publicDiscovery,
        discoveryLoading,
        popup,
        multiCameras,
        showMulti,
        maxReached,
        maxStreams,
        activePopupSource,
        setShowMulti,
        setPopup,
        handleAddMulti,
        handleRemoveMulti,
        handleGridPopupOpen,
        handleMapPopupOpen,
        handlePopupClose: handleUnifiedPopupClose,
        handleMobileHomeClick,
        handleMobileQuickAccessClick,
        handleMobileViewModeChange,
        shouldPauseRefresh,
    };
}

export default useLandingPageController;
