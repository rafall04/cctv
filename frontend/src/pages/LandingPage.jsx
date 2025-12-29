import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { streamService } from '../services/streamService';
import { areaService } from '../services/areaService';
import { useTheme } from '../contexts/ThemeContext';
import { createTransformThrottle } from '../utils/rafThrottle';
import { detectDeviceTier, getMaxConcurrentStreams, isMobileDevice, getMobileDeviceType } from '../utils/deviceDetector';
import { getHLSConfig } from '../utils/hlsConfig';
import { DEFAULT_STAGGER_DELAY } from '../utils/multiViewManager';
// Stream loading fix imports - **Validates: Requirements 2.1, 2.3, 3.1, 3.2, 5.5**
import { preloadHls, getPreloadedHls, isPreloaded, getPreloadStatus } from '../utils/preloadManager';
import { testMediaMTXConnection, isServerReachable } from '../utils/connectionTester';
import { createLoadingTimeoutHandler, getTimeoutDuration } from '../utils/loadingTimeoutHandler';
import { LoadingStage, LOADING_STAGE_MESSAGES, getStageMessage, createStreamError } from '../utils/streamLoaderTypes';
import { createFallbackHandler, getRetryDelay } from '../utils/fallbackHandler';
// Animation control for low-end device optimization - **Validates: Requirements 5.2**
import { shouldDisableAnimations, getAnimationClass, createAnimationConfig } from '../utils/animationControl';
// Stream initialization queue for low-end devices - **Validates: Requirements 5.4**
import { getGlobalStreamInitQueue, shouldUseQueuedInit, getMaxConcurrentInits } from '../utils/streamInitQueue';
// Feedback widget
import FeedbackWidget from '../components/FeedbackWidget';

// ============================================
// DEVICE-ADAPTIVE HLS CONFIG
// Uses hlsConfig module for tier-specific settings
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2**
// ============================================
const getDeviceAdaptiveHLSConfig = () => {
    const tier = detectDeviceTier();
    const mobile = isMobileDevice();
    const mobileType = getMobileDeviceType();
    
    return getHLSConfig(tier, {
        isMobile: mobile,
        mobileDeviceType: mobileType,
    });
};

// Lazy load HLS.js - uses PreloadManager for caching
// **Validates: Requirements 2.2, 2.3**
const loadHls = async () => {
    return preloadHls();
};


// ============================================
// ICONS - Extended
// ============================================
const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    Camera: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>,
    X: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>,
    Play: () => <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>,
    MapPin: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 5v14m-7-7h14"/></svg>,
    Check: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7"/></svg>,
    Fullscreen: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>,
    Reset: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
    Layout: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
    Image: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
    Filter: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>,
    ChevronDown: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7"/></svg>,
    ZoomIn: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/></svg>,
    ZoomOut: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/></svg>,
    Shield: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>,
    Clock: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    Eye: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>,
    Signal: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/></svg>,
    Grid: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
};

// Skeleton component with low-end device optimization - **Validates: Requirements 5.2**
const Skeleton = ({ className }) => {
    const disableAnimations = shouldDisableAnimations();
    return (
        <div className={`${disableAnimations ? 'opacity-75' : 'animate-pulse'} bg-gray-300 dark:bg-gray-700 rounded-xl ${className}`} />
    );
};
const CameraSkeleton = () => (
    <div className="rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg">
        <Skeleton className="aspect-video" />
        <div className="p-4 space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
    </div>
);

