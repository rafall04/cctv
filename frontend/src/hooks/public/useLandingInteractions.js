/*
Purpose: Own public landing click, popup, URL, and multi-view selection interactions.
Caller: LandingPage content shell.
Deps: React hooks, slug helpers, camera delivery/availability helpers, deviceDetector stream limits.
MainFuncs: useLandingInteractions.
SideEffects: Updates URL search params, emits toasts, stores popup/multi-view UI state.
*/

import { useCallback, useEffect, useState } from 'react';
import { createCameraSlug, parseCameraIdFromSlug } from '../../utils/slugify';
import { isMultiViewSupported } from '../../utils/cameraDelivery.js';
import { isCameraPlayable } from '../../utils/cameraAvailability.js';
import { getMaxConcurrentStreams } from '../../utils/deviceDetector.js';

export function useLandingInteractions({
    cameras,
    layoutMode,
    viewMode,
    deviceTier,
    searchParams,
    setSearchParams,
    addToast,
    addRecentCamera,
}) {
    const [popup, setPopup] = useState(null);
    const [multiCameras, setMultiCameras] = useState([]);
    const [showMulti, setShowMulti] = useState(false);
    const [maxReached, setMaxReached] = useState(false);

    const maxStreams = getMaxConcurrentStreams(deviceTier);

    useEffect(() => {
        if (viewMode === 'playback') {
            return;
        }

        const cameraIdFromUrl = searchParams.get('camera');
        if (cameraIdFromUrl && cameras.length > 0) {
            const camera = cameras.find((item) => item.id === parseCameraIdFromSlug(cameraIdFromUrl));
            if (camera) {
                const isAvailable = isCameraPlayable(camera);
                if (isAvailable) {
                    setPopup(camera);
                }
            }
        }
    }, [cameras, searchParams, viewMode]);

    const handleAddMulti = useCallback((camera) => {
        if (!isMultiViewSupported(camera)) {
            addToast(`"${camera.name}" tidak mendukung Multi-View untuk format stream ini`, 'warning');
            return;
        }

        setMultiCameras((previous) => {
            const exists = previous.some((item) => item.id === camera.id);
            if (exists) {
                addToast(`"${camera.name}" removed from Multi-View`, 'info');
                setMaxReached(false);
                return previous.filter((item) => item.id !== camera.id);
            }

            if (previous.length >= maxStreams) {
                addToast(`Maximum ${maxStreams} cameras allowed in Multi-View mode (${deviceTier}-end device)`, 'warning');
                setMaxReached(true);
                setTimeout(() => setMaxReached(false), 3000);
                return previous;
            }

            addToast(`"${camera.name}" added to Multi-View (${previous.length + 1}/${maxStreams})`, 'success');
            return [...previous, camera];
        });
    }, [addToast, deviceTier, maxStreams]);

    const handleRemoveMulti = useCallback((id) => {
        setMultiCameras((previous) => {
            const target = previous.find((camera) => camera.id === id);
            if (target) {
                addToast(`"${target.name}" removed from Multi-View`, 'info');
            }
            const next = previous.filter((camera) => camera.id !== id);
            if (next.length === 0) {
                setShowMulti(false);
            }
            setMaxReached(false);
            return next;
        });
    }, [addToast]);

    const handleCameraClick = useCallback((camera) => {
        setPopup(camera);
        addRecentCamera(camera);
        setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set('camera', createCameraSlug(camera));
            if (!next.has('mode') || !['full', 'simple'].includes(next.get('mode'))) {
                next.set('mode', layoutMode);
            }
            if (!next.has('view')) {
                next.set('view', viewMode);
            }
            return next;
        }, { replace: false });
    }, [addRecentCamera, layoutMode, setSearchParams, viewMode]);

    const handlePopupClose = useCallback(() => {
        setPopup(null);
        setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.delete('camera');
            if (!next.has('mode')) {
                next.set('mode', layoutMode);
            }
            return next;
        }, { replace: false });
    }, [layoutMode, setSearchParams]);

    return {
        popup,
        multiCameras,
        showMulti,
        maxReached,
        maxStreams,
        setPopup,
        setShowMulti,
        handleAddMulti,
        handleRemoveMulti,
        handleCameraClick,
        handlePopupClose,
    };
}

export default useLandingInteractions;
