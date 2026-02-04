import { useEffect, useState, useCallback, useRef, memo, lazy, Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { streamService } from '../services/streamService';
import { areaService } from '../services/areaService';
import { viewerService } from '../services/viewerService';
import { getPublicSaweriaConfig } from '../services/saweriaService';
import { useTheme } from '../contexts/ThemeContext';
import { useBranding } from '../contexts/BrandingContext';
import { updateMetaTags } from '../utils/metaUpdater';
import { createTransformThrottle } from '../utils/rafThrottle';
import { detectDeviceTier, getMaxConcurrentStreams, isMobileDevice, getMobileDeviceType } from '../utils/deviceDetector';
import { getHLSConfig } from '../utils/hlsConfig';
import { DEFAULT_STAGGER_DELAY } from '../utils/multiViewManager';
import Hls from 'hls.js';
import { testMediaMTXConnection } from '../utils/connectionTester';
import { createLoadingTimeoutHandler } from '../utils/loadingTimeoutHandler';
import { LoadingStage, getStageMessage, createStreamError } from '../utils/streamLoaderTypes';
import { createFallbackHandler } from '../utils/fallbackHandler';
import { shouldDisableAnimations } from '../utils/animationControl';
import { getGlobalStreamInitQueue, shouldUseQueuedInit } from '../utils/streamInitQueue';
import { getApiUrl } from '../config/config.js';
import { takeSnapshot as takeSnapshotUtil } from '../utils/snapshotHelper';
// Skeleton loaders
import { GridSkeleton, CameraCardSkeleton } from '../components/ui/Skeleton';
// Empty states
import { NoSearchResultsEmptyState, NoDataWithFilterEmptyState } from '../components/ui/EmptyState';
// Feedback widget
import FeedbackWidget from '../components/FeedbackWidget';
// Saweria Support
import SaweriaSupport from '../components/SaweriaSupport';
// Saweria Leaderboard
import SaweriaLeaderboard from '../components/SaweriaLeaderboard';
// Codec Badge
import CodecBadge from '../components/CodecBadge';
import { canPlayCodec } from '../utils/codecSupport';
// Camera Thumbnail
import CameraThumbnail from '../components/CameraThumbnail';
// Layout components
import LandingPageSimple from '../components/LandingPageSimple';
// Map view - lazy loaded for performance
const MapView = lazy(() => import('../components/MapView'));
// Playback - lazy loaded for performance
const Playback = lazy(() => import('./Playback'));

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




// ============================================
// ICONS - Extended
// ============================================
const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    Camera: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>,
    X: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>,
    Search: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
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
    Map: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>,
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
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[1002] flex flex-col gap-3 w-full max-w-sm px-4">
            {toasts.map(toast => (
                <Toast key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
            ))}
        </div>
    );
}

// ============================================
// CAMERA STATUS TRACKER HOOK - Tracks camera status changes
// Notifies when cameras go offline/online
// ============================================
function useCameraStatusTracker(cameras, addToast) {
    const prevCamerasRef = useRef(null);
    const isFirstLoadRef = useRef(true);
    
    useEffect(() => {
        // Skip first load - don't notify on initial data fetch
        if (isFirstLoadRef.current) {
            if (cameras.length > 0) {
                prevCamerasRef.current = new Map(cameras.map(c => [c.id, { 
                    is_online: c.is_online, 
                    status: c.status,
                    name: c.name 
                }]));
                isFirstLoadRef.current = false;
            }
            return;
        }
        
        if (!prevCamerasRef.current || cameras.length === 0) return;
        
        const prevMap = prevCamerasRef.current;
        const changes = { wentOffline: [], wentOnline: [], wentMaintenance: [] };
        
        cameras.forEach(camera => {
            const prev = prevMap.get(camera.id);
            if (!prev) return; // New camera, skip
            
            const wasOnline = prev.is_online !== 0 && prev.status !== 'maintenance';
            const isOnline = camera.is_online !== 0 && camera.status !== 'maintenance';
            const wasMaintenance = prev.status === 'maintenance';
            const isMaintenance = camera.status === 'maintenance';
            
            // Check for status changes
            if (wasOnline && !isOnline && !isMaintenance) {
                changes.wentOffline.push(camera.name);
            } else if (!wasOnline && isOnline && !wasMaintenance) {
                changes.wentOnline.push(camera.name);
            } else if (!wasMaintenance && isMaintenance) {
                changes.wentMaintenance.push(camera.name);
            }
        });
        
        // Show notifications for changes
        if (changes.wentOffline.length > 0) {
            if (changes.wentOffline.length === 1) {
                addToast(`${changes.wentOffline[0]} sedang offline`, 'warning');
            } else {
                addToast(`${changes.wentOffline.length} kamera sedang offline`, 'warning');
            }
        }
        
        if (changes.wentOnline.length > 0) {
            if (changes.wentOnline.length === 1) {
                addToast(`${changes.wentOnline[0]} kembali online`, 'success');
            } else {
                addToast(`${changes.wentOnline.length} kamera kembali online`, 'success');
            }
        }
        
        if (changes.wentMaintenance.length > 0) {
            if (changes.wentMaintenance.length === 1) {
                addToast(`${changes.wentMaintenance[0]} dalam perbaikan`, 'info');
            } else {
                addToast(`${changes.wentMaintenance.length} kamera dalam perbaikan`, 'info');
            }
        }
        
        // Update previous state
        prevCamerasRef.current = new Map(cameras.map(c => [c.id, { 
            is_online: c.is_online, 
            status: c.status,
            name: c.name 
        }]));
        
    }, [cameras, addToast]);
}

// ============================================
// CAMERA CARD - Optimized for low-end devices with tunnel indicator
// Reduced animations, simplified rendering, added tunnel badge next to LIVE
// **Validates: Requirements 5.2, 7.1**
// ============================================
const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti }) {
    const isMaintenance = camera.status === 'maintenance';
    const isOffline = camera.is_online === 0;
    const isTunnel = camera.is_tunnel === 1;
    const disableAnimations = shouldDisableAnimations();
    
    // Pre-computed styles to avoid recalculation on each render
    const cardStyle = isMaintenance 
        ? 'ring-red-500/50 hover:ring-red-500' 
        : isOffline 
            ? 'ring-gray-400/50 hover:ring-gray-500' 
            : 'ring-gray-200 dark:ring-gray-800 hover:ring-sky-500/50';
    
    const bgStyle = isMaintenance 
        ? 'bg-red-100 dark:bg-red-900/30' 
        : isOffline 
            ? 'bg-gray-200 dark:bg-gray-700' 
            : 'bg-gray-100 dark:bg-gray-800';
    
    const iconStyle = isMaintenance 
        ? 'text-red-300 dark:text-red-700' 
        : isOffline 
            ? 'text-gray-400 dark:text-gray-600' 
            : 'text-gray-300 dark:text-gray-700';
    
    // Simplified transition classes for low-end devices
    const transitionClass = disableAnimations ? '' : 'transition-all duration-200';
    const hoverTransform = disableAnimations ? '' : 'hover:-translate-y-1';
    
    return (
        <div className={`relative rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg ring-1 ${transitionClass} ${hoverTransform} group/card ${cardStyle}`}>
            {/* Multi-view button - simplified for low-end */}
            <button
                onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                className={`absolute top-3 right-3 z-30 p-2.5 rounded-xl shadow-lg ${
                    inMulti 
                        ? 'bg-emerald-500 text-white' 
                        : 'bg-white/90 dark:bg-gray-800/90 text-gray-600 dark:text-gray-300'
                } ${disableAnimations ? '' : 'transition-colors hover:bg-sky-500 hover:text-white'}`}
                title={inMulti ? 'Hapus dari Multi-View' : 'Tambah ke Multi-View'}
            >
                {inMulti ? <Icons.Check /> : <Icons.Plus />}
            </button>
            
            {/* Video thumbnail area */}
            <div onClick={onClick} className={`aspect-video relative cursor-pointer overflow-hidden ${bgStyle}`}>
                {/* Thumbnail image */}
                <CameraThumbnail
                    cameraId={camera.id}
                    thumbnailPath={camera.thumbnail_path}
                    cameraName={camera.name}
                    isMaintenance={isMaintenance}
                    isOffline={isOffline}
                />
                
                {/* Play overlay - only for online cameras, disabled on low-end */}
                {!isMaintenance && !isOffline && !disableAnimations && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 bg-black/40 transition-opacity">
                        <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center text-sky-500 shadow-xl">
                            <Icons.Play />
                        </div>
                    </div>
                )}
                
                {/* Status badges - LIVE with Tunnel indicator and Recording */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    {isMaintenance ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-600/90 text-white text-[10px] font-bold shadow-lg">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
                            </svg>
                            PERBAIKAN
                        </span>
                    ) : isOffline ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-600/90 text-white text-[10px] font-bold shadow-lg">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072"/>
                            </svg>
                            OFFLINE
                        </span>
                    ) : (
                        <>
                            {/* LIVE badge */}
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/90 text-white text-[10px] font-bold shadow-lg">
                                <span className="relative flex h-1.5 w-1.5">
                                    {!disableAnimations && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>}
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                                </span>
                                LIVE
                            </span>
                            {/* Recording badge - shown if camera is recording */}
                            {camera.is_recording && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-600/90 text-white text-[10px] font-bold shadow-lg" title="Sedang merekam">
                                    <span className="relative flex h-1.5 w-1.5">
                                        {!disableAnimations && <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>}
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                                    </span>
                                    REC
                                </span>
                            )}
                            {/* Tunnel badge - shown next to LIVE if tunnel connection */}
                            {isTunnel && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-orange-500/90 text-white text-[10px] font-bold shadow-lg" title="Koneksi Tunnel - mungkin kurang stabil">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0"/>
                                    </svg>
                                    TUNNEL
                                </span>
                            )}
                        </>
                    )}
                </div>
                
                {/* Offline indicator at bottom left */}
                {isOffline && !isMaintenance && (
                    <div className="absolute bottom-3 left-3">
                        <span className="px-2 py-1 rounded-lg bg-gray-800/80 text-gray-300 text-[10px] font-medium">
                            Tidak tersedia
                        </span>
                    </div>
                )}
                
                {/* Area badge */}
                {camera.area_name && (
                    <div className={`absolute bottom-3 ${isOffline && !isMaintenance ? 'right-3' : 'left-3'}`}>
                        <span className="px-2 py-1 rounded-lg bg-black/60 text-white text-[10px] font-medium">
                            {camera.area_name}
                        </span>
                    </div>
                )}
            </div>
            
            {/* Camera info */}
            <div className="p-4 cursor-pointer" onClick={onClick}>
                <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className={`font-bold truncate flex-1 ${
                        isMaintenance 
                            ? 'text-red-600 dark:text-red-400' 
                            : 'text-gray-900 dark:text-white'
                    } ${!disableAnimations ? 'group-hover/card:text-sky-500 transition-colors' : ''}`}>
                        {camera.name}
                    </h3>
                    {camera.video_codec && (
                        <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                    )}
                </div>
                
                {/* Location */}
                {camera.location && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                        <Icons.MapPin />
                        <span className="truncate">{camera.location}</span>
                    </p>
                )}
            </div>
        </div>
    );
});