// ============================================
// VIDEO SKELETON - Animated loading placeholder for video player
// Disables animations on low-end devices - **Validates: Requirements 5.2**
// ============================================
const VideoSkeleton = memo(function VideoSkeleton({ size = 'large' }) {
    const isSmall = size === 'small';
    const disableAnimations = shouldDisableAnimations();
    
    // Get animation classes based on device tier
    const pulseClass = disableAnimations ? 'opacity-75' : 'animate-pulse';
    const spinClass = disableAnimations ? '' : 'animate-spin';
    const shimmerClass = disableAnimations ? '' : 'animate-[shimmer_2s_infinite]';
    
    return (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 flex flex-col items-center justify-center pointer-events-none overflow-hidden">
            {/* Animated shimmer background - disabled on low-end */}
            {!disableAnimations && (
                <div className="absolute inset-0 overflow-hidden">
                    <div className={`absolute inset-0 -translate-x-full ${shimmerClass} bg-gradient-to-r from-transparent via-white/5 to-transparent`} />
                </div>
            )}
            
            {/* Video player skeleton UI */}
            <div className="relative z-10 flex flex-col items-center gap-3">
                {/* Play button skeleton */}
                <div className={`${isSmall ? 'w-10 h-10' : 'w-16 h-16'} rounded-full bg-white/10 flex items-center justify-center ${pulseClass}`}>
                    <div className={`${isSmall ? 'w-4 h-4' : 'w-6 h-6'} border-2 border-white/30 border-t-sky-500 rounded-full ${spinClass}`} />
                </div>
                
                {/* Loading text */}
                <div className="flex flex-col items-center gap-1.5">
                    <div className={`${isSmall ? 'h-2 w-16' : 'h-3 w-24'} bg-white/10 rounded-full ${pulseClass}`} />
                    <div className={`${isSmall ? 'h-1.5 w-12' : 'h-2 w-20'} bg-white/5 rounded-full ${pulseClass}`} />
                </div>
            </div>
            
            {/* Bottom progress bar skeleton */}
            <div className="absolute bottom-0 left-0 right-0 p-3">
                <div className="flex items-center gap-2">
                    <div className={`${isSmall ? 'w-4 h-4' : 'w-6 h-6'} rounded bg-white/10 ${pulseClass}`} />
                    <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full w-1/3 bg-white/20 rounded-full ${pulseClass}`} />
                    </div>
                    <div className={`${isSmall ? 'w-8' : 'w-12'} h-3 bg-white/10 rounded ${pulseClass}`} />
                </div>
            </div>
            
            {/* Corner decorations */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
                <div className={`${isSmall ? 'w-8 h-4' : 'w-12 h-5'} bg-white/10 rounded-full ${pulseClass}`} />
            </div>
            <div className="absolute top-3 right-3">
                <div className={`${isSmall ? 'w-4 h-4' : 'w-6 h-6'} bg-white/10 rounded ${pulseClass}`} />
            </div>
        </div>
    );
});

// ============================================
// TOAST NOTIFICATION COMPONENT - Enhanced modern design
// ============================================
function Toast({ message, type = 'info', onClose }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 4000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const styles = {
        info: {
            bg: 'bg-gradient-to-r from-sky-500 to-blue-600',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
        success: {
            bg: 'bg-gradient-to-r from-emerald-500 to-teal-600',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
        warning: {
            bg: 'bg-gradient-to-r from-amber-500 to-orange-600',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
        },
        error: {
            bg: 'bg-gradient-to-r from-red-500 to-rose-600',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
    }[type];

    return (
        <div className={`${styles.bg} text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-slide-down backdrop-blur-sm`}>
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                {styles.icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{message}</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-xl transition-colors shrink-0">
                <Icons.X />
            </button>
        </div>
    );
}

// Toast container for multiple toasts
function ToastContainer({ toasts, removeToast }) {
    if (toasts.length === 0) return null;
    return (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-3 w-full max-w-sm px-4">
            {toasts.map(toast => (
                <Toast key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
            ))}
        </div>
    );
}

// ============================================
// CAMERA CARD - Enhanced with detailed location info
// ============================================
const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti }) {
    return (
        <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg hover:shadow-2xl transition-all duration-300 ring-1 ring-gray-200 dark:ring-gray-800 hover:ring-sky-500/50 hover:-translate-y-1 group/card">
            <button
                onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                className={`absolute top-3 right-3 z-30 p-2.5 rounded-xl shadow-lg transition-all duration-200 ${
                    inMulti 
                        ? 'bg-emerald-500 text-white scale-110' 
                        : 'bg-white/90 dark:bg-gray-800/90 text-gray-600 dark:text-gray-300 hover:bg-sky-500 hover:text-white hover:scale-110'
                }`}
                title={inMulti ? 'Remove from Multi-View' : 'Add to Multi-View'}
            >
                {inMulti ? <Icons.Check /> : <Icons.Plus />}
            </button>
            <div onClick={onClick} className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 relative cursor-pointer">
                <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-700">
                    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                </div>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 bg-black/40 transition-opacity duration-300">
                    <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center text-sky-500 shadow-xl transform scale-90 group-hover/card:scale-100 transition-transform duration-300">
                        <Icons.Play />
                    </div>
                </div>
                <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/90 backdrop-blur-sm text-white text-[10px] font-bold shadow-lg">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                        </span>
                        LIVE
                    </span>
                    {camera.is_tunnel === 1 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/90 backdrop-blur-sm text-white text-[10px] font-bold shadow-lg" title="Koneksi Tunnel - Kurang Stabil">
                            ⚠️ Tunnel
                        </span>
                    )}
                </div>
                {/* Area badge on video */}
                {camera.area_name && (
                    <div className="absolute bottom-3 left-3">
                        <span className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium">
                            {camera.area_name}
                        </span>
                    </div>
                )}
            </div>
            <div className="p-4 cursor-pointer" onClick={onClick}>
                <h3 className="font-bold text-gray-900 dark:text-white truncate mb-1 group-hover/card:text-sky-500 transition-colors">{camera.name}</h3>
                
                {/* Description */}
                {camera.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">{camera.description}</p>
                )}
                
                {/* Location */}
                {camera.location && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
                        <Icons.MapPin />
                        <span className="truncate">{camera.location}</span>
                    </p>
                )}
                
                {/* Area Details Tags */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {camera.kecamatan && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">
                            {camera.kecamatan}
                        </span>
                    )}
                    {camera.kelurahan && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">
                            {camera.kelurahan}
                        </span>
                    )}
                    {camera.rw && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400">
                            RW {camera.rw}
                        </span>
                    )}
                    {camera.rt && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400">
                            RT {camera.rt}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});

// ============================================
// ZOOMABLE VIDEO COMPONENT - Ultra smooth pan/zoom with RAF throttling
// Transform on wrapper div, not video. Uses RAF-based throttling for 60fps max.
// ============================================
const ZoomableVideo = memo(function ZoomableVideo({ videoRef, maxZoom = 4, onZoomChange }) {
    const wrapperRef = useRef(null);
    const transformThrottleRef = useRef(null);
    const stateRef = useRef({ zoom: 1, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

    const getMaxPan = (z) => z <= 1 ? 0 : ((z - 1) / (2 * z)) * 100;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // Initialize RAF throttle on mount
    useEffect(() => {
        if (wrapperRef.current) {
            transformThrottleRef.current = createTransformThrottle(wrapperRef.current);
        }
        return () => {
            transformThrottleRef.current?.cancel();
        };
    }, []);

    const applyTransform = useCallback((animate = false) => {
        if (!wrapperRef.current) return;
        const { zoom, panX, panY } = stateRef.current;
        
        if (animate) {
            // For animated transitions, apply directly with CSS transition
            wrapperRef.current.style.transition = 'transform 0.2s ease-out';
            wrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
        } else {
            // For rapid updates, use RAF throttle
            wrapperRef.current.style.transition = 'none';
            if (transformThrottleRef.current) {
                transformThrottleRef.current.update(zoom, panX, panY);
            } else {
                wrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
            }
        }
        onZoomChange?.(zoom);
    }, [onZoomChange]);

    const handleZoom = useCallback((delta, animate = true) => {
        const s = stateRef.current;
        s.zoom = clamp(s.zoom + delta, 1, maxZoom);
        if (s.zoom <= 1) { s.panX = 0; s.panY = 0; }
        else {
            const max = getMaxPan(s.zoom);
            s.panX = clamp(s.panX, -max, max);
            s.panY = clamp(s.panY, -max, max);
        }
        applyTransform(animate);
    }, [maxZoom, applyTransform]);

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        handleZoom(e.deltaY > 0 ? -0.5 : 0.5, false);
    }, [handleZoom]);

    const handlePointerDown = useCallback((e) => {
        const s = stateRef.current;
        if (s.zoom <= 1) return;
        s.dragging = true;
        s.startX = e.clientX;
        s.startY = e.clientY;
        s.startPanX = s.panX;
        s.startPanY = s.panY;
        wrapperRef.current.style.cursor = 'grabbing';
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
        
        // Use RAF-throttled transform update for smooth 60fps max
        if (transformThrottleRef.current) {
            transformThrottleRef.current.update(s.zoom, s.panX, s.panY);
        } else {
            wrapperRef.current.style.transform = `scale(${s.zoom}) translate(${s.panX}%, ${s.panY}%)`;
        }
    }, []);

    const handlePointerUp = useCallback((e) => {
        const s = stateRef.current;
        s.dragging = false;
        if (wrapperRef.current) wrapperRef.current.style.cursor = s.zoom > 1 ? 'grab' : 'default';
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }, []);

    const reset = useCallback(() => {
        const s = stateRef.current;
        s.zoom = 1; s.panX = 0; s.panY = 0;
        applyTransform(true);
    }, [applyTransform]);

    // Expose methods via ref
    useEffect(() => {
        if (wrapperRef.current) {
            wrapperRef.current._zoomIn = () => handleZoom(0.5);
            wrapperRef.current._zoomOut = () => handleZoom(-0.5);
            wrapperRef.current._reset = reset;
            wrapperRef.current._getZoom = () => stateRef.current.zoom;
        }
    }, [handleZoom, reset]);

    return (
        <div 
            ref={wrapperRef}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="w-full h-full"
            style={{ 
                transformOrigin: 'center center', 
                cursor: 'default',
                touchAction: 'none', // Critical for mobile smoothness
                willChange: 'transform'
            }}
        >
            <video 
                ref={videoRef}
                className="w-full h-full object-contain pointer-events-none"
                muted
                playsInline 
                autoPlay 
            />
        </div>
    );
});


// ============================================
// VIDEO POPUP - Optimized with fullscreen detection, timeout handler, progressive stages, and auto-retry
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.3, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3**
// ============================================
function VideoPopup({ camera, onClose }) {
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const modalRef = useRef(null);
    const hlsRef = useRef(null);
    const loadingTimeoutHandlerRef = useRef(null);
    const fallbackHandlerRef = useRef(null);
    const abortControllerRef = useRef(null);
    
    const [status, setStatus] = useState('connecting');
    const [loadingStage, setLoadingStage] = useState(LoadingStage.CONNECTING);
    const [zoom, setZoom] = useState(1);
    const [retryKey, setRetryKey] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [autoRetryCount, setAutoRetryCount] = useState(0);
    const [isAutoRetrying, setIsAutoRetrying] = useState(false);
    const [consecutiveFailures, setConsecutiveFailures] = useState(0);
    const [showTroubleshooting, setShowTroubleshooting] = useState(false);
    
    const url = camera.streams?.hls;
    const deviceTier = detectDeviceTier();

    // Track fullscreen state to disable animations
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [onClose]);

    // Initialize LoadingTimeoutHandler - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
    useEffect(() => {
        loadingTimeoutHandlerRef.current = createLoadingTimeoutHandler({
            deviceTier,
            onTimeout: (stage) => {
                cleanupResources();
                setStatus('timeout');
                setLoadingStage(LoadingStage.TIMEOUT);
                const failures = loadingTimeoutHandlerRef.current?.getConsecutiveFailures() || 0;
                setConsecutiveFailures(failures);
            },
            onMaxFailures: (failures) => {
                setShowTroubleshooting(true);
                setConsecutiveFailures(failures);
            },
        });

        return () => {
            if (loadingTimeoutHandlerRef.current) {
                loadingTimeoutHandlerRef.current.destroy();
                loadingTimeoutHandlerRef.current = null;
            }
        };
    }, [deviceTier]);

    // Initialize FallbackHandler for auto-retry - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    useEffect(() => {
        fallbackHandlerRef.current = createFallbackHandler({
            maxAutoRetries: 3,
            onAutoRetry: ({ attempt, maxAttempts, delay }) => {
                setIsAutoRetrying(true);
                setAutoRetryCount(attempt);
            },
            onAutoRetryExhausted: ({ totalAttempts }) => {
                setIsAutoRetrying(false);
                setAutoRetryCount(totalAttempts);
            },
            onNetworkRestore: () => {
                // Note: We don't auto-retry on network restore in popup
                // User can manually retry if needed
            },
            onManualRetryRequired: () => {
                setIsAutoRetrying(false);
            },
        });

        return () => {
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.destroy();
                fallbackHandlerRef.current = null;
            }
        };
    }, []);

    // Cleanup resources function - **Validates: Requirements 7.1, 7.2, 7.3**
    const cleanupResources = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = '';
            videoRef.current.load();
        }
        if (loadingTimeoutHandlerRef.current) {
            loadingTimeoutHandlerRef.current.clearTimeout();
        }
        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.clearPendingRetry();
        }
    }, []);

    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        let cancelled = false;
        let playbackCheckInterval = null;

        abortControllerRef.current = new AbortController();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);

        // Start loading timeout - **Validates: Requirements 1.1**
        if (loadingTimeoutHandlerRef.current) {
            loadingTimeoutHandlerRef.current.startTimeout(LoadingStage.CONNECTING);
        }

        // Only change to 'live' once video starts playing - don't revert on buffering
        const handlePlaying = () => {
            if (cancelled) return;
            clearInterval(playbackCheckInterval);
            setStatus('live');
            setLoadingStage(LoadingStage.PLAYING);
            // Clear timeout on success
            if (loadingTimeoutHandlerRef.current) {
                loadingTimeoutHandlerRef.current.clearTimeout();
                loadingTimeoutHandlerRef.current.resetFailures();
            }
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.reset();
            }
            setAutoRetryCount(0);
            setConsecutiveFailures(0);
        };
        
        // Fallback: Check video state periodically
        // Some browsers don't fire 'playing' event reliably
        const startPlaybackCheck = () => {
            playbackCheckInterval = setInterval(() => {
                if (cancelled) {
                    clearInterval(playbackCheckInterval);
                    return;
                }
                // Check if video is actually playing (has time progress or buffered data)
                if (video.readyState >= 3 && video.buffered.length > 0) {
                    // Video has enough data - consider it playing
                    if (!video.paused || video.currentTime > 0) {
                        handlePlaying();
                    } else {
                        // Try to play again
                        video.play().catch(() => {});
                    }
                }
            }, 500);
        };
        
        const handleError = () => {
            if (cancelled) return;
            clearInterval(playbackCheckInterval);
            setStatus('error');
            setLoadingStage(LoadingStage.ERROR);
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('error', handleError);

        // Lazy load HLS.js using PreloadManager - **Validates: Requirements 2.3**
        loadHls().then(Hls => {
            if (cancelled) return;
            
            // Update loading stage - **Validates: Requirements 4.2**
            setLoadingStage(LoadingStage.LOADING);
            if (loadingTimeoutHandlerRef.current) {
                loadingTimeoutHandlerRef.current.updateStage(LoadingStage.LOADING);
            }
            
            if (Hls.isSupported()) {
                // Use device-adaptive HLS configuration
                const hlsConfig = getDeviceAdaptiveHLSConfig();
                hls = new Hls(hlsConfig);
                hlsRef.current = hls;
                hls.loadSource(url);
                hls.attachMedia(video);
                
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (cancelled) return;
                    // Update to buffering stage - **Validates: Requirements 4.3**
                    setLoadingStage(LoadingStage.BUFFERING);
                    if (loadingTimeoutHandlerRef.current) {
                        loadingTimeoutHandlerRef.current.updateStage(LoadingStage.BUFFERING);
                    }
                    video.play().catch(() => {});
                });

                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                    if (cancelled) return;
                    // Update to starting stage - **Validates: Requirements 4.4**
                    setLoadingStage(prev => {
                        if (prev === LoadingStage.BUFFERING) {
                            if (loadingTimeoutHandlerRef.current) {
                                loadingTimeoutHandlerRef.current.updateStage(LoadingStage.STARTING);
                            }
                            return LoadingStage.STARTING;
                        }
                        return prev;
                    });
                    // Start playback check interval as fallback
                    startPlaybackCheck();
                    // Force play attempt after fragment buffered
                    if (video.paused) {
                        video.play().catch(() => {});
                    }
                });
                
                hls.on(Hls.Events.ERROR, (_, d) => {
                    if (cancelled) return;
                    if (d.fatal) {
                        // Clear loading timeout
                        if (loadingTimeoutHandlerRef.current) {
                            loadingTimeoutHandlerRef.current.clearTimeout();
                        }

                        const errorType = d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' :
                                          d.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'unknown';

                        // For media errors, try recovery first before auto-retry
                        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
                            console.log('HLS media error, attempting recovery...');
                            hls.recoverMediaError();
                            return;
                        }

                        // Try auto-retry with FallbackHandler - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
                        if (fallbackHandlerRef.current) {
                            const streamError = createStreamError({
                                type: errorType,
                                message: d.details || 'Stream error',
                                stage: loadingStage,
                                deviceTier,
                                retryCount: autoRetryCount,
                            });

                            const result = fallbackHandlerRef.current.handleError(streamError, () => {
                                if (!cancelled && hls) {
                                    setLoadingStage(LoadingStage.CONNECTING);
                                    // Destroy and recreate HLS instance for clean retry
                                    hls.destroy();
                                    const newHls = new Hls(getDeviceAdaptiveHLSConfig());
                                    hlsRef.current = newHls;
                                    newHls.loadSource(url);
                                    newHls.attachMedia(video);
                                    
                                    // Re-attach event handlers
                                    newHls.on(Hls.Events.MANIFEST_PARSED, () => {
                                        if (cancelled) return;
                                        setLoadingStage(LoadingStage.BUFFERING);
                                        video.play().catch(() => {});
                                    });
                                    
                                    newHls.on(Hls.Events.ERROR, (_, d2) => {
                                        if (cancelled) return;
                                        if (d2.fatal) {
                                            setStatus('error');
                                            setLoadingStage(LoadingStage.ERROR);
                                        }
                                    });
                                }
                            });

                            if (result.action === 'manual-retry-required') {
                                setStatus('error');
                                setLoadingStage(LoadingStage.ERROR);
                            }
                        } else {
                            setStatus('error');
                            setLoadingStage(LoadingStage.ERROR);
                        }
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
            }
        });

        return () => {
            cancelled = true;
            clearInterval(playbackCheckInterval);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('error', handleError);
            cleanupResources();
            if (hls) { hls.destroy(); hlsRef.current = null; }
        };
    }, [url, retryKey, deviceTier, cleanupResources]);

    const handleRetry = useCallback(() => {
        cleanupResources();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);
        setAutoRetryCount(0);
        setIsAutoRetrying(false);
        setShowTroubleshooting(false);
        if (loadingTimeoutHandlerRef.current) {
            loadingTimeoutHandlerRef.current.resetFailures();
        }
        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.reset();
        }
        setRetryKey(k => k + 1);
    }, [cleanupResources]);

    const toggleFS = async () => {
        try {
            if (!document.fullscreenElement) await modalRef.current?.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch {}
    };

    const takeSnapshot = () => {
        if (!videoRef.current || status !== 'live') return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        const link = document.createElement('a');
        link.download = `${camera.name}-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    // Get wrapper ref for zoom controls
    const getWrapper = () => wrapperRef.current?.querySelector('[style*="transform-origin"]');

    // Get status display info - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    const getStatusDisplay = () => {
        if (status === 'live') return { label: 'LIVE', color: 'bg-emerald-500/20 text-emerald-400', dotColor: 'bg-emerald-400' };
        if (status === 'timeout') return { label: 'TIMEOUT', color: 'bg-amber-500/20 text-amber-400', dotColor: 'bg-amber-400' };
        if (status === 'error') return { label: 'OFFLINE', color: 'bg-red-500/20 text-red-400', dotColor: 'bg-red-400' };
        // Connecting states with progressive messages
        return { label: getStageMessage(loadingStage), color: 'bg-amber-500/20 text-amber-400', dotColor: 'bg-amber-400' };
    };

    const statusDisplay = getStatusDisplay();
    
    // Check if animations should be disabled on low-end devices - **Validates: Requirements 5.2**
    const disableAnimations = shouldDisableAnimations();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-2 sm:p-4" onClick={onClose}>
            <div ref={modalRef} className="relative w-full max-w-5xl bg-gray-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 16px)' }} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="shrink-0 flex items-center justify-between p-3 sm:p-4 bg-gray-900 border-b border-white/10">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-white font-bold text-sm sm:text-lg truncate">{camera.name}</h2>
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${statusDisplay.color}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${statusDisplay.dotColor} ${status === 'live' && !isFullscreen && !disableAnimations ? 'animate-pulse' : ''}`} />
                                {statusDisplay.label}
                            </span>
                            {isAutoRetrying && (
                                <span className="text-[10px] text-amber-400">Auto-retry {autoRetryCount}/3...</span>
                            )}
                        </div>
                        {camera.location && <p className="text-gray-400 text-xs sm:text-sm flex items-center gap-1.5 mt-1 truncate"><Icons.MapPin /> {camera.location}</p>}
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2">
                        {status === 'live' && <button onClick={takeSnapshot} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.Fullscreen /></button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.X /></button>
                    </div>
                </div>

                {/* Video */}
                <div ref={wrapperRef} className="relative flex-1 min-h-0 bg-black overflow-hidden" onDoubleClick={toggleFS}>
                    <ZoomableVideo videoRef={videoRef} maxZoom={4} onZoomChange={setZoom} />
                    
                    {/* Progressive Loading Overlay - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 5.2** */}
                    {status === 'connecting' && (
                        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 flex flex-col items-center justify-center">
                            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
                                <div className={`w-8 h-8 border-2 border-white/30 border-t-sky-500 rounded-full ${disableAnimations ? '' : 'animate-spin'}`} />
                            </div>
                            <p className="text-white font-medium mb-1">{getStageMessage(loadingStage)}</p>
                            <p className="text-gray-400 text-sm">Please wait...</p>
                        </div>
                    )}
                    
                    {/* Timeout Error Overlay - **Validates: Requirements 1.2, 1.4** */}
                    {status === 'timeout' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90">
                            <div className="text-center p-6">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                                    <Icons.Clock />
                                </div>
                                <h3 className="text-white font-semibold text-lg mb-2">Loading Timeout</h3>
                                <p className="text-gray-400 text-sm mb-2">Stream took too long to load</p>
                                {consecutiveFailures >= 3 && showTroubleshooting && (
                                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-left max-w-sm mx-auto">
                                        <p className="text-amber-400 text-xs font-medium mb-1">Troubleshooting Tips:</p>
                                        <ul className="text-gray-400 text-xs list-disc list-inside space-y-1">
                                            <li>Check your internet connection</li>
                                            <li>Camera may be offline</li>
                                            <li>Try refreshing the page</li>
                                        </ul>
                                    </div>
                                )}
                                <button
                                    onClick={handleRetry}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium transition-colors"
                                >
                                    <Icons.Reset />
                                    Coba Lagi
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {/* Error Overlay */}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90">
                            <div className="text-center p-6">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                                    <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <h3 className="text-white font-semibold text-lg mb-2">CCTV Tidak Terkoneksi</h3>
                                <p className="text-gray-400 text-sm mb-4">Kamera sedang offline atau koneksi terputus</p>
                                <button
                                    onClick={handleRetry}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium transition-colors"
                                >
                                    <Icons.Reset />
                                    Coba Lagi
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="shrink-0 p-3 sm:p-4 bg-gray-900 border-t border-white/10">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            {camera.description && <p className="text-gray-400 text-xs sm:text-sm line-clamp-1">{camera.description}</p>}
                            {camera.area_name && <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">{camera.area_name}</span>}
                        </div>
                        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
                            <button onClick={() => getWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icons.ZoomOut /></button>
                            <span className="text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                            <button onClick={() => getWrapper()?._zoomIn?.()} disabled={zoom >= 4} className="p-2 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white"><Icons.ZoomIn /></button>
                            {zoom > 1 && <button onClick={() => getWrapper()?._reset?.()} className="p-2 hover:bg-white/10 rounded-lg text-white ml-1"><Icons.Reset /></button>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================
// MULTI-VIEW VIDEO ITEM - Optimized with fullscreen detection, error isolation, timeout handler, and auto-retry
// Each stream is isolated - errors in one don't affect others
// **Validates: Requirements 1.1, 1.2, 1.3, 2.3, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3**
// ============================================
function MultiViewVideoItem({ camera, onRemove, onError, onStatusChange, initDelay = 0 }) {
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const containerRef = useRef(null);
    const hlsRef = useRef(null);
    const loadingTimeoutHandlerRef = useRef(null);
    const fallbackHandlerRef = useRef(null);
    const abortControllerRef = useRef(null);
    
    const [status, setStatus] = useState('connecting');
    const [loadingStage, setLoadingStage] = useState(LoadingStage.CONNECTING);
    const [zoom, setZoom] = useState(1);
    const [retryKey, setRetryKey] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [autoRetryCount, setAutoRetryCount] = useState(0);
    const [isAutoRetrying, setIsAutoRetrying] = useState(false);
    
    const url = camera.streams?.hls;
    const deviceTier = detectDeviceTier();

    // Track fullscreen state to disable animations
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    // Notify parent of status changes
    useEffect(() => {
        onStatusChange?.(camera.id, status);
    }, [status, camera.id, onStatusChange]);

    // Initialize LoadingTimeoutHandler - **Validates: Requirements 1.1, 1.2, 1.3**
    useEffect(() => {
        loadingTimeoutHandlerRef.current = createLoadingTimeoutHandler({
            deviceTier,
            onTimeout: (stage) => {
                cleanupResources();
                setStatus('timeout');
                setLoadingStage(LoadingStage.TIMEOUT);
                onError?.(camera.id, new Error(`Loading timeout at ${stage} stage`));
            },
            onMaxFailures: () => {
                // In multi-view, just notify parent
                onError?.(camera.id, new Error('Max consecutive failures reached'));
            },
        });

        return () => {
            if (loadingTimeoutHandlerRef.current) {
                loadingTimeoutHandlerRef.current.destroy();
                loadingTimeoutHandlerRef.current = null;
            }
        };
    }, [deviceTier, camera.id, onError]);

    // Initialize FallbackHandler for auto-retry - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    useEffect(() => {
        fallbackHandlerRef.current = createFallbackHandler({
            maxAutoRetries: 3,
            onAutoRetry: ({ attempt }) => {
                setIsAutoRetrying(true);
                setAutoRetryCount(attempt);
            },
            onAutoRetryExhausted: ({ totalAttempts }) => {
                setIsAutoRetrying(false);
                setAutoRetryCount(totalAttempts);
            },
            onNetworkRestore: () => {
                // Note: We don't auto-retry on network restore in multi-view
                // User can manually retry if needed
            },
            onManualRetryRequired: () => {
                setIsAutoRetrying(false);
            },
        });

        return () => {
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.destroy();
                fallbackHandlerRef.current = null;
            }
        };
    }, []);

    // Cleanup resources function - **Validates: Requirements 7.1, 7.2, 7.3**
    const cleanupResources = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = '';
            videoRef.current.load();
        }
        if (loadingTimeoutHandlerRef.current) {
            loadingTimeoutHandlerRef.current.clearTimeout();
        }
        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.clearPendingRetry();
        }
    }, []);

    useEffect(() => {
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        let cancelled = false;
        let initTimeout = null;

        abortControllerRef.current = new AbortController();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);
        let playbackCheckInterval = null;

        // Only change to 'live' once video starts playing - don't revert on buffering
        const handlePlaying = () => {
            if (cancelled) return;
            clearInterval(playbackCheckInterval);
            setStatus('live');
            setLoadingStage(LoadingStage.PLAYING);
            // Clear timeout on success
            if (loadingTimeoutHandlerRef.current) {
                loadingTimeoutHandlerRef.current.clearTimeout();
                loadingTimeoutHandlerRef.current.resetFailures();
            }
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.reset();
            }
            setAutoRetryCount(0);
        };
        
        // Fallback: Check video state periodically
        const startPlaybackCheck = () => {
            playbackCheckInterval = setInterval(() => {
                if (cancelled) {
                    clearInterval(playbackCheckInterval);
                    return;
                }
                if (video.readyState >= 3 && video.buffered.length > 0) {
                    if (!video.paused || video.currentTime > 0) {
                        handlePlaying();
                    } else {
                        video.play().catch(() => {});
                    }
                }
            }, 500);
        };
        
        const handleError = () => {
            if (cancelled) return;
            clearInterval(playbackCheckInterval);
            setStatus('error');
            setLoadingStage(LoadingStage.ERROR);
            // Notify parent of error for isolation tracking
            onError?.(camera.id, new Error('Video playback error'));
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('error', handleError);

        // Core initialization logic
        const performInit = async () => {
            if (cancelled) return;

            // Start loading timeout - **Validates: Requirements 1.1**
            if (loadingTimeoutHandlerRef.current) {
                loadingTimeoutHandlerRef.current.startTimeout(LoadingStage.CONNECTING);
            }

            // Lazy load HLS.js using PreloadManager - **Validates: Requirements 2.3**
            const Hls = await loadHls();
            
            if (cancelled) return;

            // Update loading stage - **Validates: Requirements 4.2**
            setLoadingStage(LoadingStage.LOADING);
            if (loadingTimeoutHandlerRef.current) {
                loadingTimeoutHandlerRef.current.updateStage(LoadingStage.LOADING);
            }
            
            if (Hls.isSupported()) {
                // Use device-adaptive HLS configuration
                const hlsConfig = getDeviceAdaptiveHLSConfig();
                hls = new Hls(hlsConfig);
                hlsRef.current = hls;
                hls.loadSource(url);
                hls.attachMedia(video);
                
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (cancelled) return;
                    // Update to buffering stage - **Validates: Requirements 4.3**
                    setLoadingStage(LoadingStage.BUFFERING);
                    if (loadingTimeoutHandlerRef.current) {
                        loadingTimeoutHandlerRef.current.updateStage(LoadingStage.BUFFERING);
                    }
                    video.play().catch(() => {});
                });

                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                    if (cancelled) return;
                    // Update to starting stage - **Validates: Requirements 4.4**
                    if (loadingStage === LoadingStage.BUFFERING) {
                        setLoadingStage(LoadingStage.STARTING);
                        if (loadingTimeoutHandlerRef.current) {
                            loadingTimeoutHandlerRef.current.updateStage(LoadingStage.STARTING);
                        }
                    }
                    // Start playback check interval as fallback
                    startPlaybackCheck();
                    // Force play attempt after fragment buffered
                    if (video.paused) {
                        video.play().catch(() => {});
                    }
                });
                
                hls.on(Hls.Events.ERROR, (_, d) => {
                    if (cancelled) return;
                    if (d.fatal) {
                        // Clear loading timeout
                        if (loadingTimeoutHandlerRef.current) {
                            loadingTimeoutHandlerRef.current.clearTimeout();
                        }

                        const errorType = d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' :
                                          d.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'unknown';

                        // Try auto-retry with FallbackHandler - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
                        if (fallbackHandlerRef.current) {
                            const streamError = createStreamError({
                                type: errorType,
                                message: d.details || 'Stream error',
                                stage: loadingStage,
                                deviceTier,
                                retryCount: autoRetryCount,
                            });

                            const result = fallbackHandlerRef.current.handleError(streamError, () => {
                                if (!cancelled && hls) {
                                    setLoadingStage(LoadingStage.CONNECTING);
                                    if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
                                        hls.startLoad();
                                    } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
                                        hls.recoverMediaError();
                                    }
                                }
                            });

                            if (result.action === 'manual-retry-required') {
                                setStatus('error');
                                setLoadingStage(LoadingStage.ERROR);
                                // Error isolation: notify parent but don't propagate
                                onError?.(camera.id, new Error(`HLS fatal error: ${d.type}`));
                            }
                        } else {
                            setStatus('error');
                            setLoadingStage(LoadingStage.ERROR);
                            onError?.(camera.id, new Error(`HLS fatal error: ${d.type}`));
                        }
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
            }
        };

        // Staggered initialization with queue support for low-end devices
        // **Validates: Requirements 5.4**
        const initStream = async () => {
            // Wait for initDelay first (staggered initialization)
            if (initDelay > 0) {
                await new Promise(resolve => {
                    initTimeout = setTimeout(resolve, initDelay);
                });
            }

            if (cancelled) return;

            // On low-end devices, use queue to limit concurrent initializations
            // **Validates: Requirements 5.4**
            if (shouldUseQueuedInit()) {
                const queue = getGlobalStreamInitQueue();
                try {
                    await queue.enqueue(performInit, camera.id);
                } catch (error) {
                    if (!cancelled) {
                        console.warn(`Stream ${camera.id} init cancelled:`, error.message);
                    }
                }
            } else {
                // Medium/High devices: initialize directly
                await performInit();
            }
        };

        initStream();

        // Cleanup function - ensures proper resource release
        return () => {
            cancelled = true;
            clearInterval(playbackCheckInterval);
            if (initTimeout) clearTimeout(initTimeout);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('error', handleError);
            cleanupResources();
            if (hls) { 
                hls.destroy(); 
                hlsRef.current = null; 
            }
        };
    }, [url, retryKey, initDelay, camera.id, onError, deviceTier, cleanupResources]);

    const handleRetry = useCallback(() => {
        cleanupResources();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);
        setAutoRetryCount(0);
        setIsAutoRetrying(false);
        if (loadingTimeoutHandlerRef.current) {
            loadingTimeoutHandlerRef.current.resetFailures();
        }
        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.reset();
        }
        setRetryKey(k => k + 1);
    }, [cleanupResources]);

    const toggleFS = async () => {
        try {
            if (!document.fullscreenElement) await containerRef.current?.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch {}
    };

    const takeSnapshot = () => {
        if (!videoRef.current || status !== 'live') return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        const link = document.createElement('a');
        link.download = `${camera.name}-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const getWrapper = () => wrapperRef.current?.querySelector('[style*="transform-origin"]');

    // Get status display info for multi-view - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    const getStatusBadge = () => {
        if (status === 'live') return { label: 'LIVE', color: 'bg-emerald-500' };
        if (status === 'timeout') return { label: 'TIMEOUT', color: 'bg-amber-500' };
        if (status === 'error') return { label: 'OFF', color: 'bg-red-500' };
        // Connecting - show abbreviated stage
        return { label: '...', color: 'bg-amber-500' };
    };

    const statusBadge = getStatusBadge();
    
    // Check if animations should be disabled on low-end devices - **Validates: Requirements 5.2**
    const disableAnimations = shouldDisableAnimations();

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black rounded-xl overflow-hidden group">
            <div ref={wrapperRef} className="w-full h-full">
                <ZoomableVideo videoRef={videoRef} status={status} maxZoom={3} onZoomChange={setZoom} />
            </div>
            {/* Status badge - disable pulse animation in fullscreen and on low-end devices */}
            <div className="absolute top-2 left-2 z-10 pointer-events-none">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold text-white shadow ${statusBadge.color}`}>
                    <span className={`w-1 h-1 rounded-full bg-white ${status === 'live' && !isFullscreen && !disableAnimations ? 'animate-pulse' : ''}`} />
                    {statusBadge.label}
                </span>
                {isAutoRetrying && (
                    <span className="ml-1 text-[8px] text-amber-400">retry {autoRetryCount}/3</span>
                )}
            </div>
            <button onClick={onRemove} className="absolute top-2 right-2 z-10 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg text-white shadow"><Icons.X /></button>
            {/* Overlay controls - render only on hover, no transition in fullscreen */}
            <div className={`absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 z-10 ${isFullscreen ? '' : 'transition-opacity'}`}>
                <div className="flex items-center justify-between gap-2">
                    <p className="text-white text-xs font-medium truncate flex-1">{camera.name}</p>
                    <div className="flex items-center gap-1">
                        <button onClick={() => getWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomOut /></button>
                        <span className="text-white/70 text-[10px] w-8 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => getWrapper()?._zoomIn?.()} disabled={zoom >= 3} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomIn /></button>
                        {zoom > 1 && <button onClick={() => getWrapper()?._reset?.()} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Reset /></button>}
                        <div className="w-px h-4 bg-white/20 mx-1" />
                        {status === 'live' && <button onClick={takeSnapshot} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Fullscreen /></button>
                    </div>
                </div>
            </div>
            
            {/* Progressive Loading Overlay - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.2** */}
            {status === 'connecting' && (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 flex flex-col items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center mb-2">
                        <div className={`w-5 h-5 border-2 border-white/30 border-t-sky-500 rounded-full ${disableAnimations ? '' : 'animate-spin'}`} />
                    </div>
                    <p className="text-white text-xs font-medium">{getStageMessage(loadingStage)}</p>
                </div>
            )}
            
            {/* Timeout Overlay */}
            {status === 'timeout' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90">
                    <div className="text-center p-4">
                        <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-amber-500/20 flex items-center justify-center">
                            <Icons.Clock />
                        </div>
                        <p className="text-white text-xs font-medium mb-1">Timeout</p>
                        <p className="text-gray-400 text-[10px] mb-3">Loading terlalu lama</p>
                        <button
                            onClick={handleRetry}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                            <Icons.Reset />
                            Coba Lagi
                        </button>
                    </div>
                </div>
            )}
            
            {/* Error Overlay */}
            {status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90">
                    <div className="text-center p-4">
                        <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-red-500/20 flex items-center justify-center">
                            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <p className="text-white text-xs font-medium mb-1">Tidak Terkoneksi</p>
                        <p className="text-gray-400 text-[10px] mb-3">Kamera offline</p>
                        <button
                            onClick={handleRetry}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                            <Icons.Reset />
                            Coba Lagi
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// MULTI-VIEW LAYOUT - Optimized with staggered initialization and proper cleanup
// ============================================
function MultiViewLayout({ cameras, onRemove, onClose }) {
    const containerRef = useRef(null);
    const streamErrorsRef = useRef(new Map()); // Track errors per stream for isolation
    const count = cameras.length;

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => { 
            document.removeEventListener('keydown', onKey); 
            document.body.style.overflow = ''; 
        };
    }, [onClose]);

    // Cleanup all streams on unmount
    useEffect(() => {
        return () => {
            // Clear error tracking
            streamErrorsRef.current.clear();
        };
    }, []);

    const toggleFS = async () => {
        try {
            if (!document.fullscreenElement) await containerRef.current?.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch {}
    };

    // Handle stream errors with isolation - one error doesn't affect others
    const handleStreamError = useCallback((cameraId, error) => {
        streamErrorsRef.current.set(cameraId, error);
        // Error is isolated to this stream only
        console.warn(`Stream ${cameraId} error (isolated):`, error.message);
    }, []);

    // Handle stream status changes
    const handleStatusChange = useCallback((cameraId, status) => {
        if (status === 'live') {
            // Clear any previous error for this stream
            streamErrorsRef.current.delete(cameraId);
        }
    }, []);

    // Calculate stagger delay for each camera based on index
    const getInitDelay = (index) => index * DEFAULT_STAGGER_DELAY;

    return (
        <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
            <div className="shrink-0 flex items-center justify-between p-3 bg-gray-900 border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400"><Icons.Layout /></div>
                    <div>
                        <h2 className="text-white font-bold text-sm sm:text-base">Multi-View</h2>
                        <p className="text-gray-500 text-[10px] sm:text-xs">{count} camera{count !== 1 ? 's' : ''}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={toggleFS} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.Fullscreen /></button>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-white"><Icons.X /></button>
                </div>
            </div>
            <div ref={containerRef} className="flex-1 p-2 sm:p-3 min-h-0 overflow-hidden">
                {count === 1 && (
                    <div className="h-full">
                        <MultiViewVideoItem 
                            camera={cameras[0]} 
                            onRemove={() => onRemove(cameras[0].id)}
                            onError={handleStreamError}
                            onStatusChange={handleStatusChange}
                            initDelay={getInitDelay(0)}
                        />
                    </div>
                )}
                {count === 2 && (
                    <div className="h-full grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        {cameras.map((c, index) => (
                            <MultiViewVideoItem 
                                key={c.id} 
                                camera={c} 
                                onRemove={() => onRemove(c.id)}
                                onError={handleStreamError}
                                onStatusChange={handleStatusChange}
                                initDelay={getInitDelay(index)}
                            />
                        ))}
                    </div>
                )}
                {count === 3 && (
                    <div className="h-full flex flex-col gap-2 sm:gap-3">
                        <div style={{ flex: '1.2 1 0%' }} className="min-h-0">
                            <MultiViewVideoItem 
                                camera={cameras[0]} 
                                onRemove={() => onRemove(cameras[0].id)}
                                onError={handleStreamError}
                                onStatusChange={handleStatusChange}
                                initDelay={getInitDelay(0)}
                            />
                        </div>
                        <div style={{ flex: '0.8 1 0%' }} className="min-h-0 grid grid-cols-2 gap-2 sm:gap-3">
                            {cameras.slice(1).map((c, index) => (
                                <MultiViewVideoItem 
                                    key={c.id} 
                                    camera={c} 
                                    onRemove={() => onRemove(c.id)}
                                    onError={handleStreamError}
                                    onStatusChange={handleStatusChange}
                                    initDelay={getInitDelay(index + 1)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


// ============================================
// NAVBAR - Enhanced with live indicator
// Disables animations on low-end devices - **Validates: Requirements 5.2**
// ============================================
function Navbar({ cameraCount }) {
    const { isDark, toggleTheme } = useTheme();
    const [currentTime, setCurrentTime] = useState(new Date());
    const disableAnimations = shouldDisableAnimations();
    
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);
    
    return (
        <nav className="sticky top-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo - SEO optimized with proper heading structure */}
                    <a href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity" title="CCTV Bojonegoro Online - RAF NET">
                        <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/30">
                                <Icons.Camera />
                            </div>
                            {cameraCount > 0 && (
                                <span className={`absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-gray-900 ${disableAnimations ? '' : 'animate-pulse'}`}></span>
                            )}
                        </div>
                        <div>
                            <span className="text-lg font-bold text-gray-900 dark:text-white">RAF NET</span>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-0.5">CCTV Bojonegoro Online</p>
                        </div>
                    </a>
                    
                    {/* Center - Live Time with Location */}
                    <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-xl bg-gray-100/80 dark:bg-gray-800/80">
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full bg-emerald-500 ${disableAnimations ? '' : 'animate-pulse'}`}></span>
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">LIVE</span>
                        </div>
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Bojonegoro</span>
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <span className="text-sm font-mono text-gray-600 dark:text-gray-300">
                            {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                    </div>
                    
                    {/* Right - Theme Toggle */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleTheme}
                            className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                            aria-label={isDark ? 'Aktifkan Mode Terang' : 'Aktifkan Mode Gelap'}
                        >
                            {isDark ? <Icons.Sun /> : <Icons.Moon />}
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
}

