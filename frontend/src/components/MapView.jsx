import { useEffect, useRef, useState, memo, useCallback, useMemo, useLayoutEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, ZoomControl, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/leaflet-overrides.css';
import { detectDeviceTier } from '../utils/deviceDetector';
import { settingsService } from '../services/settingsService';
import { getHLSConfig } from '../utils/hlsConfig';
import { viewerService } from '../services/viewerService';
import { createTransformThrottle } from '../utils/rafThrottle';
import { getTimeoutDuration } from '../hooks/useStreamTimeout';
import { preloadHls } from '../utils/preloadManager';
import CodecBadge from './CodecBadge';
import VideoPopup from './MultiView/VideoPopup.jsx';
import { useBranding } from '../contexts/BrandingContext';
import { takeSnapshot as takeSnapshotUtil } from '../utils/snapshotHelper';
import PublicStreamStatusOverlay from './PublicStreamStatusOverlay.jsx';
import {
    getPublicPopupBodyStyle,
    getPublicPopupModalStyle,
    getVideoAspectRatio,
} from '../utils/publicPopupLayout.js';
import {
    getPublicPopupErrorType,
    getPublicPopupInitialStatus,
    getPublicPopupOverlayState,
    getPublicPopupStatusDisplay,
    isPublicPopupPlaybackLocked,
    shouldShowPublicPopupRetry,
} from '../utils/publicPopupState.js';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Deteksi device tier sekali saja (module level untuk performa)
const deviceTier = detectDeviceTier();
const isLowEnd = deviceTier === 'low';

// Loading stages untuk progressive feedback
const LoadingStage = {
    CONNECTING: 'connecting',
    LOADING: 'loading',
    BUFFERING: 'buffering',
    PLAYING: 'playing',
    ERROR: 'error',
    TIMEOUT: 'timeout',
};

// Cache icon untuk menghindari pembuatan ulang
const iconCache = new Map();

// CCTV Marker - dengan support status (active, maintenance, tunnel, offline)
const createCameraIcon = (status = 'active', isTunnel = false, isOnline = true) => {
    // Status priority: maintenance > offline > tunnel > stable
    let cacheKey;
    if (status === 'maintenance') {
        cacheKey = 'maintenance';
    } else if (!isOnline) {
        cacheKey = 'offline';
    } else if (isTunnel) {
        cacheKey = 'tunnel';
    } else {
        cacheKey = 'stable';
    }

    if (iconCache.has(cacheKey)) {
        return iconCache.get(cacheKey);
    }

    let color, darkColor;
    if (status === 'maintenance') {
        color = '#ef4444'; // merah
        darkColor = '#dc2626';
    } else if (!isOnline) {
        color = '#6b7280'; // abu-abu (offline)
        darkColor = '#4b5563';
    } else if (isTunnel) {
        color = '#f97316'; // orange
        darkColor = '#ea580c';
    } else {
        color = '#10b981'; // hijau
        darkColor = '#059669';
    }

    let iconSvg;
    if (status === 'maintenance') {
        // Wrench icon
        iconSvg = '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" stroke-width="2" stroke="white" fill="none"/>';
    } else if (!isOnline) {
        // X icon
        iconSvg = '<path d="M6 6l12 12M6 18L18 6" stroke="white" stroke-width="3" stroke-linecap="round" fill="none"/>';
    } else {
        // Simple CCTV icon
        iconSvg = '<path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.98z"/>';
    }

    const icon = L.divIcon({
        className: 'cctv-marker',
        html: `
            <div style="
                position: relative;
                width: 44px;
                height: 44px;
                cursor: pointer;
            ">
                <div style="
                    width: 44px;
                    height: 44px;
                    background: linear-gradient(135deg, ${color} 0%, ${darkColor} 100%);
                    border: 3px solid white;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style="transform: rotate(45deg);">
                        ${iconSvg}
                    </svg>
                </div>
            </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 44],
    });

    iconCache.set(cacheKey, icon);
    return icon;
};

const hasValidCoords = (c) => {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
};

// Fungsi untuk mendeteksi dan memberikan offset pada marker yang bertumpuk
const applyMarkerOffset = (cameras) => {
    const coordMap = new Map();
    const OFFSET = 0.0003; // ~30 meter offset

    return cameras.map(camera => {
        const lat = parseFloat(camera.latitude);
        const lng = parseFloat(camera.longitude);
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`; // Group by ~11m precision

        if (!coordMap.has(key)) {
            coordMap.set(key, []);
        }

        const group = coordMap.get(key);
        const index = group.length;
        group.push(camera.id);

        // Jika ada lebih dari 1 kamera di lokasi yang sama, beri offset melingkar
        if (index > 0) {
            const angle = (index * 60) * (Math.PI / 180); // 60 derajat per kamera
            const offsetLat = lat + (OFFSET * Math.cos(angle));
            const offsetLng = lng + (OFFSET * Math.sin(angle));
            return { ...camera, _displayLat: offsetLat, _displayLng: offsetLng, _isGrouped: true, _groupIndex: index };
        }

        return { ...camera, _displayLat: lat, _displayLng: lng, _isGrouped: false, _groupIndex: 0 };
    });
};

// Video Modal - OPTIMIZED untuk low-end device
// Menggunakan ref-based state untuk pan/zoom agar tidak trigger re-render
const VideoModal = memo(({ camera, onClose }) => {
    const videoRef = useRef(null);
    const videoWrapperRef = useRef(null);
    const modalRef = useRef(null);
    const outerWrapperRef = useRef(null);
    const headerRef = useRef(null);
    const footerRef = useRef(null);
    const hlsRef = useRef(null);
    const transformThrottleRef = useRef(null);
    const playbackCheckRef = useRef(null);
    const streamTimeoutRef = useRef(null);
    const { branding } = useBranding();
    const isMaintenance = camera.status === 'maintenance';
    const isOffline = camera.is_online === 0;
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
    const isNonPlayable = isMaintenance || isOffline;

    // Status: 'connecting' | 'loading' | 'buffering' | 'playing' | 'maintenance' | 'offline' | 'timeout' | 'error'
    const [status, setStatus] = useState(() => getPublicPopupInitialStatus(camera));
    const [loadingStage, setLoadingStage] = useState(
        isNonPlayable ? LoadingStage.ERROR : LoadingStage.CONNECTING
    );
    const [errorType, setErrorType] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const [retryKey, setRetryKey] = useState(0);
    const [videoAspectRatio, setVideoAspectRatio] = useState(null);
    const [layoutMetrics, setLayoutMetrics] = useState(() => ({
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
        headerHeight: 0,
        footerHeight: 0,
    }));

    // Zoom state - hanya untuk UI display
    const [zoomDisplay, setZoomDisplay] = useState(1);

    // Ref-based state untuk performa (tidak trigger re-render saat pan/zoom)
    const stateRef = useRef({
        zoom: 1, panX: 0, panY: 0,
        dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0
    });
    const statusBadge = getPublicPopupStatusDisplay({ status, loadingStage, errorType, isTunnel });
    const overlayState = getPublicPopupOverlayState({ status, loadingStage, errorType });
    const isPlaybackLocked = isPublicPopupPlaybackLocked(status);
    const canRetry = shouldShowPublicPopupRetry({ status, errorType });
    const bodyStyle = {
        touchAction: 'none',
        ...getPublicPopupBodyStyle({
            isFullscreen,
            isPlaybackLocked,
            videoAspectRatio,
        }),
    };
    const modalStyle = getPublicPopupModalStyle({
        isFullscreen,
        isPlaybackLocked,
        videoAspectRatio,
        viewportWidth: layoutMetrics.viewportWidth,
        viewportHeight: layoutMetrics.viewportHeight,
        headerHeight: layoutMetrics.headerHeight,
        footerHeight: layoutMetrics.footerHeight,
        maxDesktopWidth: 896,
    });
    const MIN_ZOOM = 1;
    const MAX_ZOOM = 4;
    const isVideoActive = status === 'playing';

    useLayoutEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const updateLayoutMetrics = () => {
            setLayoutMetrics({
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                headerHeight: headerRef.current?.offsetHeight || 0,
                footerHeight: footerRef.current?.offsetHeight || 0,
            });
        };

        updateLayoutMetrics();
        window.addEventListener('resize', updateLayoutMetrics);
        return () => window.removeEventListener('resize', updateLayoutMetrics);
    }, [isFullscreen, isPlaybackLocked, isVideoActive, status, loadingStage, errorType, videoAspectRatio]);

    const getMaxPan = (z) => z <= 1 ? 0 : ((z - 1) / (2 * z)) * 100;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const syncVideoAspectRatio = useCallback(() => {
        const nextAspectRatio = getVideoAspectRatio(videoRef.current);
        if (nextAspectRatio) {
            setVideoAspectRatio(nextAspectRatio);
        }
    }, []);
    const requestVideoPlay = useCallback((target = videoRef.current) => {
        if (!target?.play) return;
        try {
            const playAttempt = target.play();
            if (playAttempt?.catch) {
                playAttempt.catch(() => { });
            }
        } catch {
            // Ignore autoplay/runtime failures; status handling will surface real issues.
        }
    }, []);

    // Initialize RAF throttle on mount - skip on low-end
    useEffect(() => {
        if (videoWrapperRef.current && !isLowEnd) {
            transformThrottleRef.current = createTransformThrottle(videoWrapperRef.current);
        }
        return () => {
            transformThrottleRef.current?.cancel();
        };
    }, []);

    // Apply transform langsung ke DOM (bypass React re-render)
    const applyTransform = useCallback((animate = false) => {
        if (!videoWrapperRef.current) return;
        const { zoom, panX, panY } = stateRef.current;

        if (animate && !isLowEnd) {
            videoWrapperRef.current.style.transition = 'transform 0.2s ease-out';
            videoWrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
        } else {
            videoWrapperRef.current.style.transition = 'none';
            // On low-end, apply directly without RAF throttle
            if (transformThrottleRef.current && !isLowEnd) {
                transformThrottleRef.current.update(zoom, panX, panY);
            } else {
                videoWrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
            }
        }
        setZoomDisplay(zoom);
    }, []);

    // Reset zoom function - must be defined before toggleFullscreen
    const handleResetZoom = useCallback(() => {
        const s = stateRef.current;
        s.zoom = 1; s.panX = 0; s.panY = 0;
        applyTransform(true);
    }, [applyTransform]);

    // Fullscreen toggle with landscape orientation lock
    const toggleFullscreen = useCallback(async () => {
        try {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                // Enter fullscreen - use outer wrapper
                if (outerWrapperRef.current?.requestFullscreen) {
                    await outerWrapperRef.current.requestFullscreen();
                } else if (outerWrapperRef.current?.webkitRequestFullscreen) {
                    await outerWrapperRef.current.webkitRequestFullscreen();
                }

                // Reset zoom to 1.0 when entering fullscreen to avoid "auto zoom" effect
                handleResetZoom();

                // Lock to landscape orientation on mobile
                if (screen.orientation && screen.orientation.lock) {
                    try {
                        await screen.orientation.lock('landscape').catch(() => {
                            // Fallback: try landscape-primary if landscape fails
                            screen.orientation.lock('landscape-primary').catch(() => { });
                        });
                    } catch (err) {
                        console.log('Orientation lock not supported');
                    }
                }
            } else {
                // Exit fullscreen
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    await document.webkitExitFullscreen();
                }

                // Reset zoom when exiting fullscreen
                handleResetZoom();

                // Unlock orientation
                if (screen.orientation && screen.orientation.unlock) {
                    try {
                        screen.orientation.unlock();
                    } catch (err) {
                        // Ignore unlock errors
                    }
                }
            }
        } catch (err) {
            console.error('Fullscreen error:', err);
        }
    }, [handleResetZoom]);

    // Screenshot/snapshot with watermark
    const takeSnapshot = useCallback(async () => {
        if (!videoRef.current || status !== 'playing') return;

        const result = await takeSnapshotUtil(videoRef.current, {
            branding,
            cameraName: camera.name,
            watermarkEnabled: branding.watermark_enabled === 'true',
            watermarkText: branding.watermark_text,
            watermarkPosition: branding.watermark_position || 'bottom-right',
            watermarkOpacity: parseFloat(branding.watermark_opacity || 0.9)
        });

        setSnapshotNotification({
            type: result.success ? 'success' : 'error',
            message: result.message
        });

        setTimeout(() => setSnapshotNotification(null), 3000);
    }, [camera.name, status, branding]);

    const clearStreamTimeout = useCallback(() => {
        if (streamTimeoutRef.current) {
            clearTimeout(streamTimeoutRef.current);
            streamTimeoutRef.current = null;
        }
    }, []);

    const cleanupResources = useCallback(() => {
        clearStreamTimeout();
        if (playbackCheckRef.current) {
            clearInterval(playbackCheckRef.current);
            playbackCheckRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.removeAttribute('src');
            videoRef.current.load();
        }
    }, [clearStreamTimeout]);

    const startStreamTimeout = useCallback((nextStage = LoadingStage.CONNECTING) => {
        clearStreamTimeout();
        if (isNonPlayable) return;
        const duration = getTimeoutDuration(deviceTier);
        streamTimeoutRef.current = setTimeout(() => {
            cleanupResources();
            setStatus('timeout');
            setErrorType('timeout');
            setLoadingStage(LoadingStage.TIMEOUT);
        }, duration);
        setLoadingStage(nextStage);
    }, [cleanupResources, clearStreamTimeout, isNonPlayable]);

    const updateStreamStage = useCallback((nextStage) => {
        if (['playing', 'error', 'timeout'].includes(nextStage)) {
            clearStreamTimeout();
        } else {
            startStreamTimeout(nextStage);
        }
    }, [clearStreamTimeout, startStreamTimeout]);

    const handleRetry = useCallback(() => {
        cleanupResources();
        setStatus('connecting');
        setErrorType(null);
        setLoadingStage(LoadingStage.CONNECTING);
        setRetryKey((current) => current + 1);
    }, [cleanupResources]);

    // Track fullscreen state and unlock orientation on exit
    useEffect(() => {
        const handleFullscreenChange = () => {
            const isNowFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
            setIsFullscreen(isNowFullscreen);

            // Unlock orientation when exiting fullscreen (e.g., via ESC key)
            if (!isNowFullscreen && screen.orientation && screen.orientation.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (err) {
                    // Ignore unlock errors
                }
            }
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            // Cleanup: unlock orientation on unmount
            if (screen.orientation && screen.orientation.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (err) {
                    // Ignore unlock errors
                }
            }
        };
    }, []);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
            cleanupResources();
        };
    }, [cleanupResources]);

    useEffect(() => {
        const handleEsc = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    const handleZoomIn = useCallback(() => {
        const s = stateRef.current;
        s.zoom = Math.min(s.zoom + 0.5, MAX_ZOOM);
        const max = getMaxPan(s.zoom);
        s.panX = clamp(s.panX, -max, max);
        s.panY = clamp(s.panY, -max, max);
        applyTransform(true);
    }, [applyTransform]);

    const handleZoomOut = useCallback(() => {
        const s = stateRef.current;
        s.zoom = Math.max(s.zoom - 0.5, MIN_ZOOM);
        if (s.zoom <= 1) { s.panX = 0; s.panY = 0; }
        else {
            const max = getMaxPan(s.zoom);
            s.panX = clamp(s.panX, -max, max);
            s.panY = clamp(s.panY, -max, max);
        }
        applyTransform(true);
    }, [applyTransform]);

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const s = stateRef.current;
        s.zoom = clamp(s.zoom + (e.deltaY < 0 ? 0.5 : -0.5), MIN_ZOOM, MAX_ZOOM);
        if (s.zoom <= 1) { s.panX = 0; s.panY = 0; }
        else {
            const max = getMaxPan(s.zoom);
            s.panX = clamp(s.panX, -max, max);
            s.panY = clamp(s.panY, -max, max);
        }
        applyTransform(false);
    }, [applyTransform]);

    const handlePointerDown = useCallback((e) => {
        e.stopPropagation(); // Prevent background click
        const s = stateRef.current;
        if (s.zoom <= 1) return;
        s.dragging = true;
        s.startX = e.clientX; s.startY = e.clientY;
        s.startPanX = s.panX; s.startPanY = s.panY;
        if (videoWrapperRef.current) videoWrapperRef.current.style.cursor = 'grabbing';
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = useCallback((e) => {
        const s = stateRef.current;
        if (!s.dragging) return;

        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        const max = getMaxPan(s.zoom);

        // Direct 1:1 mapping with container size factor
        const factor = 0.15; // Adjust for natural feel
        s.panX = clamp(s.startPanX + dx * factor, -max, max);
        s.panY = clamp(s.startPanY + dy * factor, -max, max);

        // On low-end, apply directly without RAF throttle
        if (transformThrottleRef.current && !isLowEnd) {
            transformThrottleRef.current.update(s.zoom, s.panX, s.panY);
        } else {
            videoWrapperRef.current.style.transform = `scale(${s.zoom}) translate(${s.panX}%, ${s.panY}%)`;
        }
    }, []);

    const handlePointerUp = useCallback((e) => {
        e.stopPropagation(); // Prevent background click
        const s = stateRef.current;
        s.dragging = false;
        if (videoWrapperRef.current) videoWrapperRef.current.style.cursor = s.zoom > 1 ? 'grab' : 'default';
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch (error) {
            // Ignore pointer capture release errors from already-released pointers
        }
    }, []);

    // Viewer session tracking - track when user starts/stops watching
    useEffect(() => {
        // Don't track if camera is offline or in maintenance
        if (isNonPlayable) return;

        let sessionId = null;

        // Start viewer session
        const startTracking = async () => {
            try {
                sessionId = await viewerService.startSession(camera.id);
            } catch (error) {
                console.error('[VideoModal] Failed to start viewer session:', error);
            }
        };

        startTracking();

        // Cleanup: stop session when modal closes
        return () => {
            if (sessionId) {
                viewerService.stopSession(sessionId).catch(err => {
                    console.error('[VideoModal] Failed to stop viewer session:', err);
                });
            }
        };
    }, [camera.id, isNonPlayable]);

    // HLS setup - samakan state non-live dengan grid view
    useEffect(() => {
        if (isMaintenance) {
            cleanupResources();
            setStatus('maintenance');
            setLoadingStage(LoadingStage.ERROR);
            setErrorType(null);
            return;
        }
        if (isOffline) {
            cleanupResources();
            setStatus('offline');
            setLoadingStage(LoadingStage.ERROR);
            setErrorType(null);
            return;
        }
        if (!camera?.streams?.hls || !videoRef.current) return;

        const video = videoRef.current;
        const isExternal = camera.stream_source === 'external';
        let cancelled = false;
        let hls = null;
        let HlsClass = null;

        // Reset state
        setStatus('connecting');
        setErrorType(null);
        setVideoAspectRatio(null);
        updateStreamStage(LoadingStage.CONNECTING);
        startStreamTimeout(LoadingStage.CONNECTING);

        const hlsConfig = getHLSConfig(deviceTier);

        const handlePlaying = () => {
            if (cancelled) return;
            if (playbackCheckRef.current) {
                clearInterval(playbackCheckRef.current);
                playbackCheckRef.current = null;
            }
            setStatus('playing');
            setLoadingStage(LoadingStage.PLAYING);
            clearStreamTimeout();
            syncVideoAspectRatio();
        };

        const startPlaybackCheck = () => {
            playbackCheckRef.current = setInterval(() => {
                if (cancelled) {
                    clearInterval(playbackCheckRef.current);
                    return;
                }
                if (video.readyState >= 3 && video.buffered.length > 0) {
                    if (!video.paused || video.currentTime > 0) {
                        handlePlaying();
                    } else {
                        requestVideoPlay(video);
                    }
                }
            }, 500);
        };

        const handleFatalError = (nextErrorType) => {
            if (cancelled) return;
            cleanupResources();
            setStatus('error');
            setErrorType(nextErrorType);
            setLoadingStage(LoadingStage.ERROR);
        };

        const handleNativeLoadedMetadata = () => {
            if (cancelled) return;
            syncVideoAspectRatio();
            updateStreamStage(LoadingStage.BUFFERING);
            requestVideoPlay(video);
        };

        const handleNativeError = () => {
            if (cancelled) return;
            handleFatalError('media');
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('loadedmetadata', handleNativeLoadedMetadata);
        video.addEventListener('error', handleNativeError);

        // Live Edge Synchronization Fix
        const handlePlaySync = () => {
            if (cancelled || !hls || !isExternal) return;
            if (hls.liveSyncPosition) {
                const latency = hls.liveSyncPosition - video.currentTime;
                // If we are more than 10 seconds behind live edge, sync it
                if (latency > 10) {
                    console.log(`[MapView] Stale buffer detected (Latency: ${latency.toFixed(1)}s). Syncing to live edge...`);
                    video.currentTime = hls.liveSyncPosition;
                }
            }
        };
        video.addEventListener('play', handlePlaySync);

        const initNative = () => {
            video.src = camera.streams.hls;
            updateStreamStage(LoadingStage.LOADING);
            startPlaybackCheck();
        };

        const initHls = async () => {
            HlsClass = await preloadHls();
            if (cancelled || !HlsClass) return;

            hls = new HlsClass(hlsConfig);
            hlsRef.current = hls;

            hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
                if (cancelled) return;
                updateStreamStage(LoadingStage.BUFFERING);
                video.play().catch(() => { });
            });

            hls.on(HlsClass.Events.FRAG_LOADED, () => {
                if (cancelled) return;
                setLoadingStage(prev => {
                    if (prev === LoadingStage.CONNECTING || prev === LoadingStage.LOADING) {
                        updateStreamStage(LoadingStage.BUFFERING);
                        return LoadingStage.BUFFERING;
                    }
                    return prev;
                });
                if (video.paused) video.play().catch(() => { });
            });

            hls.on(HlsClass.Events.FRAG_BUFFERED, () => {
                if (cancelled) return;
                handlePlaying();
                if (video.paused) video.play().catch(() => { });
            });

            hls.on(HlsClass.Events.ERROR, (_, data) => {
                if (cancelled) return;

                // Aggressive network error recovery for external streams
                if (isExternal && data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
                    if (!hls._networkErrorRecoveryCount) hls._networkErrorRecoveryCount = 0;
                    hls._networkErrorRecoveryCount++;

                    if (hls._networkErrorRecoveryCount <= 5) {
                        console.log(`[MapView] Recovering external stream network error (${hls._networkErrorRecoveryCount}/5)`);
                        hls.startLoad();

                        // Jump to live sync directly on network error recovery to avoid 404s
                        if (hls.liveSyncPosition) {
                            video.currentTime = hls.liveSyncPosition;
                        }

                        if (video.paused) video.play().catch(() => { });
                        return;
                    }
                }

                if (!data.fatal) return;

                const nextErrorType = getPublicPopupErrorType({
                    hlsError: {
                        ...data,
                        type: data.type === HlsClass.ErrorTypes.NETWORK_ERROR
                            ? 'networkError'
                            : data.type === HlsClass.ErrorTypes.MEDIA_ERROR
                                ? 'mediaError'
                                : 'unknownError',
                    },
                    streamSource: camera.stream_source,
                });
                handleFatalError(nextErrorType);
            });

            hls.loadSource(camera.streams.hls);
            updateStreamStage(LoadingStage.LOADING);

            setTimeout(() => {
                if (!cancelled && hlsRef.current && videoRef.current) {
                    hls.attachMedia(video);
                    startPlaybackCheck();
                }
            }, 50);
        };

        // Standard priority for internal and external streams
        const initializePlayback = async () => {
            const loadedHls = await preloadHls();
            if (cancelled) return;
            HlsClass = loadedHls;

            if (HlsClass?.isSupported()) {
                await initHls();
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                initNative();
            }
        };

        initializePlayback();

        return () => {
            cancelled = true;
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('loadedmetadata', handleNativeLoadedMetadata);
            video.removeEventListener('error', handleNativeError);
            video.removeEventListener('play', handlePlaySync);
            if (playbackCheckRef.current) {
                clearInterval(playbackCheckRef.current);
                playbackCheckRef.current = null;
            }
            cleanupResources();
            if (hls) {
                hls.destroy();
                hlsRef.current = null;
            }
        };
    }, [
        camera,
        cleanupResources,
        clearStreamTimeout,
        isMaintenance,
        isOffline,
        retryKey,
        startStreamTimeout,
        syncVideoAspectRatio,
        requestVideoPlay,
        updateStreamStage,
    ]);

    return (
        <div
            ref={outerWrapperRef}
            className={`fixed inset-0 z-[2000] ${isFullscreen ? 'bg-black dark:bg-black' : 'flex items-center justify-center p-2 sm:p-4 bg-black/90 dark:bg-black/90'}`}
            onClick={onClose}
        >
            <div
                ref={modalRef}
                data-testid="map-popup-modal"
                className={`bg-white dark:bg-gray-900 overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col ${isFullscreen ? 'w-full h-full' : 'rounded-xl w-full max-w-4xl'}`}
                style={modalStyle}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header Info - di atas video (hide in fullscreen) */}
                {!isFullscreen && (
                    <div ref={headerRef} className="p-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <h3 className="text-gray-900 dark:text-white font-bold text-sm sm:text-base truncate">{camera.name}</h3>
                                {camera.video_codec && (
                                    <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                                )}
                            </div>
                            {/* Status badges */}
                            <div className="flex items-center gap-1 shrink-0">
                                <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${statusBadge.color}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dotColor} ${status === 'playing' && !isLowEnd ? 'animate-pulse' : ''}`} />
                                    {statusBadge.label}
                                </span>
                            </div>
                        </div>
                        {/* Location + Area */}
                        {(camera.location || camera.area_name) && (
                            <div className="flex items-center gap-2 mt-1.5">
                                {camera.location && (
                                    <span className="text-gray-600 dark:text-gray-400 text-xs flex items-center gap-1 truncate">
                                        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                            <circle cx="12" cy="11" r="3" />
                                        </svg>
                                        <span className="truncate">{camera.location}</span>
                                    </span>
                                )}
                                {camera.area_name && (
                                    <span className="px-1.5 py-0.5 bg-sky-500/20 text-sky-600 dark:text-sky-400 rounded text-[10px] font-medium shrink-0">
                                        {camera.area_name}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Video Container - optimized dengan pointer events, no aspect-video constraint untuk support 4:3 */}
                <div
                    data-testid="map-video-body"
                    className={`relative bg-gray-100 dark:bg-black overflow-hidden ${isFullscreen ? 'flex-1 min-h-0 w-full h-full' : `w-full ${!isVideoActive ? 'min-h-[220px] sm:min-h-[280px] md:min-h-[340px]' : ''}`}`}
                    style={bodyStyle}
                    onDoubleClick={toggleFullscreen}
                    onWheel={handleWheel}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                >
                    <PublicStreamStatusOverlay
                        state={overlayState}
                        onRetry={canRetry ? handleRetry : null}
                        className="absolute inset-0 z-10"
                        disableAnimations={isLowEnd}
                    />

                    {/* Video with zoom/pan transform - optimized */}
                    {!isNonPlayable && (
                        <div
                            ref={videoWrapperRef}
                            className="w-full h-full"
                            style={{
                                transformOrigin: 'center center',
                                willChange: 'transform',
                                cursor: stateRef.current.zoom > 1 ? 'grab' : 'default'
                            }}
                        >
                            <video ref={videoRef} className={`w-full h-full pointer-events-none ${isFullscreen ? 'object-contain' : 'object-contain'}`} muted playsInline autoPlay />
                        </div>
                    )}

                    {/* Snapshot Notification */}
                    {snapshotNotification && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                            <div className={`px-5 py-3 rounded-xl shadow-2xl border-2 ${snapshotNotification.type === 'success'
                                ? 'bg-green-500 border-green-400'
                                : 'bg-red-500 border-red-400'
                                } text-white animate-slide-down`}>
                                <div className="flex items-center gap-3">
                                    {snapshotNotification.type === 'success' ? (
                                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    <p className="font-semibold text-sm">{snapshotNotification.message}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Floating controls for fullscreen mode - Always visible on mobile */}
                    {isFullscreen && (
                        <div className="absolute inset-0 z-50 pointer-events-none">
                            {/* Top bar with camera name and exit */}
                            <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h2 className="text-white font-bold text-lg">{camera.name}</h2>
                                        {camera.video_codec && (
                                            <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                                        )}
                                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold shadow ${statusBadge.color}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dotColor}`} />
                                            {statusBadge.label}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {status === 'playing' && (
                                            <button onClick={takeSnapshot} className="p-2 hover:bg-white/20 active:bg-white/30 rounded-xl text-white bg-white/10">
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                                </svg>
                                            </button>
                                        )}
                                        <button onClick={toggleFullscreen} className="p-2 hover:bg-white/20 active:bg-white/30 rounded-xl text-white bg-white/10">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Bottom controls - Zoom only */}
                            {!isPlaybackLocked && (
                                <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1 bg-gray-200/90 dark:bg-gray-900/80 rounded-xl p-1 pointer-events-auto">
                                    <button
                                        onClick={handleZoomOut}
                                        disabled={zoomDisplay <= MIN_ZOOM}
                                        className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded-lg text-gray-900 dark:text-white"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                                        </svg>
                                    </button>
                                    <span className="text-gray-900 dark:text-white text-xs font-medium w-12 text-center">{Math.round(zoomDisplay * 100)}%</span>
                                    <button
                                        onClick={handleZoomIn}
                                        disabled={zoomDisplay >= MAX_ZOOM}
                                        className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded-lg text-gray-900 dark:text-white"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                                        </svg>
                                    </button>
                                    {zoomDisplay > 1 && (
                                        <button
                                            onClick={handleResetZoom}
                                            className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 rounded-lg text-gray-900 dark:text-white ml-1"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Zoom hint */}
                    {!isPlaybackLocked && zoomDisplay > 1 && (
                        <div className="absolute bottom-2 left-2 px-2 py-1 bg-gray-200/80 dark:bg-gray-900/60 text-gray-900 dark:text-white text-xs rounded-lg z-20">
                            Geser untuk pan
                        </div>
                    )}
                </div>

                {/* Controls Panel - hide in fullscreen */}
                <div ref={footerRef} className={`border-t border-gray-200 dark:border-gray-800 ${isFullscreen ? 'hidden' : ''}`}>
                    {/* Controls */}
                    <div className="p-3 flex items-center justify-between">
                        {/* Camera Description - Kiri Bawah */}
                        <div className="text-xs text-gray-600 dark:text-gray-400 flex-1 min-w-0 mr-3">
                            {camera.description ? (
                                <span className="line-clamp-2">{camera.description}</span>
                            ) : (
                                <span className="text-gray-500 dark:text-gray-500 italic">Tidak ada deskripsi</span>
                            )}
                        </div>

                        {/* Controls: Zoom + Screenshot + Fullscreen + Close */}
                        <div className="flex items-center gap-1 shrink-0">
                            {!isPlaybackLocked && (
                                <>
                                    {/* Zoom Controls */}
                                    <div className="flex items-center gap-0.5 bg-gray-200/90 dark:bg-gray-800 rounded-lg p-0.5">
                                        <button
                                            onClick={handleZoomOut}
                                            disabled={zoomDisplay <= MIN_ZOOM}
                                            className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 disabled:opacity-30 rounded text-gray-900 dark:text-white transition-colors"
                                            title="Zoom Out"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                                            </svg>
                                        </button>
                                        <span className="text-gray-900 dark:text-white text-[10px] font-medium w-8 text-center">{Math.round(zoomDisplay * 100)}%</span>
                                        <button
                                            onClick={handleZoomIn}
                                            disabled={zoomDisplay >= MAX_ZOOM}
                                            className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 disabled:opacity-30 rounded text-gray-900 dark:text-white transition-colors"
                                            title="Zoom In"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                                            </svg>
                                        </button>
                                        {zoomDisplay > 1 && (
                                            <button
                                                onClick={handleResetZoom}
                                                className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded text-gray-900 dark:text-white transition-colors"
                                                title="Reset Zoom"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>

                                    {/* Screenshot Button */}
                                    {status === 'playing' && (
                                        <button
                                            onClick={takeSnapshot}
                                            className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors"
                                            title="Ambil Screenshot"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                                <circle cx="8.5" cy="8.5" r="1.5" />
                                                <path d="M21 15l-5-5L5 21" />
                                            </svg>
                                        </button>
                                    )}

                                    <button
                                        onClick={toggleFullscreen}
                                        className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors"
                                        title={isFullscreen ? 'Keluar Fullscreen' : 'Fullscreen'}
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            {isFullscreen ? (
                                                <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" />
                                            ) : (
                                                <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                            )}
                                        </svg>
                                    </button>
                                </>
                            )}

                            {canRetry && (
                                <button
                                    onClick={handleRetry}
                                    className="p-1.5 bg-primary/90 hover:bg-primary text-white rounded-lg transition-colors"
                                    title="Coba Lagi"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 9a7 7 0 0111.314-2.188M19 15a7 7 0 01-11.314 2.188" />
                                    </svg>
                                </button>
                            )}

                            {/* Close Button */}
                            <button
                                onClick={onClose}
                                className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors"
                                title="Tutup"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Codec Description - Simpel dan Jelas */}
                    {camera.video_codec && camera.video_codec === 'h265' && (
                        <div className="px-3 pb-3">
                            <div className="flex items-start gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div className="flex-1 text-xs text-yellow-400">
                                    <strong>Codec H.265:</strong> Terbaik di Safari. Chrome/Edge tergantung hardware device.
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});
VideoModal.displayName = 'VideoModal';

// Map controller
function MapController({ center, zoom, bounds }) {
    const map = useMap();

    useEffect(() => {
        // Jika semua null, jangan ubah view (preserve current position)
        if (!center && !bounds) return;

        if (bounds?.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        } else if (center) {
            map.setView(center, zoom || 15, { animate: true, duration: 0.5 });
        }
    }, [map, center, zoom, bounds]);

    return null;
}

// Camera Marker - dengan support untuk grouped markers dan status
const CameraMarker = memo(({ camera, onClick }) => {
    if (!hasValidCoords(camera)) return null;
    // Gunakan display coordinates jika ada (untuk offset)
    const lat = camera._displayLat ?? parseFloat(camera.latitude);
    const lng = camera._displayLng ?? parseFloat(camera.longitude);
    const isTunnel = camera.is_tunnel === 1 || camera.is_tunnel === true;
    const isOnline = camera.is_online !== 0; // Default to online if undefined
    const status = camera.status || 'active';

    return (
        <Marker
            position={[lat, lng]}
            icon={createCameraIcon(status, isTunnel, isOnline)}
            eventHandlers={{ click: () => onClick(camera) }}
        />
    );
});
CameraMarker.displayName = 'CameraMarker';

// Main MapView
const MapView = memo(({
    cameras = [],
    areas = [],
    defaultCenter = [-7.1507, 111.8815],
    defaultZoom = 11, // Zoom level untuk skala kabupaten
    className = '',
    focusedCameraId = null, // ID kamera yang akan difokuskan
    onFocusHandled = null, // Callback setelah fokus ditangani
    selectedArea: controlledSelectedArea = undefined,
    onAreaChange = null,
    showAreaFilter = true,
    adsConfig = null,
    onCameraOpen = null,
}) => {
    const [internalSelectedArea, setInternalSelectedArea] = useState('all');
    const selectedAreaValue = controlledSelectedArea ?? internalSelectedArea;
    const [modalCamera, setModalCamera] = useState(null);
    const [mapKey, setMapKey] = useState(0);
    const [mapSettings, setMapSettings] = useState({
        latitude: defaultCenter[0],
        longitude: defaultCenter[1],
        zoom: defaultZoom,
        name: 'Semua Lokasi'
    });
    // State untuk menyimpan posisi kamera yang akan difokuskan (untuk animasi)
    const [pendingFocusCamera, setPendingFocusCamera] = useState(null);
    // Flag untuk mencegah map reset saat close modal
    const [preserveMapPosition, setPreserveMapPosition] = useState(false);
    const previousSelectedAreaRef = useRef(selectedAreaValue);

    const setSelectedAreaValue = useCallback((value) => {
        if (typeof onAreaChange === 'function') {
            onAreaChange(value);
            return;
        }
        setInternalSelectedArea(value);
    }, [onAreaChange]);

    // Load map settings from backend
    useEffect(() => {
        settingsService.getMapCenter().then(res => {
            if (res.success && res.data) {
                setMapSettings(res.data);
            }
        }).catch(() => { });
    }, []);

    // Handle focused camera from search - Step 1: Navigate map first
    useEffect(() => {
        if (focusedCameraId) {
            const camera = cameras.find(c => c.id === focusedCameraId);
            if (camera && hasValidCoords(camera)) {
                // Set area filter to show the camera if needed
                if (camera.area_name && selectedAreaValue !== camera.area_name && selectedAreaValue !== 'all') {
                    setSelectedAreaValue('all');
                }
                // Set pending focus camera - map will navigate first
                setPendingFocusCamera(camera);
                setPreserveMapPosition(true);
                // Trigger map rerender to focus on camera
                setMapKey(prev => prev + 1);
                // Notify parent that focus has been handled
                onFocusHandled?.();
            }
        }
    }, [focusedCameraId, cameras, onFocusHandled, selectedAreaValue, setSelectedAreaValue]);

    // Handle focused camera - Step 2: Open modal after map animation
    useEffect(() => {
        if (pendingFocusCamera) {
            // Delay opening modal to let map animate to position first
            const timer = setTimeout(() => {
                if (typeof onCameraOpen === 'function') {
                    onCameraOpen(pendingFocusCamera);
                } else {
                    setModalCamera(pendingFocusCamera);
                }
                setPendingFocusCamera(null);
            }, 600); // 600ms delay for map animation
            return () => clearTimeout(timer);
        }
    }, [onCameraOpen, pendingFocusCamera]);

    useEffect(() => {
        const previousSelectedArea = previousSelectedAreaRef.current;
        if (previousSelectedArea === selectedAreaValue) {
            return;
        }

        const isFocusDrivenAreaChange = Boolean(
            pendingFocusCamera
            && (selectedAreaValue === 'all' || pendingFocusCamera.area_name === selectedAreaValue)
        );

        if (!isFocusDrivenAreaChange) {
            setPreserveMapPosition(false);
            setPendingFocusCamera((current) => {
                if (!current) {
                    return null;
                }

                if (selectedAreaValue === 'all' || current.area_name === selectedAreaValue) {
                    return current;
                }

                return null;
            });
        }

        previousSelectedAreaRef.current = selectedAreaValue;
    }, [pendingFocusCamera, selectedAreaValue]);

    const camerasWithCoords = useMemo(() => cameras.filter(hasValidCoords), [cameras]);

    const areaNames = useMemo(() => {
        const set = new Set();
        cameras.forEach(c => c.area_name && set.add(c.area_name));
        return Array.from(set).sort();
    }, [cameras]);

    const filtered = useMemo(() => {
        let result;
        if (selectedAreaValue === 'all') {
            result = camerasWithCoords;
        } else {
            result = camerasWithCoords.filter(c => c.area_name === selectedAreaValue);
        }
        // Terapkan offset untuk marker yang bertumpuk
        return applyMarkerOffset(result);
    }, [camerasWithCoords, selectedAreaValue]);

    const stats = useMemo(() => {
        const maintenance = filtered.filter(c => c.status === 'maintenance').length;
        const offline = filtered.filter(c => c.status !== 'maintenance' && c.is_online === 0).length;
        const online = filtered.filter(c => c.status !== 'maintenance' && c.is_online !== 0 && !c.is_tunnel).length;
        const tunnel = filtered.filter(c => c.status !== 'maintenance' && c.is_online !== 0 && (c.is_tunnel === 1 || c.is_tunnel === true)).length;
        return { online, tunnel, offline: offline + maintenance };
    }, [filtered]);

    const { center, zoom, bounds } = useMemo(() => {
        // Jika ada pending focus camera (dari search), navigasi ke kamera tersebut
        if (pendingFocusCamera) {
            return {
                center: [parseFloat(pendingFocusCamera.latitude), parseFloat(pendingFocusCamera.longitude)],
                zoom: 17, // Zoom dekat untuk fokus ke kamera
                bounds: null
            };
        }

        // Jika preserveMapPosition aktif (setelah close modal), jangan ubah posisi
        // Return null untuk semua agar MapController tidak mengubah view
        if (preserveMapPosition) {
            return { center: null, zoom: null, bounds: null };
        }

        // Jika area spesifik dipilih, gunakan koordinat area tersebut
        if (selectedAreaValue !== 'all') {
            const areaData = areas.find(a => a.name === selectedAreaValue);
            if (areaData?.latitude && areaData?.longitude) {
                return {
                    center: [parseFloat(areaData.latitude), parseFloat(areaData.longitude)],
                    zoom: 15, // Zoom level untuk desa
                    bounds: null
                };
            }
            // Area tidak punya koordinat, tapi tetap filter kamera
            // Jika ada kamera di area ini, gunakan bounds kamera
            const areaCameras = camerasWithCoords.filter(c => c.area_name === selectedAreaValue);
            if (areaCameras.length > 0) {
                const cameraBounds = L.latLngBounds(areaCameras.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)]));
                return { center: null, zoom: null, bounds: cameraBounds };
            }
            // Area tidak punya koordinat dan tidak ada kamera, fallback ke default
        }

        // "Semua Lokasi" - gunakan settings dengan zoom dari settings
        if (selectedAreaValue === 'all' && mapSettings.latitude && mapSettings.longitude) {
            return {
                center: [mapSettings.latitude, mapSettings.longitude],
                zoom: mapSettings.zoom || 13, // Gunakan zoom dari settings
                bounds: null
            };
        }

        // Fallback
        return {
            center: [mapSettings.latitude || defaultCenter[0], mapSettings.longitude || defaultCenter[1]],
            zoom: mapSettings.zoom || defaultZoom,
            bounds: null
        };
    }, [camerasWithCoords, selectedAreaValue, areas, defaultCenter, defaultZoom, mapSettings, pendingFocusCamera, preserveMapPosition]);

    const openModal = useCallback((camera) => {
        // Set preserve position saat buka modal dari klik marker
        setPreserveMapPosition(true);
        if (typeof onCameraOpen === 'function') {
            onCameraOpen(camera);
            return;
        }
        setModalCamera(camera);
    }, [onCameraOpen]);

    const handleAreaChange = (e) => {
        const nextArea = e?.target?.value || 'all';
        setSelectedAreaValue(nextArea);
        // Reset preserve position saat ganti area filter
        setPreserveMapPosition(false);
        setMapKey(prev => prev + 1);
    };

    if (cameras.length === 0 || camerasWithCoords.length === 0) {
        return (
            <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl min-h-[400px] ${className}`}>
                <div className="text-center p-6">
                    <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                        {cameras.length === 0 ? 'Belum ada kamera' : 'Koordinat kamera belum diatur'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative w-full h-full min-h-[450px] rounded-xl overflow-hidden ${className}`}>
            {/* Map */}
            <MapContainer
                key={mapKey}
                center={center || defaultCenter}
                zoom={defaultZoom}
                className="w-full h-full"
                style={{ minHeight: '450px', zIndex: 1 }}
                zoomControl={false}
            >
                {/* Layer Control - Pilihan Peta (posisi topright) */}
                <LayersControl position="topright">
                    {/* Hybrid - Google Satellite dengan Label (Default) */}
                    <LayersControl.BaseLayer checked name="Hybrid">
                        <TileLayer
                            attribution='&copy; Google'
                            url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                            maxZoom={20}
                        />
                    </LayersControl.BaseLayer>

                    {/* Street Map */}
                    <LayersControl.BaseLayer name="Street">
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                    </LayersControl.BaseLayer>
                </LayersControl>

                <ZoomControl position="bottomright" />
                <MapController center={center} zoom={zoom} bounds={bounds} />
                {filtered.map(camera => (
                    <CameraMarker key={camera.id} camera={camera} onClick={openModal} />
                ))}
            </MapContainer>

            {showAreaFilter && (
                <div className="absolute top-3 left-3 z-[1000]">
                    <select
                        value={selectedAreaValue}
                        onChange={handleAreaChange}
                        className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg shadow-lg text-xs sm:text-sm font-medium border-0 focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer max-w-[180px] sm:max-w-none truncate"
                    >
                        <option value="all">{mapSettings.name || 'Semua Lokasi'} ({camerasWithCoords.length})</option>
                        {areaNames.map(area => (
                            <option key={area} value={area}>
                                {area} ({camerasWithCoords.filter(c => c.area_name === area).length})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] w-full -translate-x-1/2 px-3">
                <div
                    className="mx-auto inline-flex max-w-[calc(100%-6rem)] items-center gap-1.5 overflow-hidden rounded-full bg-white/90 px-2 py-1 shadow-md backdrop-blur dark:bg-gray-800/85 sm:gap-2 sm:px-2.5"
                    data-testid="map-status-bar"
                >
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium leading-none text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Online {stats.online}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-[10px] font-medium leading-none text-orange-700 dark:bg-orange-500/10 dark:text-orange-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                        Tunnel {stats.tunnel}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium leading-none text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
                        Offline {stats.offline}
                    </span>
                </div>
            </div>

            {modalCamera && typeof onCameraOpen !== 'function' && (
                <VideoPopup
                    camera={modalCamera}
                    onClose={() => setModalCamera(null)}
                    adsConfig={adsConfig}
                    modalTestId="map-popup-modal"
                    bodyTestId="map-video-body"
                />
            )}
        </div>
    );
});

MapView.displayName = 'MapView';
export default MapView;