// ============================================
// ZOOMABLE VIDEO COMPONENT - Optimized for low-end devices
// Disables heavy features (willChange, RAF throttle) on low-end
// ============================================
const ZoomableVideo = memo(function ZoomableVideo({ videoRef, maxZoom = 4, onZoomChange, isFullscreen = false }) {
    const wrapperRef = useRef(null);
    const transformThrottleRef = useRef(null);
    const stateRef = useRef({ zoom: 1, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });
    const isLowEnd = detectDeviceTier() === 'low';

    const getMaxPan = (z) => z <= 1 ? 0 : ((z - 1) / (2 * z)) * 100;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // Initialize RAF throttle on mount - skip on low-end
    useEffect(() => {
        if (wrapperRef.current && !isLowEnd) {
            transformThrottleRef.current = createTransformThrottle(wrapperRef.current);
        }
        return () => {
            transformThrottleRef.current?.cancel();
        };
    }, [isLowEnd]);

    const applyTransform = useCallback((animate = false) => {
        if (!wrapperRef.current) return;
        const { zoom, panX, panY } = stateRef.current;
        
        if (animate && !isLowEnd) {
            wrapperRef.current.style.transition = 'transform 0.2s ease-out';
            wrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
        } else {
            wrapperRef.current.style.transition = 'none';
            // On low-end, apply directly without RAF throttle
            if (transformThrottleRef.current && !isLowEnd) {
                transformThrottleRef.current.update(zoom, panX, panY);
            } else {
                wrapperRef.current.style.transform = `scale(${zoom}) translate(${panX}%, ${panY}%)`;
            }
        }
        onZoomChange?.(zoom);
    }, [onZoomChange, isLowEnd]);

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
        
        // On low-end, apply directly without RAF throttle
        if (transformThrottleRef.current && !isLowEnd) {
            transformThrottleRef.current.update(s.zoom, s.panX, s.panY);
        } else {
            wrapperRef.current.style.transform = `scale(${s.zoom}) translate(${s.panX}%, ${s.panY}%)`;
        }
    }, [isLowEnd]);

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
                touchAction: 'none',
                // CRITICAL: willChange creates GPU layer - disable on low-end to reduce memory
                willChange: isLowEnd ? 'auto' : 'transform'
            }}
        >
            <video 
                ref={videoRef}
                className="w-full h-full pointer-events-none object-contain"
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
    const outerWrapperRef = useRef(null); // Add ref for outer wrapper
    const hlsRef = useRef(null);
    const loadingTimeoutHandlerRef = useRef(null);
    const fallbackHandlerRef = useRef(null);
    const abortControllerRef = useRef(null);
    const { branding } = useBranding(); // ← FIX: Add branding context
    
    // Handle close with fullscreen exit
    const handleClose = async () => {
        if (document.fullscreenElement) {
            try {
                await document.exitFullscreen?.();
                // Wait for fullscreen transition to complete
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error('Error exiting fullscreen:', error);
            }
        }
        onClose();
    };
    
    // Check camera status first
    const isMaintenance = camera.status === 'maintenance';
    const isOffline = camera.is_online === 0;
    
    // Set initial status based on camera state
    const getInitialStatus = () => {
        if (isMaintenance) return 'maintenance';
        if (isOffline) return 'offline';
        return 'connecting';
    };
    
    const [status, setStatus] = useState(getInitialStatus);
    const [loadingStage, setLoadingStage] = useState(LoadingStage.CONNECTING);
    const [errorType, setErrorType] = useState(null); // 'codec', 'network', 'timeout', 'media', 'unknown'
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [retryKey, setRetryKey] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [autoRetryCount, setAutoRetryCount] = useState(0);
    const [isAutoRetrying, setIsAutoRetrying] = useState(false);
    const [consecutiveFailures, setConsecutiveFailures] = useState(0);
    const [showTroubleshooting, setShowTroubleshooting] = useState(false);
    
    const url = camera.streams?.hls;
    const deviceTier = detectDeviceTier();

    // Error messages berdasarkan tipe - sama seperti MapView
    const getErrorInfo = () => {
        switch (errorType) {
            case 'codec':
                return {
                    title: 'Codec Tidak Didukung',
                    desc: 'Browser Anda tidak mendukung codec H.265/HEVC yang digunakan kamera ini. Coba gunakan browser lain seperti Safari.',
                    color: 'yellow',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                        </svg>
                    )
                };
            case 'network':
                return {
                    title: 'Koneksi Gagal',
                    desc: 'Tidak dapat terhubung ke server stream. Periksa koneksi internet Anda atau coba lagi nanti.',
                    color: 'orange',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
                        </svg>
                    )
                };
            case 'timeout':
                return {
                    title: 'Waktu Habis',
                    desc: 'Stream terlalu lama merespons. Kamera mungkin sedang offline atau jaringan lambat.',
                    color: 'gray',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                    )
                };
            case 'media':
                return {
                    title: 'Error Media',
                    desc: 'Terjadi kesalahan saat memutar video. Format stream mungkin tidak kompatibel dengan browser.',
                    color: 'purple',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                        </svg>
                    )
                };
            default:
                return {
                    title: 'CCTV Tidak Terkoneksi',
                    desc: 'Kamera sedang offline atau terjadi kesalahan. Coba lagi nanti.',
                    color: 'red',
                    icon: (
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    )
                };
        }
    };

    const errorColorClasses = {
        yellow: 'bg-yellow-500/20 text-yellow-400',
        orange: 'bg-orange-500/20 text-orange-400',
        gray: 'bg-gray-500/20 text-gray-400',
        purple: 'bg-purple-500/20 text-purple-400',
        red: 'bg-red-500/20 text-red-400',
    };

    // Track fullscreen state to disable animations and unlock orientation on exit
    useEffect(() => {
        const handleFullscreenChange = () => {
            const isNowFullscreen = !!document.fullscreenElement;
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
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
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

    // Viewer session tracking - track when user starts/stops watching
    useEffect(() => {
        // Don't track if camera is offline or in maintenance
        if (isMaintenance || isOffline) return;
        
        let sessionId = null;
        
        // Start viewer session
        const startTracking = async () => {
            try {
                sessionId = await viewerService.startSession(camera.id);
            } catch (error) {
                console.error('[VideoPopup] Failed to start viewer session:', error);
            }
        };
        
        startTracking();
        
        // Cleanup: stop session when popup closes
        return () => {
            if (sessionId) {
                viewerService.stopSession(sessionId).catch(err => {
                    console.error('[VideoPopup] Failed to stop viewer session:', err);
                });
            }
        };
    }, [camera.id, isMaintenance, isOffline]);

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
                setErrorType('timeout');
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
        // Skip HLS loading if camera is in maintenance or offline
        if (isMaintenance || isOffline) return;
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        let cancelled = false;
        let playbackCheckInterval = null;
        let isLive = false; // Flag to prevent setState after live

        abortControllerRef.current = new AbortController();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);

        // Start loading timeout - **Validates: Requirements 1.1**
        if (loadingTimeoutHandlerRef.current) {
            loadingTimeoutHandlerRef.current.startTimeout(LoadingStage.CONNECTING);
        }

        // Only change to 'live' once video starts playing - don't revert on buffering
        const handlePlaying = () => {
            if (cancelled || isLive) return; // Skip if already live
            isLive = true; // Set flag to prevent future setState
            clearInterval(playbackCheckInterval);
            playbackCheckInterval = null;
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
                if (cancelled || isLive) {
                    clearInterval(playbackCheckInterval);
                    playbackCheckInterval = null;
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
            if (cancelled || isLive) return; // Don't show error if already playing
            clearInterval(playbackCheckInterval);
            playbackCheckInterval = null;
            setStatus('error');
            setLoadingStage(LoadingStage.ERROR);
        };

        video.addEventListener('playing', handlePlaying);
        video.addEventListener('error', handleError);

        // Direct HLS.js usage - no lazy loading needed
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
                
                // Load source first, then attach media with small delay
                // This helps prevent media errors on some browsers
                hls.loadSource(url);
                setTimeout(() => {
                    if (!cancelled && hlsRef.current) {
                        hls.attachMedia(video);
                        startPlaybackCheck();
                    }
                }, 50);
                
                // Start playback check early - don't wait for events that may not fire
                startPlaybackCheck();
                
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    // Update to buffering stage
                    setLoadingStage(LoadingStage.BUFFERING);
                    if (loadingTimeoutHandlerRef.current) {
                        loadingTimeoutHandlerRef.current.updateStage(LoadingStage.BUFFERING);
                    }
                    video.play().catch(() => {});
                });
                
                // FRAG_LOADED fires when first fragment is loaded - more reliable than MANIFEST_PARSED
                hls.on(Hls.Events.FRAG_LOADED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    // If still in LOADING stage, move to BUFFERING
                    setLoadingStage(prev => {
                        if (prev === LoadingStage.LOADING || prev === LoadingStage.CONNECTING) {
                            if (loadingTimeoutHandlerRef.current) {
                                loadingTimeoutHandlerRef.current.updateStage(LoadingStage.BUFFERING);
                            }
                            return LoadingStage.BUFFERING;
                        }
                        return prev;
                    });
                    // Try to play
                    if (video.paused) {
                        video.play().catch(() => {});
                    }
                });

                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    // Langsung set PLAYING dan status live setelah buffered
                    handlePlaying(); // Use handlePlaying to set isLive flag
                });
                
                hls.on(Hls.Events.ERROR, (_, d) => {
                    if (cancelled || isLive) return; // Don't handle errors if already playing
                    
                    // For non-fatal errors, just continue
                    if (!d.fatal) return;
                    
                    // Clear loading timeout
                    if (loadingTimeoutHandlerRef.current) {
                        loadingTimeoutHandlerRef.current.clearTimeout();
                    }
                    
                    // Check for codec incompatibility - NOT recoverable
                    if (d.details === 'manifestIncompatibleCodecsError' ||
                        d.details === 'fragParsingError' ||
                        d.details === 'bufferAppendError' ||
                        d.reason?.includes('codec') ||
                        d.reason?.includes('HEVC') ||
                        d.reason?.includes('h265')) {
                        console.error('Browser tidak support codec H.265/HEVC. Ubah setting kamera ke H.264.');
                        setStatus('error');
                        setErrorType('codec');
                        setLoadingStage(LoadingStage.ERROR);
                        return;
                    }

                    const detectedErrorType = d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' :
                                      d.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'unknown';

                    // For media errors, try recovery (max 2 times)
                    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        if (!hls._mediaErrorRecoveryCount) hls._mediaErrorRecoveryCount = 0;
                        hls._mediaErrorRecoveryCount++;
                        
                        if (hls._mediaErrorRecoveryCount <= 2) {
                            hls.recoverMediaError();
                            return;
                        }
                    }

                    // Try auto-retry with FallbackHandler
                    if (fallbackHandlerRef.current) {
                        const streamError = createStreamError({
                            type: detectedErrorType,
                            message: d.details || 'Stream error',
                            stage: loadingStage,
                            deviceTier,
                            retryCount: autoRetryCount,
                        });

                        const result = fallbackHandlerRef.current.handleError(streamError, () => {
                            if (!cancelled && hls) {
                                setLoadingStage(LoadingStage.CONNECTING);
                                hls.destroy();
                                const newHls = new Hls(getDeviceAdaptiveHLSConfig());
                                hlsRef.current = newHls;
                                newHls.loadSource(url);
                                newHls.attachMedia(video);
                                
                                newHls.on(Hls.Events.MANIFEST_PARSED, () => {
                                    if (cancelled) return;
                                    setLoadingStage(LoadingStage.BUFFERING);
                                    video.play().catch(() => {});
                                });
                                
                                newHls.on(Hls.Events.ERROR, (_, d2) => {
                                    if (cancelled) return;
                                    if (d2.fatal) {
                                        setStatus('error');
                                        setErrorType(detectedErrorType);
                                        setLoadingStage(LoadingStage.ERROR);
                                    }
                                });
                            }
                        });

                        if (result.action === 'manual-retry-required') {
                            setStatus('error');
                            setErrorType(detectedErrorType);
                            setLoadingStage(LoadingStage.ERROR);
                        }
                    } else {
                        setStatus('error');
                        setErrorType(detectedErrorType);
                        setLoadingStage(LoadingStage.ERROR);
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
            }

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
        setErrorType(null);
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
            if (!document.fullscreenElement) {
                // Enter fullscreen
                await outerWrapperRef.current?.requestFullscreen?.();
                
                // Reset zoom to 1.0 when entering fullscreen to avoid "auto zoom" effect
                const wrapper = getZoomableWrapper();
                if (wrapper && wrapper._reset) {
                    wrapper._reset();
                }
                
                // Lock to landscape orientation on mobile
                if (screen.orientation && screen.orientation.lock) {
                    try {
                        await screen.orientation.lock('landscape').catch(() => {
                            // Fallback: try landscape-primary if landscape fails
                            screen.orientation.lock('landscape-primary').catch(() => {});
                        });
                    } catch (err) {
                        // Orientation lock not supported or failed, continue anyway
                        console.log('Orientation lock not supported');
                    }
                }
            } else {
                // Exit fullscreen
                await document.exitFullscreen?.();
                
                // Reset zoom when exiting fullscreen
                const wrapper = getZoomableWrapper();
                if (wrapper && wrapper._reset) {
                    wrapper._reset();
                }
                
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
    };

    const takeSnapshot = async () => {
        if (!videoRef.current || status !== 'live') return;
        
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
    };

    // Get wrapper ref for zoom controls - directly access ZoomableVideo wrapper
    const getZoomableWrapper = () => {
        // ZoomableVideo is the first child of wrapperRef
        return wrapperRef.current?.firstElementChild;
    };

    // Get status display info - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    const getStatusDisplay = () => {
        if (status === 'live') return { label: 'LIVE', color: 'bg-emerald-500/20 text-emerald-400', dotColor: 'bg-emerald-400' };
        if (status === 'maintenance') return { label: 'PERBAIKAN', color: 'bg-red-500/20 text-red-400', dotColor: 'bg-red-400' };
        if (status === 'offline') return { label: 'OFFLINE', color: 'bg-gray-500/20 text-gray-400', dotColor: 'bg-gray-400' };
        if (status === 'timeout') return { label: 'TIMEOUT', color: 'bg-amber-500/20 text-amber-400', dotColor: 'bg-amber-400' };
        if (status === 'error') return { label: 'ERROR', color: 'bg-red-500/20 text-red-400', dotColor: 'bg-red-400' };
        // Connecting states with progressive messages
        return { label: getStageMessage(loadingStage), color: 'bg-amber-500/20 text-amber-400', dotColor: 'bg-amber-400' };
    };

    const statusDisplay = getStatusDisplay();
    
    // Check if animations should be disabled on low-end devices - **Validates: Requirements 5.2**
    const disableAnimations = shouldDisableAnimations();

    return (
        <div ref={outerWrapperRef} className={`fixed inset-0 z-[9999] ${isFullscreen ? 'bg-black dark:bg-black' : 'flex items-center justify-center bg-black/95 dark:bg-black/95 p-2 sm:p-4'}`} onClick={onClose}>
            <div ref={modalRef} className={`relative bg-white dark:bg-gray-900 overflow-hidden shadow-2xl flex flex-col ${isFullscreen ? 'w-full h-full' : 'w-full max-w-5xl rounded-2xl border border-gray-200 dark:border-gray-800'}`} style={isFullscreen ? {} : { maxHeight: 'calc(100vh - 16px)' }} onClick={(e) => e.stopPropagation()}>
                
                {/* Header Info - di atas video (hide in fullscreen) */}
                {!isFullscreen && (
                    <div className="p-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <h3 className="text-gray-900 dark:text-white font-bold text-sm sm:text-base truncate">{camera.name}</h3>
                                {camera.video_codec && (
                                    <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                                )}
                            </div>
                            {/* Status badges */}
                            <div className="flex items-center gap-1 shrink-0">
                                {isMaintenance ? (
                                    <span className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold">Perbaikan</span>
                                ) : isOffline ? (
                                    <span className="px-1.5 py-0.5 rounded bg-gray-500 text-white text-[10px] font-bold">Offline</span>
                                ) : (
                                    <>
                                        <span className={`w-1.5 h-1.5 rounded-full bg-red-500 ${disableAnimations ? '' : 'animate-pulse'}`}/>
                                        <span className={`px-1.5 py-0.5 rounded text-white text-[10px] font-bold ${camera.is_tunnel ? 'bg-orange-500' : 'bg-emerald-500'}`}>
                                            {camera.is_tunnel ? 'Tunnel' : 'Stabil'}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                        {/* Location + Area */}
                        {(camera.location || camera.area_name) && (
                            <div className="flex items-center gap-2 mt-1.5">
                                {camera.location && (
                                    <span className="text-gray-600 dark:text-gray-400 text-xs flex items-center gap-1 truncate">
                                        <Icons.MapPin />
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

                {/* Video - expand to full screen in fullscreen mode */}
                <div ref={wrapperRef} className={`relative bg-gray-100 dark:bg-black overflow-hidden ${isFullscreen ? 'flex-1' : 'flex-1 min-h-0'}`} onDoubleClick={toggleFS}>
                    <ZoomableVideo videoRef={videoRef} maxZoom={4} onZoomChange={setZoom} isFullscreen={isFullscreen} />
                    
                    {/* Snapshot Notification */}
                    {snapshotNotification && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                            <div className={`px-5 py-3 rounded-xl shadow-2xl border-2 ${
                                snapshotNotification.type === 'success'
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
                        <>
                            <div className="absolute top-0 left-0 right-0 z-50 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h2 className="text-white font-bold text-lg">{camera.name}</h2>
                                        {camera.video_codec && (
                                            <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                                        )}
                                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${statusDisplay.color}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${statusDisplay.dotColor}`} />
                                            {statusDisplay.label}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {status === 'live' && <button onClick={takeSnapshot} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10"><Icons.Image /></button>}
                                        <button onClick={toggleFS} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"/>
                                            </svg>
                                        </button>
                                        <button onClick={handleClose} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10"><Icons.X /></button>
                                    </div>
                                </div>
                                {/* Codec info detail - fullscreen mode */}
                                {camera.video_codec && (
                                    <div className="mt-2 flex items-center gap-2 text-xs">
                                        <span className="text-gray-300">
                                            Codec: <strong className="text-white">{camera.video_codec.toUpperCase()}</strong>
                                        </span>
                                        {camera.video_codec === 'h265' && (
                                            <span className="text-yellow-400 text-[10px]">
                                                ⚠ Terbaik di Safari
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            
                            <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1 bg-gray-200/90 dark:bg-gray-900/80 rounded-xl p-1 pointer-events-auto">
                                <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded-lg text-gray-900 dark:text-white"><Icons.ZoomOut /></button>
                                <span className="text-gray-900 dark:text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                                <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 4} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded-lg text-gray-900 dark:text-white"><Icons.ZoomIn /></button>
                                {zoom > 1 && <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 rounded-lg text-gray-900 dark:text-white ml-1"><Icons.Reset /></button>}
                            </div>
                        </>
                    )}
                    
                    {/* Maintenance Overlay */}
                    {status === 'maintenance' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/80">
                            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"/>
                                </svg>
                            </div>
                            <h3 className="text-red-300 font-bold text-xl mb-2">Dalam Perbaikan</h3>
                            <p className="text-gray-400 text-sm text-center max-w-md px-4">Kamera ini sedang dalam masa perbaikan/maintenance</p>
                        </div>
                    )}
                    
                    {/* Offline Overlay */}
                    {status === 'offline' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-gray-900/90">
                            <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6"/>
                                </svg>
                            </div>
                            <h3 className="text-gray-300 font-bold text-xl mb-2">Kamera Offline</h3>
                            <p className="text-gray-500 text-sm text-center max-w-md px-4">Kamera ini sedang tidak tersedia atau tidak dapat dijangkau</p>
                        </div>
                    )}
                    
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
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-black/90">
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
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-black/90">
                            <div className="text-center p-6">
                                {(() => {
                                    const info = getErrorInfo();
                                    const colorClass = errorColorClasses[info.color] || errorColorClasses.red;
                                    return (
                                        <>
                                            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${colorClass} flex items-center justify-center`}>
                                                {info.icon}
                                            </div>
                                            <h3 className="text-white font-semibold text-lg mb-2">{info.title}</h3>
                                            <p className="text-gray-400 text-sm mb-4 max-w-md">{info.desc}</p>
                                        </>
                                    );
                                })()}
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

                {/* Controls Panel + Codec Description - hide in fullscreen */}
                <div className={`shrink-0 border-t border-gray-200 dark:border-gray-800 ${isFullscreen ? 'hidden' : ''}`}>
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
                        
                        {/* Zoom Controls */}
                        <div className="flex items-center gap-1 shrink-0">
                            <div className="flex items-center gap-0.5 bg-gray-200/90 dark:bg-gray-800 rounded-lg p-0.5">
                                <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 disabled:opacity-30 rounded text-gray-900 dark:text-white transition-colors" title="Zoom Out">
                                    <Icons.ZoomOut />
                                </button>
                                <span className="text-gray-900 dark:text-white text-[10px] font-medium w-8 text-center">{Math.round(zoom * 100)}%</span>
                                <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 4} className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 disabled:opacity-30 rounded text-gray-900 dark:text-white transition-colors" title="Zoom In">
                                    <Icons.ZoomIn />
                                </button>
                                {zoom > 1 && (
                                    <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-1.5 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded text-gray-900 dark:text-white transition-colors" title="Reset Zoom">
                                        <Icons.Reset />
                                    </button>
                                )}
                            </div>
                            
                            {/* Screenshot Button */}
                            {status === 'live' && (
                                <button onClick={takeSnapshot} className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors" title="Ambil Screenshot">
                                    <Icons.Image />
                                </button>
                            )}
                            
                            {/* Fullscreen Button */}
                            <button onClick={toggleFS} className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors" title={isFullscreen ? "Keluar Fullscreen" : "Fullscreen"}>
                                <Icons.Fullscreen />
                            </button>
                            
                            {/* Close Button */}
                            <button onClick={onClose} className="p-1.5 bg-gray-200/80 dark:bg-gray-800 hover:bg-gray-300/50 dark:hover:bg-gray-700 rounded-lg text-gray-900 dark:text-white transition-colors" title="Tutup">
                                <Icons.X />
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
}
// Now handles offline/maintenance cameras properly
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
    
    // Handle close with fullscreen exit
    const handleClose = async () => {
        if (document.fullscreenElement) {
            try {
                await document.exitFullscreen?.();
                // Wait for fullscreen transition to complete
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error('Error exiting fullscreen:', error);
            }
        }
        onRemove();
    };
    
    // Check camera status first - same as VideoPopup
    const isMaintenance = camera.status === 'maintenance';
    const isOffline = camera.is_online === 0;
    
    // Set initial status based on camera state
    const getInitialStatus = () => {
        if (isMaintenance) return 'maintenance';
        if (isOffline) return 'offline';
        return 'connecting';
    };
    
    const [status, setStatus] = useState(getInitialStatus);
    const [loadingStage, setLoadingStage] = useState(LoadingStage.CONNECTING);
    const [zoom, setZoom] = useState(1);
    const [snapshotNotification, setSnapshotNotification] = useState(null);
    const [retryKey, setRetryKey] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [autoRetryCount, setAutoRetryCount] = useState(0);
    const [isAutoRetrying, setIsAutoRetrying] = useState(false);
    
    const url = camera.streams?.hls;
    const deviceTier = detectDeviceTier();

    // Track fullscreen state to disable animations and unlock orientation on exit
    useEffect(() => {
        const handleFullscreenChange = () => {
            const isNowFullscreen = !!document.fullscreenElement;
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
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
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

    // Viewer session tracking - track when user starts/stops watching this camera
    useEffect(() => {
        // Don't track if camera is offline or in maintenance
        if (isMaintenance || isOffline) return;
        
        let sessionId = null;
        
        // Start viewer session with delay (staggered init)
        const startTracking = async () => {
            // Wait for init delay before starting session
            if (initDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, initDelay));
            }
            
            try {
                sessionId = await viewerService.startSession(camera.id);
            } catch (error) {
                console.error('[MultiViewVideoItem] Failed to start viewer session:', error);
            }
        };
        
        startTracking();
        
        // Cleanup: stop session when component unmounts
        return () => {
            if (sessionId) {
                viewerService.stopSession(sessionId).catch(err => {
                    console.error('[MultiViewVideoItem] Failed to stop viewer session:', err);
                });
            }
        };
    }, [camera.id, isMaintenance, isOffline, initDelay]);

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
        // Skip HLS loading if camera is in maintenance or offline
        if (isMaintenance || isOffline) return;
        
        if (!url || !videoRef.current) return;
        const video = videoRef.current;
        let hls = null;
        let cancelled = false;
        let initTimeout = null;
        let isLive = false; // Flag to prevent setState after live

        abortControllerRef.current = new AbortController();
        setStatus('connecting');
        setLoadingStage(LoadingStage.CONNECTING);
        let playbackCheckInterval = null;

        // Only change to 'live' once video starts playing - don't revert on buffering
        const handlePlaying = () => {
            if (cancelled || isLive) return; // Skip if already live
            isLive = true; // Set flag to prevent future setState
            clearInterval(playbackCheckInterval);
            playbackCheckInterval = null;
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
                if (cancelled || isLive) {
                    clearInterval(playbackCheckInterval);
                    playbackCheckInterval = null;
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
            if (cancelled || isLive) return; // Don't show error if already playing
            clearInterval(playbackCheckInterval);
            playbackCheckInterval = null;
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

            // HLS.js already imported directly
            
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
                
                // Load source first, then attach media with small delay
                hls.loadSource(url);
                await new Promise(r => setTimeout(r, 50));
                if (cancelled) return;
                hls.attachMedia(video);
                
                // Start playback check early - don't wait for events that may not fire
                startPlaybackCheck();
                
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    setLoadingStage(LoadingStage.BUFFERING);
                    if (loadingTimeoutHandlerRef.current) {
                        loadingTimeoutHandlerRef.current.updateStage(LoadingStage.BUFFERING);
                    }
                    video.play().catch(() => {});
                });
                
                // FRAG_LOADED fires when first fragment is loaded
                hls.on(Hls.Events.FRAG_LOADED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    setLoadingStage(prev => {
                        if (prev === LoadingStage.LOADING || prev === LoadingStage.CONNECTING) {
                            if (loadingTimeoutHandlerRef.current) {
                                loadingTimeoutHandlerRef.current.updateStage(LoadingStage.BUFFERING);
                            }
                            return LoadingStage.BUFFERING;
                        }
                        return prev;
                    });
                    if (video.paused) {
                        video.play().catch(() => {});
                    }
                });

                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                    if (cancelled || isLive) return; // Skip if already live
                    // Langsung set live setelah buffered
                    handlePlaying(); // Use handlePlaying to set isLive flag
                });
                
                hls.on(Hls.Events.ERROR, (_, d) => {
                    if (cancelled || isLive) return; // Don't handle errors if already playing
                    
                    // For non-fatal errors, just continue
                    if (!d.fatal) return;
                    
                    // Clear loading timeout
                    if (loadingTimeoutHandlerRef.current) {
                        loadingTimeoutHandlerRef.current.clearTimeout();
                    }
                    
                    // Check for codec incompatibility - NOT recoverable
                    if (d.details === 'manifestIncompatibleCodecsError') {
                        console.error('Browser tidak support codec H.265/HEVC. Ubah setting kamera ke H.264.');
                        setStatus('error');
                        setLoadingStage(LoadingStage.ERROR);
                        onError?.(camera.id, new Error('Codec tidak didukung browser'));
                        return;
                    }

                    const errorType = d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' :
                                      d.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'unknown';

                    // For media errors, try recovery (max 2 times)
                    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        if (!hls._mediaErrorRecoveryCount) hls._mediaErrorRecoveryCount = 0;
                        hls._mediaErrorRecoveryCount++;
                        
                        if (hls._mediaErrorRecoveryCount <= 2) {
                            hls.recoverMediaError();
                            return;
                        }
                    }

                    // Try auto-retry with FallbackHandler
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
                            onError?.(camera.id, new Error(`HLS fatal error: ${d.type}`));
                        }
                    } else {
                        setStatus('error');
                        setLoadingStage(LoadingStage.ERROR);
                        onError?.(camera.id, new Error(`HLS fatal error: ${d.type}`));
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
    }, [url, retryKey, initDelay, camera.id, onError, deviceTier, cleanupResources, isMaintenance, isOffline]);

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
            if (!document.fullscreenElement) {
                // Enter fullscreen
                await containerRef.current?.requestFullscreen?.();
                
                // Reset zoom to 1.0 when entering fullscreen to avoid "auto zoom" effect
                const wrapper = getZoomableWrapper();
                if (wrapper && wrapper._reset) {
                    wrapper._reset();
                }
                
                // Lock to landscape orientation on mobile
                if (screen.orientation && screen.orientation.lock) {
                    try {
                        await screen.orientation.lock('landscape').catch(() => {
                            screen.orientation.lock('landscape-primary').catch(() => {});
                        });
                    } catch (err) {
                        console.log('Orientation lock not supported');
                    }
                }
            } else {
                // Exit fullscreen
                await document.exitFullscreen?.();
                
                // Reset zoom when exiting fullscreen
                const wrapper = getZoomableWrapper();
                if (wrapper && wrapper._reset) {
                    wrapper._reset();
                }
                
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
    };

    const takeSnapshot = async () => {
        if (!videoRef.current || status !== 'live') return;
        
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
    };

    // Get wrapper ref for zoom controls - directly access ZoomableVideo wrapper
    const getZoomableWrapper = () => {
        // ZoomableVideo is the first child of wrapperRef
        return wrapperRef.current?.firstElementChild;
    };

    // Get status display info for multi-view - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    const getStatusBadge = () => {
        if (status === 'live') return { label: 'LIVE', color: 'bg-emerald-500' };
        if (status === 'maintenance') return { label: 'PERBAIKAN', color: 'bg-red-500' };
        if (status === 'offline') return { label: 'OFFLINE', color: 'bg-gray-500' };
        if (status === 'timeout') return { label: 'TIMEOUT', color: 'bg-amber-500' };
        if (status === 'error') return { label: 'OFF', color: 'bg-red-500' };
        // Connecting - show abbreviated stage
        return { label: '...', color: 'bg-amber-500' };
    };

    const statusBadge = getStatusBadge();
    
    // Check if animations should be disabled on low-end devices - **Validates: Requirements 5.2**
    const disableAnimations = shouldDisableAnimations();

    return (
        <div ref={containerRef} className={`relative w-full h-full bg-gray-100 dark:bg-black rounded-xl overflow-hidden group ${isFullscreen ? 'rounded-none' : ''}`}>
            <div ref={wrapperRef} className="w-full h-full">
                <ZoomableVideo videoRef={videoRef} status={status} maxZoom={3} onZoomChange={setZoom} isFullscreen={isFullscreen} />
            </div>
            
            {/* Snapshot Notification */}
            {snapshotNotification && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                    <div className={`px-4 py-2 rounded-lg shadow-xl border ${
                        snapshotNotification.type === 'success'
                            ? 'bg-green-500 border-green-400'
                            : 'bg-red-500 border-red-400'
                    } text-white text-xs font-semibold`}>
                        {snapshotNotification.message}
                    </div>
                </div>
            )}
            
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
            <button onClick={handleClose} className={`absolute top-2 right-2 z-10 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg text-white shadow ${isFullscreen ? 'hidden' : ''}`}><Icons.X /></button>
            {/* Overlay controls - render only on hover, no transition in fullscreen, hide in fullscreen */}
            <div className={`absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 z-10 ${isFullscreen ? 'hidden' : 'transition-opacity'}`}>
                <div className="flex items-center justify-between gap-2">
                    <p className="text-white text-xs font-medium truncate flex-1">{camera.name}</p>
                    <div className="flex items-center gap-1">
                        <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomOut /></button>
                        <span className="text-white/70 text-[10px] w-8 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 3} className="p-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-white"><Icons.ZoomIn /></button>
                        {zoom > 1 && <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Reset /></button>}
                        <div className="w-px h-4 bg-white/20 mx-1" />
                        {status === 'live' && <button onClick={takeSnapshot} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Image /></button>}
                        <button onClick={toggleFS} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white"><Icons.Fullscreen /></button>
                    </div>
                </div>
            </div>
            
            {/* Floating controls for fullscreen mode - Always visible on mobile */}
            {isFullscreen && (
                <div className="absolute inset-0 z-50 pointer-events-none">
                    {/* Top bar with camera name and exit - Always visible */}
                    <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold text-white shadow ${statusBadge.color}`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                                    {statusBadge.label}
                                </span>
                                <p className="text-white text-sm font-medium">{camera.name}</p>
                            </div>
                            <button onClick={toggleFS} className="p-2 hover:bg-gray-700/50 dark:hover:bg-white/20 active:bg-gray-700/70 dark:active:bg-white/30 rounded-xl text-gray-900 dark:text-white bg-gray-200/80 dark:bg-white/10"><Icons.Fullscreen /></button>
                        </div>
                    </div>
                    
                    {/* Bottom controls - Always visible on mobile */}
                    <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-gray-200/90 dark:bg-gray-900/80 rounded-xl p-1 pointer-events-auto">
                        <button onClick={() => getZoomableWrapper()?._zoomOut?.()} disabled={zoom <= 1} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded text-gray-900 dark:text-white"><Icons.ZoomOut /></button>
                        <span className="text-gray-900 dark:text-white text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => getZoomableWrapper()?._zoomIn?.()} disabled={zoom >= 3} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 disabled:opacity-30 rounded text-gray-900 dark:text-white"><Icons.ZoomIn /></button>
                        {zoom > 1 && <button onClick={() => getZoomableWrapper()?._reset?.()} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 rounded text-gray-900 dark:text-white"><Icons.Reset /></button>}
                        {status === 'live' && (
                            <>
                                <div className="w-px h-4 bg-gray-400 dark:bg-white/20 mx-1" />
                                <button onClick={takeSnapshot} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/20 active:bg-gray-700/50 dark:active:bg-white/30 rounded text-gray-900 dark:text-white"><Icons.Image /></button>
                            </>
                        )}
                    </div>
                </div>
            )}
            
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
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-black/90">
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
            
            {/* Error Overlay - dengan deteksi codec H265 */}
            {status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-black/90">
                    <div className="text-center p-4 max-w-xs">
                        <div className={`w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center ${
                            errorType === 'codec' ? 'bg-yellow-500/20' : 'bg-red-500/20'
                        }`}>
                            {errorType === 'codec' ? (
                                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            )}
                        </div>
                        {errorType === 'codec' ? (
                            <>
                                <p className="text-yellow-400 text-xs font-medium mb-1">Codec Tidak Didukung</p>
                                <p className="text-gray-400 text-[10px] mb-2 leading-relaxed">
                                    Browser Anda tidak mendukung codec H.265/HEVC. Gunakan Safari untuk hasil terbaik.
                                </p>
                                <div className="text-[9px] text-gray-500 mb-3">
                                    Atau hubungi admin untuk mengubah codec kamera ke H.264
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-white text-xs font-medium mb-1">Tidak Terkoneksi</p>
                                <p className="text-gray-400 text-[10px] mb-3">Kamera offline atau jaringan bermasalah</p>
                            </>
                        )}
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
            
            {/* Maintenance Overlay */}
            {status === 'maintenance' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/90">
                    <div className="text-center p-4">
                        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-500/20 flex items-center justify-center">
                            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63"/>
                            </svg>
                        </div>
                        <p className="text-red-300 text-sm font-bold mb-1">Dalam Perbaikan</p>
                        <p className="text-gray-400 text-[10px]">Kamera sedang maintenance</p>
                    </div>
                </div>
            )}
            
            {/* Offline Overlay */}
            {status === 'offline' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/95 dark:bg-gray-900/95">
                    <div className="text-center p-4">
                        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-700 flex items-center justify-center">
                            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829"/>
                            </svg>
                        </div>
                        <p className="text-gray-300 text-sm font-bold mb-1">Kamera Offline</p>
                        <p className="text-gray-500 text-[10px]">Tidak dapat dijangkau</p>
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
        <div className="fixed inset-0 z-50 bg-gray-50 dark:bg-gray-950 flex flex-col">
            <div className="shrink-0 flex items-center justify-between p-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400"><Icons.Layout /></div>
                    <div>
                        <h2 className="text-white font-bold text-sm sm:text-base">Multi-View</h2>
                        <p className="text-gray-500 text-[10px] sm:text-xs">{count} camera{count !== 1 ? 's' : ''}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={toggleFS} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/10 rounded-xl text-gray-900 dark:text-white"><Icons.Fullscreen /></button>
                    <button onClick={onClose} className="p-2 hover:bg-gray-700/30 dark:hover:bg-white/10 rounded-xl text-gray-900 dark:text-white"><Icons.X /></button>
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
// Clock update interval optimized: 10s on low-end, 1s on high-end
// ============================================
function Navbar({ cameraCount, branding, layoutMode, onLayoutToggle }) {
    const { isDark, toggleTheme } = useTheme();
    const [currentTime, setCurrentTime] = useState(new Date());
    const disableAnimations = shouldDisableAnimations();
    
    // Optimized clock interval: 10s on low-end devices to reduce re-renders
    useEffect(() => {
        const clockInterval = disableAnimations ? 10000 : 1000;
        const timer = setInterval(() => setCurrentTime(new Date()), clockInterval);
        return () => clearInterval(timer);
    }, [disableAnimations]);
    
    return (
        <nav className={`sticky top-0 z-[1001] bg-white/90 dark:bg-gray-900/90 ${disableAnimations ? '' : 'backdrop-blur-xl'} border-b border-gray-200/50 dark:border-gray-800/50`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo - SEO optimized with proper heading structure */}
                    <a href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity" title={`${branding.company_tagline} - ${branding.company_name}`}>
                        <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/30">
                                <span className="text-lg font-bold">{branding.logo_text}</span>
                            </div>
                            {cameraCount > 0 && (
                                <span className={`absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-gray-900 ${disableAnimations ? '' : 'animate-pulse'}`}></span>
                            )}
                        </div>
                        <div>
                            <span className="text-lg font-bold text-gray-900 dark:text-white">{branding.company_name}</span>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-0.5">{branding.company_tagline}</p>
                        </div>
                    </a>
                    
                    {/* Center - Live Time with Location */}
                    <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-xl bg-gray-100/80 dark:bg-gray-800/80">
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full bg-emerald-500 ${disableAnimations ? '' : 'animate-pulse'}`}></span>
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">LIVE</span>
                        </div>
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{branding.city_name}</span>
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <span className="text-sm font-mono text-gray-600 dark:text-gray-300">
                            {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: disableAnimations ? undefined : '2-digit' })}
                        </span>
                    </div>
                    
                    {/* Right - Layout Mode & Theme Toggle */}
                    <div className="flex items-center gap-2">
                        {/* Layout Mode Toggle */}
                        <button
                            onClick={onLayoutToggle}
                            className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title={layoutMode === 'simple' ? 'Switch to Full Layout' : 'Switch to Simple Layout'}
                            aria-label={layoutMode === 'simple' ? 'Beralih ke Tampilan Lengkap' : 'Beralih ke Tampilan Sederhana'}
                        >
                            {layoutMode === 'simple' ? <Icons.Layout /> : <Icons.Grid />}
                        </button>
                        
                        {/* Theme Toggle */}
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
// CAMERAS SECTION - Connection filter only for Grid view
// ============================================
function CamerasSection({ cameras, loading, areas, onCameraClick, onAddMulti, multiCameras, viewMode, setViewMode, landingSettings = { section_title: 'CCTV Publik' } }) {
    const [connectionTab, setConnectionTab] = useState('all'); // 'all', 'stable', 'tunnel'
    // viewMode now controlled by parent
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const [focusedCameraId, setFocusedCameraId] = useState(null);
    const searchInputRef = useRef(null);
    const searchContainerRef = useRef(null);

    // Count cameras by connection type
    const tunnelCameras = cameras.filter(c => c.is_tunnel === 1);
    const stableCameras = cameras.filter(c => c.is_tunnel !== 1);
    const hasTunnelCameras = tunnelCameras.length > 0;

    // Filter cameras by search query
    const searchFilteredCameras = useMemo(() => {
        if (!searchQuery.trim()) return cameras;
        
        const query = searchQuery.toLowerCase().trim();
        return cameras.filter(camera => {
            const name = (camera.name || '').toLowerCase();
            const location = (camera.location || '').toLowerCase();
            const areaName = (camera.area_name || '').toLowerCase();
            
            return name.includes(query) || 
                   location.includes(query) || 
                   areaName.includes(query);
        });
    }, [cameras, searchQuery]);

    // Filter cameras by connection type (only for grid view)
    const filteredForGrid = useMemo(() => {
        const baseList = searchFilteredCameras;
        if (connectionTab === 'stable') return baseList.filter(c => c.is_tunnel !== 1);
        if (connectionTab === 'tunnel') return baseList.filter(c => c.is_tunnel === 1);
        return baseList;
    }, [searchFilteredCameras, connectionTab]);

    // For map view, use search filtered cameras
    const displayCameras = viewMode === 'map' ? searchFilteredCameras : filteredForGrid;

    // Clear search
    const clearSearch = useCallback(() => {
        setSearchQuery('');
        setShowSearchDropdown(false);
        searchInputRef.current?.focus();
    }, []);

    // Handle camera selection from dropdown
    const handleCameraSelect = useCallback((camera) => {
        if (viewMode === 'map') {
            // Map View: navigasi ke posisi kamera dan play
            setFocusedCameraId(camera.id);
        } else {
            // Grid View: buka VideoPopup seperti biasa
            onCameraClick(camera);
        }
        // Clear search and close dropdown
        setSearchQuery('');
        setShowSearchDropdown(false);
    }, [viewMode, onCameraClick]);

    // Handle focus handled callback from MapView
    const handleFocusHandled = useCallback(() => {
        setFocusedCameraId(null);
    }, []);

    // Handle keyboard shortcut (Ctrl+K or Cmd+K)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                searchInputRef.current?.focus();
            }
            // Escape to clear search
            if (e.key === 'Escape' && searchQuery) {
                clearSearch();
            }
        };
        
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [searchQuery, clearSearch]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
                setShowSearchDropdown(false);
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Show dropdown when typing
    useEffect(() => {
        if (searchQuery.trim()) {
            setShowSearchDropdown(true);
        } else {
            setShowSearchDropdown(false);
        }
    }, [searchQuery]);

    return (
        <section id="playback-section" className="py-6 sm:py-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="flex flex-col gap-4 mb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                                {landingSettings.section_title}
                            </h2>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                                {cameras.length} kamera tersedia • Streaming langsung 24/7
                            </p>
                        </div>
                        
                        {/* View Mode Toggle - Maps, Grid, Playback */}
                        <div className="flex items-center p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                            <button
                                onClick={() => setViewMode('map')}
                                className={`p-2.5 rounded-lg transition-colors ${
                                    viewMode === 'map'
                                        ? 'bg-white dark:bg-gray-700 text-sky-600 dark:text-sky-400 shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                }`}
                                title="Map View"
                            >
                                <Icons.Map />
                            </button>
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2.5 rounded-lg transition-colors ${
                                    viewMode === 'grid'
                                        ? 'bg-white dark:bg-gray-700 text-sky-600 dark:text-sky-400 shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                }`}
                                title="Grid View (Multi-View)"
                            >
                                <Icons.Grid />
                            </button>
                            <button
                                onClick={() => setViewMode('playback')}
                                className={`p-2.5 rounded-lg transition-colors ${
                                    viewMode === 'playback'
                                        ? 'bg-white dark:bg-gray-700 text-sky-600 dark:text-sky-400 shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                }`}
                                title="Playback Rekaman"
                            >
                                <Icons.Clock />
                            </button>
                        </div>
                    </div>

                    {/* Search Bar - Responsive with Dropdown */}
                    <div className="relative" ref={searchContainerRef}>
                        <div className="relative flex items-center">
                            <div className="absolute left-3 text-gray-400 dark:text-gray-500 pointer-events-none">
                                <Icons.Search />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => searchQuery.trim() && setShowSearchDropdown(true)}
                                placeholder="Cari kamera berdasarkan nama, lokasi, atau area..."
                                className="w-full pl-10 pr-20 sm:pr-24 py-2.5 sm:py-3 bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-sky-500 dark:focus:border-sky-500 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm sm:text-base outline-none transition-colors"
                            />
                            {/* Clear button & Keyboard shortcut hint */}
                            <div className="absolute right-2 flex items-center gap-1.5">
                                {searchQuery && (
                                    <button
                                        onClick={clearSearch}
                                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                        title="Hapus pencarian (Esc)"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M6 18L18 6M6 6l12 12"/>
                                        </svg>
                                    </button>
                                )}
                                {/* Keyboard shortcut - hidden on mobile */}
                                <span className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 rounded">
                                    <kbd className="font-sans">⌘</kbd>
                                    <kbd className="font-sans">K</kbd>
                                </span>
                            </div>
                        </div>
                        
                        {/* Search Dropdown List */}
                        {showSearchDropdown && searchFilteredCameras.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-[1100] max-h-[300px] sm:max-h-[400px] overflow-y-auto">
                                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {searchFilteredCameras.length} kamera ditemukan • Klik untuk {viewMode === 'map' ? 'lihat di peta' : 'putar video'}
                                    </span>
                                </div>
                                {searchFilteredCameras.map((camera) => {
                                    const isMaintenance = camera.status === 'maintenance';
                                    const isTunnel = camera.is_tunnel === 1;
                                    const hasCoords = camera.latitude && camera.longitude;
                                    // Di Map View perlu koordinat, di Grid View tidak perlu
                                    const isDisabled = viewMode === 'map' && !hasCoords;
                                    
                                    return (
                                        <button
                                            key={camera.id}
                                            onClick={() => handleCameraSelect(camera)}
                                            disabled={isDisabled}
                                            className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 ${
                                                !isDisabled 
                                                    ? 'hover:bg-sky-50 dark:hover:bg-sky-500/10 cursor-pointer' 
                                                    : 'opacity-50 cursor-not-allowed'
                                            }`}
                                        >
                                            {/* Status indicator */}
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                                                isMaintenance 
                                                    ? 'bg-red-100 dark:bg-red-500/20 text-red-500' 
                                                    : isTunnel 
                                                        ? 'bg-orange-100 dark:bg-orange-500/20 text-orange-500'
                                                        : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-500'
                                            }`}>
                                                {isMaintenance ? (
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                                    </svg>
                                                )}
                                            </div>
                                            
                                            {/* Camera info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={`font-medium truncate ${
                                                        isMaintenance 
                                                            ? 'text-red-600 dark:text-red-400' 
                                                            : 'text-gray-900 dark:text-white'
                                                    }`}>
                                                        {camera.name}
                                                    </span>
                                                    {isMaintenance && (
                                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded">
                                                            PERBAIKAN
                                                        </span>
                                                    )}
                                                    {isTunnel && !isMaintenance && (
                                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded">
                                                            TUNNEL
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                    {camera.location && (
                                                        <span className="flex items-center gap-1 truncate">
                                                            <Icons.MapPin />
                                                            {camera.location}
                                                        </span>
                                                    )}
                                                    {camera.area_name && (
                                                        <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">
                                                            {camera.area_name}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            
                                                            {/* Arrow indicator */}
                                            {!isDisabled && (
                                                <div className="text-gray-400 dark:text-gray-500 shrink-0">
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path d="M9 5l7 7-7 7"/>
                                                    </svg>
                                                </div>
                                            )}
                                            {isDisabled && (
                                                <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                                                    Tanpa koordinat
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        
                        {/* No results message */}
                        {showSearchDropdown && searchQuery.trim() && searchFilteredCameras.length === 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-[1100] p-6 text-center">
                                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400">
                                    <Icons.Search />
                                </div>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    Tidak ditemukan kamera untuk "<span className="font-medium text-gray-700 dark:text-gray-300">{searchQuery}</span>"
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Connection Type Tabs - Only show for Grid view and if there are tunnel cameras */}
                {viewMode === 'grid' && hasTunnelCameras && (
                    <div className="mb-6">
                        <div className="flex flex-wrap gap-2 p-1.5 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
                            <button
                                onClick={() => setConnectionTab('all')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                    connectionTab === 'all'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                            >
                                Semua ({searchFilteredCameras.length})
                            </button>
                            <button
                                onClick={() => setConnectionTab('stable')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                                    connectionTab === 'stable'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                            >
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                Stabil ({searchFilteredCameras.filter(c => c.is_tunnel !== 1).length})
                            </button>
                            <button
                                onClick={() => setConnectionTab('tunnel')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                                    connectionTab === 'tunnel'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                            >
                                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                Tunnel ({searchFilteredCameras.filter(c => c.is_tunnel === 1).length})
                            </button>
                        </div>
                        
                        {/* Tunnel Warning */}
                        {connectionTab === 'tunnel' && (
                            <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-lg text-sm text-orange-700 dark:text-orange-400 flex items-start gap-2">
                                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span>Kamera tunnel mungkin kurang stabil. Refresh jika stream tidak muncul.</span>
                            </div>
                        )}
                    </div>
                )}

                {loading ? (
                    <GridSkeleton items={6} columns={3} SkeletonComponent={CameraCardSkeleton} />
                ) : displayCameras.length === 0 ? (
                    searchQuery ? (
                        <NoSearchResultsEmptyState 
                            searchQuery={searchQuery}
                            onClearSearch={clearSearch}
                        />
                    ) : connectionTab !== 'all' ? (
                        <NoDataWithFilterEmptyState
                            filterName={connectionTab === 'tunnel' ? 'Koneksi Tunnel' : 'Koneksi Stabil'}
                            onClearFilter={() => setConnectionTab('all')}
                        />
                    ) : (
                        <div className="text-center py-16">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400">
                                <Icons.Camera />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                Belum Ada Kamera
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400">
                                Kamera CCTV akan segera tersedia untuk ditonton.
                            </p>
                        </div>
                    )
                ) : viewMode === 'playback' ? (
                    <Suspense fallback={
                        <div className="h-[600px] bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-gray-300 border-t-sky-500 rounded-full animate-spin"/>
                        </div>
                    }>
                        <Playback />
                    </Suspense>
                ) : viewMode === 'map' ? (
                    <Suspense fallback={
                        <div className="h-[450px] bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-gray-300 border-t-sky-500 rounded-full animate-spin"/>
                        </div>
                    }>
                        <MapView
                            cameras={cameras}
                            areas={areas}
                            className="h-[450px] sm:h-[550px]"
                            focusedCameraId={focusedCameraId}
                            onFocusHandled={handleFocusHandled}
                        />
                    </Suspense>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                        {filteredForGrid.map(camera => (
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
function Footer({ cameraCount, areaCount, saweriaEnabled, saweriaLink, branding }) {
    const whatsappNumber = branding.whatsapp_number || '6289685645956'; // Format internasional tanpa +
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=Halo%20Admin%20${encodeURIComponent(branding.company_name)}`;
    
    const showPoweredBy = branding.show_powered_by === 'true';
    
    return (
        <footer className="py-10 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* About Company Section */}
                <div className="mb-8 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-50 dark:bg-sky-500/10 mb-4">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white">
                            <span className="text-sm font-bold">{branding.logo_text}</span>
                        </div>
                        <span className="font-bold text-sky-600 dark:text-sky-400">{branding.company_name}</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                        {branding.copyright_text}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-4">
                        {branding.company_description}
                    </p>
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
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Playback</span>
                    <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Gratis Akses</span>
                </div>

                {/* Support Us - Saweria Link */}
                {saweriaEnabled && (
                    <div className="flex flex-col items-center gap-3 mb-6">
                        <div className="text-center">
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                                💝 Dukung kami untuk tambah CCTV di lokasi strategis
                            </p>
                        </div>
                        <a
                            href={saweriaLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl"
                        >
                            <span className="text-xl">☕</span>
                            <span>Traktir Kopi Yuk!</span>
                        </a>
                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center max-w-md">
                            Dukungan Anda sangat berarti untuk upgrade server, tambah bandwidth, dan pasang CCTV di titik-titik penting lainnya. Terima kasih! 🙏
                        </p>
                    </div>
                )}
                
                {/* SEO Keywords Section */}
                <div className="text-center mb-4">
                    <p className="text-[10px] text-gray-400 dark:text-gray-600">
                        {branding.meta_keywords}
                    </p>
                </div>
                
                <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-center text-gray-400 dark:text-gray-500 text-xs">
                        © {new Date().getFullYear()} {branding.company_name} • {branding.copyright_text}
                    </p>
                    {showPoweredBy && (
                        <p className="text-center text-gray-400 dark:text-gray-600 text-[10px] mt-1">
                            Powered by RAF NET CCTV System
                        </p>
                    )}
                </div>
            </div>
        </footer>
    );
}

// ============================================
// MULTI-VIEW FLOATING BUTTON - Enhanced with tooltip and device-based limit
// Disables animations on low-end devices - **Validates: Requirements 5.2**
// Position: bottom-left to avoid collision with FeedbackWidget (bottom-right)
// Tooltip dihapus agar tidak menimpa maps
// ============================================
function MultiViewButton({ count, onClick, maxReached, maxStreams = 3 }) {
    const disableAnimations = shouldDisableAnimations();
    
    // Hanya tampilkan button jika ada kamera yang dipilih
    if (count === 0) return null;
    
    return (
        <div className="fixed bottom-6 left-6 z-40 flex flex-col items-start gap-2">
            {/* Info tooltip when max reached */}
            {maxReached && (
                <div className={`bg-amber-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg ${disableAnimations ? '' : 'animate-bounce'}`}>
                    Maksimal {maxStreams} kamera!
                </div>
            )}
            
            <button
                onClick={onClick}
                className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all"
            >
                <Icons.Layout />
                <span className="font-bold">Multi-View</span>
                <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">{count}</span>
            </button>
        </div>
    );
}

// ============================================
// STATS BAR - Camera status statistics with clickable items
// Shows modal with list when clicked
// Optimized for low-end devices
// ============================================
function StatsBar({ cameras, areas, onCameraClick }) {
    const [activeModal, setActiveModal] = useState(null); // 'online', 'offline', 'maintenance', 'areas'
    const disableAnimations = shouldDisableAnimations();
    
    const stats = useMemo(() => {
        const onlineList = cameras.filter(c => c.status !== 'maintenance' && c.is_online !== 0);
        const offlineList = cameras.filter(c => c.status !== 'maintenance' && c.is_online === 0);
        const maintenanceList = cameras.filter(c => c.status === 'maintenance');
        return { 
            online: onlineList.length, 
            offline: offlineList.length, 
            maintenance: maintenanceList.length, 
            total: cameras.length,
            onlineList,
            offlineList,
            maintenanceList
        };
    }, [cameras]);
    
    const totalAreas = areas.length;
    
    if (cameras.length === 0) return null;
    
    const handleCameraItemClick = (camera) => {
        setActiveModal(null);
        onCameraClick?.(camera);
    };
    
    // Stats Item Component - optimized for low-end devices
    const StatsItem = ({ count, label, sublabel, gradient, shadow, onClick, disabled = false }) => (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 rounded-xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm shadow-sm ${
                disabled 
                    ? 'opacity-50 cursor-not-allowed' 
                    : disableAnimations 
                        ? 'hover:bg-white/80 dark:hover:bg-gray-800/80 cursor-pointer' 
                        : 'hover:scale-105 hover:shadow-md cursor-pointer transition-all'
            }`}
        >
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg ${shadow}`}>
                <span className="text-white font-bold text-sm sm:text-lg">{count}</span>
            </div>
            <div className="text-left">
                <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className="text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200">{sublabel}</p>
            </div>
        </button>
    );
    
    // Modal Component - Optimized for low-end devices
    // Removed: backdrop-blur, complex SVGs, transitions on list items
    // Fixed: Added missing getHeaderColor and getStatusIcon functions
    const ListModal = ({ title, items, type, onClose }) => {
        // Get header color based on type
        const getHeaderColor = () => {
            switch (type) {
                case 'online': return 'from-emerald-500 to-emerald-600';
                case 'offline': return 'from-gray-500 to-gray-600';
                case 'maintenance': return 'from-red-500 to-red-600';
                case 'areas': return 'from-purple-500 to-purple-600';
                default: return 'from-sky-500 to-sky-600';
            }
        };
        
        // Get status icon based on type - simplified for low-end devices
        const getStatusIcon = () => {
            const iconClass = "w-5 h-5 text-white";
            switch (type) {
                case 'online':
                    return <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7"/></svg>;
                case 'offline':
                    return <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>;
                case 'maintenance':
                    return <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877"/></svg>;
                case 'areas':
                    return <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/></svg>;
                default:
                    return <Icons.Camera />;
            }
        };
        
        // Get icon color for camera items
        const getIconColor = () => {
            switch (type) {
                case 'online': return 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400';
                case 'offline': return 'bg-gray-100 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400';
                case 'maintenance': return 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400';
                default: return 'bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400';
            }
        };
        
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 dark:bg-black/80" onClick={onClose}>
                <div 
                    className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[70vh] overflow-hidden"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className={`bg-gradient-to-r ${getHeaderColor()} px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between`}>
                        <div className="flex items-center gap-2 sm:gap-3">
                            {getStatusIcon()}
                            <h3 className="text-white font-bold text-base sm:text-lg">{title}</h3>
                            <span className="px-2 py-0.5 bg-white/20 rounded-full text-white text-xs sm:text-sm font-medium">
                                {items.length}
                            </span>
                        </div>
                        <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-white">
                            <Icons.X />
                        </button>
                    </div>
                    
                    {/* List */}
                    <div className="overflow-y-auto max-h-[calc(70vh-80px)]">
                        {items.length === 0 ? (
                            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                                Tidak ada data
                            </div>
                        ) : type === 'areas' ? (
                            // Area list
                            <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                {items.map(area => (
                                    <div key={area.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <p className="font-medium text-gray-900 dark:text-white text-sm sm:text-base">{area.name}</p>
                                        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                                            {[area.kelurahan, area.kecamatan].filter(Boolean).join(', ') || 'Lokasi tidak tersedia'}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            // Camera list - optimized for low-end devices with tunnel indicator
                            <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                {items.map(camera => {
                                    const isTunnel = camera.is_tunnel === 1;
                                    return (
                                        <button
                                            key={camera.id}
                                            onClick={() => handleCameraItemClick(camera)}
                                            className={`w-full px-4 py-3 text-left flex items-center gap-3 ${
                                                disableAnimations 
                                                    ? 'hover:bg-gray-100 dark:hover:bg-gray-800' 
                                                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                                            }`}
                                        >
                                            <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${getIconColor()}`}>
                                                <Icons.Camera />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <p className="font-medium text-gray-900 dark:text-white truncate text-sm sm:text-base">{camera.name}</p>
                                                    {/* Tunnel badge in list */}
                                                    {isTunnel && type === 'online' && (
                                                        <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-bold bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded">
                                                            TUNNEL
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Location */}
                                                {camera.location && (
                                                    <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                                                        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                            <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/>
                                                        </svg>
                                                        <span className="truncate">{camera.location}</span>
                                                    </p>
                                                )}
                                                {/* Area */}
                                                {camera.area_name && (
                                                    <p className="text-[11px] sm:text-xs text-gray-400 dark:text-gray-500 truncate flex items-center gap-1 mt-0.5">
                                                        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                            <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
                                                        </svg>
                                                        <span className="truncate">{camera.area_name}</span>
                                                    </p>
                                                )}
                                                {/* Fallback if no location and no area */}
                                                {!camera.location && !camera.area_name && (
                                                    <p className="text-[11px] sm:text-xs text-gray-400 dark:text-gray-500">Lokasi tidak tersedia</p>
                                                )}
                                            </div>
                                            {type === 'online' && (
                                                <div className="shrink-0 text-emerald-500 w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center">
                                                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };
    
    return (
        <>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mt-8 pt-6 border-t border-gray-200/50 dark:border-gray-700/50">
                {/* Online Cameras */}
                <StatsItem
                    count={stats.online}
                    label="Online"
                    sublabel="Kamera"
                    gradient="from-emerald-400 to-emerald-600"
                    shadow="shadow-emerald-500/30"
                    onClick={() => setActiveModal('online')}
                />
                
                {/* Offline Cameras - only show if > 0 */}
                {stats.offline > 0 && (
                    <StatsItem
                        count={stats.offline}
                        label="Offline"
                        sublabel="Kamera"
                        gradient="from-gray-400 to-gray-600"
                        shadow="shadow-gray-500/30"
                        onClick={() => setActiveModal('offline')}
                    />
                )}
                
                {/* Maintenance Cameras - only show if > 0 */}
                {stats.maintenance > 0 && (
                    <StatsItem
                        count={stats.maintenance}
                        label="Perbaikan"
                        sublabel="Kamera"
                        gradient="from-red-400 to-red-600"
                        shadow="shadow-red-500/30"
                        onClick={() => setActiveModal('maintenance')}
                    />
                )}
                
                {/* Areas */}
                {totalAreas > 0 && (
                    <StatsItem
                        count={totalAreas}
                        label="Monitoring"
                        sublabel="Area"
                        gradient="from-purple-400 to-purple-600"
                        shadow="shadow-purple-500/30"
                        onClick={() => setActiveModal('areas')}
                    />
                )}
            </div>
            
            {/* Modals */}
            {activeModal === 'online' && (
                <ListModal
                    title="Kamera Online"
                    items={stats.onlineList}
                    type="online"
                    onClose={() => setActiveModal(null)}
                />
            )}
            {activeModal === 'offline' && (
                <ListModal
                    title="Kamera Offline"
                    items={stats.offlineList}
                    type="offline"
                    onClose={() => setActiveModal(null)}
                />
            )}
            {activeModal === 'maintenance' && (
                <ListModal
                    title="Kamera Perbaikan"
                    items={stats.maintenanceList}
                    type="maintenance"
                    onClose={() => setActiveModal(null)}
                />
            )}
            {activeModal === 'areas' && (
                <ListModal
                    title="Area Monitoring"
                    items={areas}
                    type="areas"
                    onClose={() => setActiveModal(null)}
                />
            )}
        </>
    );
}

// ============================================
// MAIN LANDING PAGE - With layout mode switching
// ============================================
export default function LandingPage() {
    const { branding } = useBranding();
    const [searchParams, setSearchParams] = useSearchParams();
    
    // ============================================
    // LAYOUT MODE MANAGEMENT
    // Priority: URL query param > localStorage > default 'full'
    // ============================================
    // LAYOUT MODE STATE - Fixed race condition
    // ============================================
    
    // Initialize mode from URL or localStorage (runs ONCE on mount)
    const getInitialMode = () => {
        const queryMode = searchParams.get('mode');
        
        // Priority 1: URL query param
        if (queryMode === 'simple' || queryMode === 'full') {
            return queryMode;
        }
        
        // Priority 2: localStorage
        try {
            const savedMode = localStorage.getItem('landing_layout_mode');
            if (savedMode === 'simple' || savedMode === 'full') {
                return savedMode;
            }
        } catch (err) {
            console.warn('Failed to read localStorage:', err);
        }
        
        // Priority 3: Default
        return 'full';
    };
    
    const [layoutMode, setLayoutMode] = useState(getInitialMode);
    const isInitialMount = useRef(true);
    
    // Sync URL with initial state on mount ONLY
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            
            const queryMode = searchParams.get('mode');
            // If no query param on mount, set it to current state
            if (!queryMode) {
                setSearchParams({ mode: layoutMode }, { replace: true });
            }
        }
    }, []); // Empty deps - runs ONCE on mount
    
    // Handle external URL changes (browser back/forward, manual URL edit)
    useEffect(() => {
        // Skip initial mount (already handled above)
        if (isInitialMount.current) return;
        
        const queryMode = searchParams.get('mode');
        
        // Only update state if URL has valid mode AND it's different from current
        if ((queryMode === 'simple' || queryMode === 'full') && queryMode !== layoutMode) {
            setLayoutMode(queryMode);
            
            // Save to localStorage
            try {
                localStorage.setItem('landing_layout_mode', queryMode);
            } catch (err) {
                console.warn('Failed to save to localStorage:', err);
            }
        }
    }, [searchParams]); // Only searchParams - no layoutMode!
    
    // Toggle function for FAB
    const toggleLayoutMode = useCallback(() => {
        const newMode = layoutMode === 'full' ? 'simple' : 'full';
        
        // Update state
        setLayoutMode(newMode);
        
        // Update URL
        setSearchParams({ mode: newMode }, { replace: true });
        
        // Save to localStorage
        try {
            localStorage.setItem('landing_layout_mode', newMode);
        } catch (err) {
            console.warn('Failed to save to localStorage:', err);
        }
    }, [layoutMode, setSearchParams]);
    
    // ============================================
    // SHARED STATE FOR BOTH LAYOUTS
    // ============================================
    const [cameras, setCameras] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [popup, setPopup] = useState(null);
    const [multiCameras, setMultiCameras] = useState([]);
    const [viewMode, setViewMode] = useState('map'); // Control viewMode from parent
    const [showMulti, setShowMulti] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [maxReached, setMaxReached] = useState(false);
    
    // Saweria config state
    const [saweriaLink, setSaweriaLink] = useState('https://saweria.co/raflialdi');
    const [saweriaLeaderboardLink, setSaweriaLeaderboardLink] = useState('');
    const [saweriaEnabled, setSaweriaEnabled] = useState(true);
    
    // Landing page settings state
    const [landingSettings, setLandingSettings] = useState({
        area_coverage: 'Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>',
        hero_badge: 'LIVE STREAMING 24 JAM',
        section_title: 'CCTV Publik'
    });
    
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
        // HLS.js now directly imported, no preload needed
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
                
                const hostname = window.location.hostname;
                const protocol = window.location.protocol;
                
                // If accessing via IP address, use relative path
                if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
                    apiUrl = '/api/health';
                } else if (protocol === 'https:') {
                    // HTTPS with domain - construct API URL from frontend domain
                    const frontendDomain = import.meta.env.VITE_FRONTEND_DOMAIN || hostname;
                    if (hostname === frontendDomain) {
                        // Use configured API URL
                        const baseUrl = getApiUrl();
                        apiUrl = `${baseUrl.replace(/\/$/, '')}/health`;
                    } else {
                        // Fallback: replace 'cctv.' with 'api-cctv.'
                        apiUrl = `${protocol}//${hostname.replace('cctv.', 'api-cctv.')}/health`;
                    }
                } else {
                    // HTTP with domain or development
                    const baseUrl = getApiUrl();
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
                // Fetch cameras, areas, Saweria config, and landing settings in parallel
                const [camsRes, areasRes, saweriaRes, landingRes] = await Promise.all([
                    streamService.getAllActiveStreams(),
                    areaService.getPublicAreas().catch(() => ({ success: false, data: [] })),
                    getPublicSaweriaConfig().catch((err) => {
                        console.warn('Saweria config fetch failed, using defaults:', err);
                        return { success: true, data: { enabled: true, saweria_link: 'https://saweria.co/raflialdi' } };
                    }),
                    fetch(`${getApiUrl()}/api/settings/landing-page`)
                        .then(res => res.json())
                        .catch(() => ({ success: false }))
                ]);
                
                setCameras(camsRes.data || []);
                setAreas(areasRes.data || []);
                
                // Set Saweria config - with safe defaults
                if (saweriaRes && saweriaRes.data) {
                    setSaweriaEnabled(saweriaRes.data.enabled !== false);
                    if (saweriaRes.data.saweria_link) {
                        setSaweriaLink(saweriaRes.data.saweria_link);
                    }
                    if (saweriaRes.data.leaderboard_link) {
                        setSaweriaLeaderboardLink(saweriaRes.data.leaderboard_link);
                    }
                }
                
                // Set landing page settings
                if (landingRes && landingRes.success && landingRes.data) {
                    setLandingSettings(landingRes.data);
                }
                
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
    
    // Update meta tags when branding changes
    useEffect(() => {
        if (branding) {
            updateMetaTags(branding);
        }
    }, [branding]);

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

    // Track camera status changes and notify user
    useCameraStatusTracker(cameras, addToast);
    
    // Auto-refresh cameras - interval based on device tier
    // Low-end: 60s, Medium: 30s, High: 15s
    useEffect(() => {
        const refreshMs = deviceTier === 'low' ? 60000 : deviceTier === 'high' ? 15000 : 30000;
        
        const refreshInterval = setInterval(async () => {
            try {
                const camsRes = await streamService.getAllActiveStreams();
                if (camsRes.data) {
                    setCameras(camsRes.data);
                }
            } catch (err) {
                // Silent fail - don't show error for background refresh
                console.warn('Background refresh failed:', err);
            }
        }, refreshMs);
        
        return () => clearInterval(refreshInterval);
    }, [deviceTier]);

    // Check if heavy effects should be disabled
    const disableHeavyEffects = deviceTier === 'low';

    // ============================================
    // CONDITIONAL RENDERING - Full vs Simple Layout
    // ============================================
    if (layoutMode === 'simple') {
        return (
            <>
                <LandingPageSimple
                    cameras={cameras}
                    areas={areas}
                    loading={loading}
                    onCameraClick={setPopup}
                    onAddMulti={handleAddMulti}
                    multiCameras={multiCameras}
                    saweriaEnabled={saweriaEnabled}
                    saweriaLink={saweriaLink}
                    CamerasSection={CamerasSection}
                    layoutMode={layoutMode}
                    onLayoutToggle={toggleLayoutMode}
                />
                
                {/* Shared Components */}
                <MultiViewButton 
                    count={multiCameras.length} 
                    onClick={() => setShowMulti(true)} 
                    maxReached={maxReached}
                    maxStreams={maxStreams}
                />
                
                <ToastContainer toasts={toasts} removeToast={removeToast} />
                
                {popup && <VideoPopup camera={popup} onClose={() => setPopup(null)} />}
                {showMulti && multiCameras.length > 0 && (
                    <MultiViewLayout
                        cameras={multiCameras}
                        onRemove={handleRemoveMulti}
                        onClose={() => setShowMulti(false)}
                    />
                )}
            </>
        );
    }

    // ============================================
    // FULL LAYOUT (Default)
    // ============================================
    return (
        <>
            <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
                <Navbar cameraCount={cameras.length} branding={branding} layoutMode={layoutMode} onLayoutToggle={toggleLayoutMode} />
                
                {/* Hero Section - SEO optimized with Indonesian content */}
                <header className="relative overflow-hidden bg-gradient-to-br from-sky-500/10 via-transparent to-purple-500/10 dark:from-sky-500/5 dark:to-purple-500/5">
                    {/* Decorative elements - hidden on low-end devices */}
                    {!disableHeavyEffects && (
                        <>
                            <div className="absolute top-0 left-1/4 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>
                            <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
                        </>
                    )}
                    
                    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 text-center">
                        {/* Company Badge */}
                        {branding.show_powered_by === 'true' && (
                            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 text-xs font-semibold mb-3 shadow-sm">
                                <div className="w-5 h-5 rounded bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white text-[10px] font-bold">{branding.logo_text}</div>
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
                        
                        {/* Area Coverage Info */}
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 mb-6">
                            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                                <circle cx="12" cy="11" r="3"/>
                            </svg>
                            <span 
                                className="text-sm text-amber-700 dark:text-amber-400"
                                dangerouslySetInnerHTML={{ __html: landingSettings.area_coverage }}
                            />
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
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Aman</span>
                            </div>
                            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                                    <Icons.Clock />
                                </div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">24/7 Live</span>
                            </div>
                            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 dark:bg-gray-800/80 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                                <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Playback</span>
                            </div>
                        </div>
                        
                        {/* Stats Bar - Integrated into Hero */}
                        <StatsBar cameras={cameras} areas={areas} onCameraClick={setPopup} />
                    </div>
                </header>

                <CamerasSection
                    cameras={cameras}
                    loading={loading}
                    areas={areas}
                    onCameraClick={setPopup}
                    onAddMulti={handleAddMulti}
                    multiCameras={multiCameras}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    landingSettings={landingSettings}
                />

                {/* Saweria Leaderboard - Placed after cameras section */}
                {saweriaEnabled && saweriaLeaderboardLink && (
                    <SaweriaLeaderboard leaderboardLink={saweriaLeaderboardLink} />
                )}

                <div className="flex-1" />
                <Footer 
                    cameraCount={cameras.length} 
                    areaCount={areas.length}
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
                
                {/* Saweria Support - Modal + Floating Banner */}
                <SaweriaSupport />
            </div>
        </>
    );
}