// ============================================
// FILTER DROPDOWN - Enhanced with hierarchical filtering
// ============================================
function FilterDropdown({ areas, selected, onChange, cameras, kecamatans = [], kelurahans = [] }) {
    const [open, setOpen] = useState(false);
    const [filterType, setFilterType] = useState('area'); // 'area', 'kecamatan', 'kelurahan'
    const ref = useRef(null);

    useEffect(() => {
        const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);
    
    // Count cameras per filter
    const getCameraCount = (type, value) => {
        if (!value) return cameras.length;
        if (type === 'area') return cameras.filter(c => c.area_id === value).length;
        if (type === 'kecamatan') return cameras.filter(c => c.kecamatan === value).length;
        if (type === 'kelurahan') return cameras.filter(c => c.kelurahan === value).length;
        return 0;
    };

    const getSelectedLabel = () => {
        if (!selected) return 'All Cameras';
        if (selected.type === 'area') {
            const area = areas.find(a => a.id === selected.value);
            return area?.name || 'Unknown';
        }
        return selected.value;
    };

    const handleSelect = (type, value) => {
        onChange(value ? { type, value } : null);
        setOpen(false);
    };
    
    // Determine which tabs to show
    const showAreaTab = areas.length > 0;
    const showKecamatanTab = kecamatans.length > 0;
    const showKelurahanTab = kelurahans.length > 0;
    
    // Auto-select first available tab
    useEffect(() => {
        if (filterType === 'area' && !showAreaTab) {
            if (showKecamatanTab) setFilterType('kecamatan');
            else if (showKelurahanTab) setFilterType('kelurahan');
        }
    }, [filterType, showAreaTab, showKecamatanTab, showKelurahanTab]);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-sky-500 transition-colors shadow-sm"
            >
                <Icons.Filter />
                <span className="text-sm font-medium max-w-[150px] truncate">{getSelectedLabel()}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold">
                    {selected ? getCameraCount(selected.type, selected.value) : cameras.length}
                </span>
                <Icons.ChevronDown />
            </button>
            {open && (
                <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 z-50 max-h-96 overflow-hidden flex flex-col">
                    {/* Filter Type Tabs */}
                    <div className="px-2 pb-2 border-b border-gray-100 dark:border-gray-700 flex gap-1">
                        {showAreaTab && (
                            <button
                                onClick={() => setFilterType('area')}
                                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                    filterType === 'area' 
                                        ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400' 
                                        : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                            >
                                Area ({areas.length})
                            </button>
                        )}
                        {showKecamatanTab && (
                            <button
                                onClick={() => setFilterType('kecamatan')}
                                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                    filterType === 'kecamatan' 
                                        ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400' 
                                        : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                            >
                                Kecamatan ({kecamatans.length})
                            </button>
                        )}
                        {showKelurahanTab && (
                            <button
                                onClick={() => setFilterType('kelurahan')}
                                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                    filterType === 'kelurahan' 
                                        ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400' 
                                        : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                            >
                                Kelurahan ({kelurahans.length})
                            </button>
                        )}
                    </div>

                    {/* Options */}
                    <div className="overflow-y-auto flex-1">
                        {/* All option */}
                        <button
                            onClick={() => handleSelect(null, null)}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between transition-colors ${!selected ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                        >
                            <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                                All Cameras
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                {cameras.length}
                            </span>
                        </button>

                        {/* Filter by Area */}
                        {filterType === 'area' && areas.map(area => {
                            const count = getCameraCount('area', area.id);
                            const isSelected = selected?.type === 'area' && selected?.value === area.id;
                            return (
                                <button
                                    key={area.id}
                                    onClick={() => handleSelect('area', area.id)}
                                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between transition-colors ${isSelected ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <span className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-sky-500' : 'bg-purple-500'}`}></span>
                                            <span className="truncate">{area.name}</span>
                                        </span>
                                        {(area.kelurahan || area.kecamatan) && (
                                            <span className="text-[10px] text-gray-400 ml-4 block truncate">
                                                {[area.rt && `RT ${area.rt}`, area.rw && `RW ${area.rw}`, area.kelurahan, area.kecamatan].filter(Boolean).join(', ')}
                                            </span>
                                        )}
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${count > 0 ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-400'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}

                        {/* Filter by Kecamatan */}
                        {filterType === 'kecamatan' && kecamatans.map(kec => {
                            const count = getCameraCount('kecamatan', kec);
                            const isSelected = selected?.type === 'kecamatan' && selected?.value === kec;
                            return (
                                <button
                                    key={kec}
                                    onClick={() => handleSelect('kecamatan', kec)}
                                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between transition-colors ${isSelected ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                                >
                                    <span className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-sky-500' : 'bg-blue-500'}`}></span>
                                        <span className="truncate">{kec}</span>
                                    </span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${count > 0 ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-400'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}

                        {/* Filter by Kelurahan */}
                        {filterType === 'kelurahan' && kelurahans.map(kel => {
                            const count = getCameraCount('kelurahan', kel);
                            const isSelected = selected?.type === 'kelurahan' && selected?.value === kel;
                            // Find kecamatan for this kelurahan
                            const kec = cameras.find(c => c.kelurahan === kel)?.kecamatan || areas.find(a => a.kelurahan === kel)?.kecamatan;
                            return (
                                <button
                                    key={kel}
                                    onClick={() => handleSelect('kelurahan', kel)}
                                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between transition-colors ${isSelected ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <span className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-sky-500' : 'bg-green-500'}`}></span>
                                            <span className="truncate">{kel}</span>
                                        </span>
                                        {kec && <span className="text-[10px] text-gray-400 ml-4 block">{kec}</span>}
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${count > 0 ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-400'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// CAMERAS SECTION
// ============================================
function CamerasSection({ cameras, loading, areas, onCameraClick, onAddMulti, multiCameras }) {
    const [filter, setFilter] = useState(null);
    const [connectionTab, setConnectionTab] = useState('stable'); // 'all', 'stable', 'tunnel' - default to stable
    
    // Get unique kecamatan and kelurahan from cameras directly (in case areas table is empty)
    const kecamatansFromCameras = [...new Set(cameras.map(c => c.kecamatan).filter(Boolean))].sort();
    const kelurahansFromCameras = [...new Set(cameras.map(c => c.kelurahan).filter(Boolean))].sort();
    
    // Merge with areas data
    const kecamatansFromAreas = [...new Set(areas.map(a => a.kecamatan).filter(Boolean))];
    const kelurahansFromAreas = [...new Set(areas.map(a => a.kelurahan).filter(Boolean))];
    
    const allKecamatans = [...new Set([...kecamatansFromCameras, ...kecamatansFromAreas])].sort();
    const allKelurahans = [...new Set([...kelurahansFromCameras, ...kelurahansFromAreas])].sort();
    
    // Check if we have any filter data
    const hasFilterData = areas.length > 0 || allKecamatans.length > 0 || allKelurahans.length > 0;
    
    // Count cameras by connection type
    const tunnelCameras = cameras.filter(c => c.is_tunnel === 1);
    const stableCameras = cameras.filter(c => c.is_tunnel !== 1);
    const hasTunnelCameras = tunnelCameras.length > 0;
    
    // Filter cameras based on selected filter and connection tab
    const filtered = (() => {
        let result = cameras;
        
        // First filter by connection type
        if (connectionTab === 'stable') {
            result = result.filter(c => c.is_tunnel !== 1);
        } else if (connectionTab === 'tunnel') {
            result = result.filter(c => c.is_tunnel === 1);
        }
        
        // Then filter by area/location
        if (!filter) return result;
        if (filter.type === 'area') return result.filter(c => c.area_id === filter.value);
        if (filter.type === 'kecamatan') return result.filter(c => c.kecamatan === filter.value);
        if (filter.type === 'kelurahan') return result.filter(c => c.kelurahan === filter.value);
        return result;
    })();

    const getTitle = () => {
        if (connectionTab === 'tunnel') return 'Kamera Tunnel';
        if (connectionTab === 'stable') return 'Kamera Stabil';
        if (!filter) return 'Live Cameras';
        if (filter.type === 'area') {
            const area = areas.find(a => a.id === filter.value);
            return area?.name || 'Cameras';
        }
        return filter.value;
    };

    const getSubtitle = () => {
        if (connectionTab === 'tunnel') {
            return `${filtered.length} kamera dengan koneksi tunnel`;
        }
        if (connectionTab === 'stable') {
            return `${filtered.length} kamera dengan koneksi stabil`;
        }
        if (!filter) return `${filtered.length} camera${filtered.length !== 1 ? 's' : ''} available`;
        const typeLabel = filter.type === 'area' ? '' : filter.type === 'kecamatan' ? 'Kecamatan ' : 'Kelurahan ';
        return `${filtered.length} camera${filtered.length !== 1 ? 's' : ''} in ${typeLabel}${filter.type === 'area' ? 'this area' : filter.value}`;
    };

    return (
        <section className="py-8 sm:py-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Connection Type Tabs - Only show if there are tunnel cameras */}
                {hasTunnelCameras && (
                    <div className="mb-6">
                        <div className="flex flex-wrap gap-2 p-1.5 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
                            <button
                                onClick={() => setConnectionTab('all')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                    connectionTab === 'all'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                            >
                                Semua ({cameras.length})
                            </button>
                            <button
                                onClick={() => setConnectionTab('stable')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                                    connectionTab === 'stable'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                            >
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                Stabil ({stableCameras.length})
                            </button>
                            <button
                                onClick={() => setConnectionTab('tunnel')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                                    connectionTab === 'tunnel'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                            >
                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                Tunnel ({tunnelCameras.length})
                            </button>
                        </div>
                        
                        {/* Tunnel Warning Info */}
                        {connectionTab === 'tunnel' && (
                            <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
                                            ⚠️ Koneksi Tunnel - Kurang Stabil
                                        </h4>
                                        <p className="text-sm text-amber-700 dark:text-amber-400">
                                            Kamera-kamera ini menggunakan koneksi tunnel yang mungkin kurang stabil. 
                                            Jika stream tidak muncul atau terputus, silakan coba refresh atau tunggu beberapa saat.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                            {getTitle()}
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                            {getSubtitle()}
                        </p>
                    </div>
                    {hasFilterData && (
                        <FilterDropdown 
                            areas={areas} 
                            selected={filter} 
                            onChange={setFilter}
                            cameras={cameras}
                            kecamatans={allKecamatans}
                            kelurahans={allKelurahans}
                        />
                    )}
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                        {[1, 2, 3, 4, 5, 6].map(i => <CameraSkeleton key={i} />)}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400">
                            <Icons.Camera />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Cameras Found</h3>
                        <p className="text-gray-500 dark:text-gray-400 mb-4">
                            {connectionTab === 'tunnel' 
                                ? 'Tidak ada kamera dengan koneksi tunnel.' 
                                : connectionTab === 'stable'
                                    ? 'Tidak ada kamera dengan koneksi stabil.'
                                    : filter 
                                        ? 'No cameras available in this location.' 
                                        : 'No cameras available.'}
                        </p>
                        {(filter || connectionTab !== 'all') && (
                            <button 
                                onClick={() => { setFilter(null); setConnectionTab('all'); }}
                                className="text-sky-500 font-medium hover:text-sky-600 transition-colors"
                            >
                                View All Cameras →
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                        {filtered.map(camera => (
                            <CameraCard
                                key={camera.id}
                                camera={camera}
                                onClick={() => onCameraClick(camera)}
                                onAddMulti={() => onAddMulti(camera)}
                                inMulti={multiCameras.some(c => c.id === camera.id)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

// ============================================
// FOOTER - Enhanced with more information
// ============================================
function Footer({ cameraCount, areaCount }) {
    const whatsappNumber = '6289685645956'; // Format internasional tanpa +
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=Halo%20Admin%20RAF%20NET`;
    
    return (
        <footer className="py-10 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* About RAF NET Section */}
                <div className="mb-8 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-50 dark:bg-sky-500/10 mb-4">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white">
                            <Icons.Camera />
                        </div>
                        <span className="font-bold text-sky-600 dark:text-sky-400">RAF NET</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                        Penyedia Internet & Jasa Pasang CCTV Bojonegoro
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-4">
                        RAF NET melayani pemasangan WiFi dan CCTV di wilayah Bojonegoro. 
                        Pantau CCTV publik secara gratis melalui website ini.
                    </p>
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                        <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                            <circle cx="12" cy="11" r="3"/>
                        </svg>
                        <span className="text-sm text-emerald-700 dark:text-emerald-400">
                            Area layanan: <strong>Dander</strong> & <strong>Tanjungharjo</strong>
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    {/* Brand */}
                    <div className="text-center md:text-left">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Layanan Kami</h4>
                        <ul className="text-sm text-gray-500 dark:text-gray-400 space-y-1.5">
                            <li>• Pemasangan WiFi rumah & kantor</li>
                            <li>• Instalasi CCTV</li>
                            <li>• Monitoring CCTV online 24 jam</li>
                        </ul>
                    </div>
                    
                    {/* Stats */}
                    <div className="text-center">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Statistik</h4>
                        <div className="flex justify-center gap-6">
                            <div>
                                <p className="text-2xl font-bold text-sky-500">{cameraCount}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Kamera</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-purple-500">{areaCount}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Lokasi</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-emerald-500">24/7</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Online</p>
                            </div>
                        </div>
                    </div>
                    
                    {/* Contact */}
                    <div className="text-center md:text-right">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Hubungi Kami</h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                            Butuh WiFi atau CCTV?
                        </p>
                        <a
                            href={whatsappLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-5 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl transition-colors shadow-lg shadow-green-500/30"
                        >
                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                            </svg>
                            <span className="font-medium">WhatsApp</span>
                        </a>
                    </div>
                </div>

                {/* Features */}
                <div className="flex flex-wrap justify-center gap-2 mb-6">
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">WiFi Rumah</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Pasang CCTV</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">HD Streaming</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Multi-View</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Gratis Akses</span>
                </div>
                
                {/* SEO Keywords Section */}
                <div className="text-center mb-4">
                    <p className="text-[10px] text-gray-400 dark:text-gray-600">
                        Pasang WiFi Bojonegoro • Jasa CCTV Bojonegoro • Internet Dander • Internet Tanjungharjo • CCTV Online Bojonegoro • RAF NET
                    </p>
                </div>
                
                <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-center text-gray-400 dark:text-gray-500 text-xs">
                        © {new Date().getFullYear()} RAF NET • Penyedia Internet & CCTV Bojonegoro
                    </p>
                </div>
            </div>
        </footer>
    );
}

// ============================================
// MULTI-VIEW FLOATING BUTTON - Enhanced with tooltip and device-based limit
// Disables animations on low-end devices - **Validates: Requirements 5.2**
// Position: bottom-left to avoid collision with FeedbackWidget (bottom-right)
// ============================================
function MultiViewButton({ count, onClick, maxReached, maxStreams = 3 }) {
    const disableAnimations = shouldDisableAnimations();
    
    return (
        <div className="fixed bottom-6 left-6 z-40 flex flex-col items-start gap-2">
            {/* Info tooltip when max reached */}
            {maxReached && (
                <div className={`bg-amber-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg ${disableAnimations ? '' : 'animate-bounce'}`}>
                    Maximum {maxStreams} cameras reached!
                </div>
            )}
            
            {count > 0 && (
                <button
                    onClick={onClick}
                    className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all"
                >
                    <Icons.Layout />
                    <span className="font-bold">Multi-View</span>
                    <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">{count}</span>
                </button>
            )}
            
            {/* Help text */}
            {count === 0 && (
                <div className="bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs px-3 py-2 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 max-w-[200px] text-left">
                    <p className="font-medium mb-1">💡 Multi-View Mode</p>
                    <p className="text-gray-500 dark:text-gray-400">Click the + button on cameras to view up to {maxStreams} streams simultaneously</p>
                </div>
            )}
        </div>
    );
}

// ============================================
// STATS BAR - Integrated into Hero section
// ============================================
function StatsBar({ cameras, areas }) {
    const totalCameras = cameras.length;
    const totalAreas = areas.length;
    const kecamatans = [...new Set(cameras.map(c => c.kecamatan).filter(Boolean))].length;
    
    if (totalCameras === 0) return null;
    
    return (
        <div className="flex flex-wrap justify-center gap-3 sm:gap-6 mt-8 pt-6 border-t border-gray-200/50 dark:border-gray-700/50">
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                    <span className="text-white font-bold text-lg">{totalCameras}</span>
                </div>
                <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Active</p>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Cameras</p>
                </div>
            </div>
            {totalAreas > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm shadow-sm">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
                        <span className="text-white font-bold text-lg">{totalAreas}</span>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Monitoring</p>
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Areas</p>
                    </div>
                </div>
            )}
            {kecamatans > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm shadow-sm">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                        <span className="text-white font-bold text-lg">{kecamatans}</span>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Coverage</p>
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Kecamatan</p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// MAIN LANDING PAGE
// ============================================
export default function LandingPage() {
    const [cameras, setCameras] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [popup, setPopup] = useState(null);
    const [multiCameras, setMultiCameras] = useState([]);
    const [showMulti, setShowMulti] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [maxReached, setMaxReached] = useState(false);
    
    // Device-based stream limit
    const [deviceTier] = useState(() => detectDeviceTier());
    const maxStreams = getMaxConcurrentStreams(deviceTier);

    // Server connectivity state - **Validates: Requirements 3.1, 3.2, 3.5**
    const [serverStatus, setServerStatus] = useState('checking'); // 'checking', 'online', 'offline'
    const [serverLatency, setServerLatency] = useState(-1);

    // Toast helper functions
    const addToast = useCallback((message, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Preload HLS.js immediately on mount - **Validates: Requirements 2.1, 5.5**
    useEffect(() => {
        // Start preloading HLS.js in background immediately
        preloadHls().catch((err) => {
            console.warn('HLS.js preload failed:', err);
        });
    }, []);

    // Check MediaMTX server connectivity - **Validates: Requirements 3.1, 3.2, 3.5**
    // Note: We test the API endpoint instead of /hls/ because /hls/ returns 404 (no index file)
    useEffect(() => {
        const checkServerConnectivity = async () => {
            try {
                // Test the API health endpoint instead of HLS base path
                // The /hls/ path returns 404 because there's no index file
                // But if the API is reachable, MediaMTX should be too (same server)
                let apiUrl;
                
                if (window.location.protocol === 'https:') {
                    const hostname = window.location.hostname;
                    if (hostname === 'cctv.raf.my.id') {
                        apiUrl = 'https://api-cctv.raf.my.id/health';
                    } else {
                        apiUrl = `${window.location.protocol}//${hostname.replace('cctv.', 'api-cctv.')}/health`;
                    }
                } else {
                    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
                    apiUrl = `${baseUrl.replace(/\/$/, '')}/health`;
                }
                
                const result = await testMediaMTXConnection(apiUrl);
                
                if (result.reachable) {
                    setServerStatus('online');
                    setServerLatency(result.latency);
                } else {
                    setServerStatus('offline');
                    console.warn('MediaMTX server unreachable:', result.error);
                }
            } catch (err) {
                setServerStatus('offline');
                console.error('Server connectivity check failed:', err);
            }
        };

        checkServerConnectivity();
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch cameras and areas in parallel
                const [camsRes, areasRes] = await Promise.all([
                    streamService.getAllActiveStreams(),
                    areaService.getPublicAreas().catch(() => ({ success: false, data: [] }))
                ]);
                
                setCameras(camsRes.data || []);
                setAreas(areasRes.data || []);
                
                // Show welcome toast if cameras loaded
                if (camsRes.data?.length > 0) {
                    addToast(`${camsRes.data.length} live cameras ready to view`, 'success');
                }
            } catch (err) {
                console.error('Failed to fetch data:', err);
                addToast('Failed to load cameras. Please refresh the page.', 'error');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [addToast]);

    const handleAddMulti = useCallback((camera) => {
        setMultiCameras(prev => {
            const exists = prev.some(c => c.id === camera.id);
            
            // If already in multi-view, remove it
            if (exists) {
                addToast(`"${camera.name}" removed from Multi-View`, 'info');
                setMaxReached(false);
                return prev.filter(c => c.id !== camera.id);
            }
            
            // Check if max reached (device-based limit)
            if (prev.length >= maxStreams) {
                addToast(`Maximum ${maxStreams} cameras allowed in Multi-View mode (${deviceTier}-end device)`, 'warning');
                setMaxReached(true);
                setTimeout(() => setMaxReached(false), 3000);
                return prev;
            }
            
            // Add to multi-view
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

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
            <Navbar cameraCount={cameras.length} />
            
            {/* Hero Section - SEO optimized with Indonesian content */}
            <header className="relative overflow-hidden bg-gradient-to-br from-sky-500/10 via-transparent to-purple-500/10 dark:from-sky-500/5 dark:to-purple-500/5">
                {/* Decorative elements */}
                <div className="absolute top-0 left-1/4 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
                
                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 text-center">
                    {/* RAF NET Badge */}
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 text-xs font-semibold mb-3 shadow-sm">
                        <div className="w-5 h-5 rounded bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white text-[10px] font-bold">R</div>
                        <span>Powered by RAF NET</span>
                    </div>
                    
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold mb-4 shadow-sm">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        LIVE STREAMING 24 JAM
                    </div>
                    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-4">
                        CCTV <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-blue-600">Bojonegoro</span> Online
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-3 text-sm sm:text-base">
                        Pantau keamanan wilayah Bojonegoro secara real-time dengan sistem CCTV <strong className="text-sky-600 dark:text-sky-400">RAF NET</strong>. 
                        Akses gratis 24 jam untuk memantau berbagai lokasi di Bojonegoro, Jawa Timur.
                    </p>
                    <p className="text-gray-500 dark:text-gray-500 max-w-xl mx-auto mb-6 text-xs">
                        Layanan pemantauan CCTV publik oleh RAF NET untuk keamanan dan kenyamanan warga Bojonegoro
                    </p>
                    
                    {/* Area Coverage Info */}
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 mb-6">
                        <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                            <circle cx="12" cy="11" r="3"/>
                        </svg>
                        <span className="text-sm text-amber-700 dark:text-amber-400">
                            Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>
                        </span>
                    </div>
                    
                    {/* Quick Features - Enhanced with Indonesian labels */}
                    <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400">
                                <Icons.Eye />
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">HD Streaming</span>
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                                <Icons.Grid />
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Multi-View</span>
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                <Icons.Shield />
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Secure</span>
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                                <Icons.Clock />
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">24/7 Live</span>
                        </div>
                    </div>
                    
                    {/* Stats Bar - Integrated into Hero */}
                    <StatsBar cameras={cameras} areas={areas} />
                </div>
            </header>

            <CamerasSection
                cameras={cameras}
                loading={loading}
                areas={areas}
                onCameraClick={setPopup}
                onAddMulti={handleAddMulti}
                multiCameras={multiCameras}
            />

            <div className="flex-1" />
            <Footer cameraCount={cameras.length} areaCount={areas.length} />

            <MultiViewButton 
                count={multiCameras.length} 
                onClick={() => setShowMulti(true)} 
                maxReached={maxReached}
                maxStreams={maxStreams}
            />

            {/* Toast Notifications */}
            <ToastContainer toasts={toasts} removeToast={removeToast} />

            {popup && <VideoPopup camera={popup} onClose={() => setPopup(null)} />}
            {showMulti && multiCameras.length > 0 && (
                <MultiViewLayout
                    cameras={multiCameras}
                    onRemove={handleRemoveMulti}
                    onClose={() => setShowMulti(false)}
                />
            )}
            
            {/* Feedback Widget */}
            <FeedbackWidget />
        </div>
    );
}
