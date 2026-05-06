/*
 * Purpose: Provide public camera and area data with resilient initial, background, and resume refresh behavior.
 * Caller: Public landing pages and camera-driven UI surfaces through CameraProvider/useCameras.
 * Deps: React context/hooks, cameraService, areaService, request policy constants, device tier detector.
 * MainFuncs: CameraProvider, useCameras.
 * SideEffects: Fetches public camera/area data, schedules visible-tab refresh timers, listens for browser resume events.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { cameraService } from '../services/cameraService';
import { areaService } from '../services/areaService';
import { REQUEST_POLICY } from '../services/requestPolicy';
import { detectDeviceTier } from '../utils/deviceDetector';

const CameraContext = createContext(null);
const RESUME_RETRY_DELAYS = [500, 1500];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function CameraProvider({ children, autoRefresh = true }) {
    const [cameras, setCameras] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [initialLoadError, setInitialLoadError] = useState(null);
    const [backgroundRefreshError, setBackgroundRefreshError] = useState(null);
    const [deviceTier] = useState(() => detectDeviceTier());
    const camerasRef = useRef([]);
    const areasRef = useRef([]);
    const requestIdRef = useRef(0);
    const latestAppliedRequestRef = useRef(0);
    const activeRefreshPromiseRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        camerasRef.current = cameras;
    }, [cameras]);

    useEffect(() => {
        areasRef.current = areas;
    }, [areas]);

    const runFetch = useCallback(async ({ mode = 'initial' } = {}) => {
        const requestId = ++requestIdRef.current;
        const preserveExistingData = mode !== 'initial';
        const requestConfig = { skipGlobalErrorNotification: preserveExistingData };

        if (mode === 'initial') {
            setLoading(true);
            setInitialLoadError(null);
        }

        try {
            const [camsRes, areasRes] = await Promise.all([
                cameraService.getActiveCameras(
                    preserveExistingData ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING,
                    requestConfig
                ),
                areaService.getPublicAreas(
                    preserveExistingData ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.SILENT_PUBLIC,
                    requestConfig
                ),
            ]);

            if (!mountedRef.current || requestId < latestAppliedRequestRef.current) {
                return { cameras: camerasRef.current, areas: areasRef.current, stale: true };
            }

            latestAppliedRequestRef.current = requestId;

            if (Array.isArray(camsRes?.data)) {
                setCameras(camsRes.data);
                camerasRef.current = camsRes.data;
            }
            if (Array.isArray(areasRes?.data)) {
                setAreas(areasRes.data);
                areasRef.current = areasRes.data;
            }

            setBackgroundRefreshError(null);
            setInitialLoadError(null);

            return {
                cameras: camsRes.data || [],
                areas: areasRes.data || [],
            };
        } catch (err) {
            if (!mountedRef.current || requestId < latestAppliedRequestRef.current) {
                return { cameras: camerasRef.current, areas: areasRef.current, stale: true, error: err };
            }

            console.error('Failed to fetch camera and area data:', err);

            if (preserveExistingData && (camerasRef.current.length > 0 || areasRef.current.length > 0)) {
                setBackgroundRefreshError(err);
                return { cameras: camerasRef.current, areas: areasRef.current, error: err, preserved: true };
            }

            setInitialLoadError(err);
            return { cameras: [], areas: [], error: err };
        } finally {
            if (mode === 'initial' && mountedRef.current) {
                setLoading(false);
            }
        }
    }, []);

    const refreshData = useCallback(async ({ mode = 'resume' } = {}) => {
        if (activeRefreshPromiseRef.current) {
            return activeRefreshPromiseRef.current;
        }

        const refreshOperation = (async () => {
            const shouldRetry = mode === 'initial' || mode === 'resume';
            let lastResult = null;

            try {
                lastResult = await runFetch({ mode });

                if (!lastResult?.error || !shouldRetry) {
                    return lastResult;
                }

                for (const delay of RESUME_RETRY_DELAYS) {
                    await wait(delay);
                    lastResult = await runFetch({ mode: 'resume' });
                    if (!lastResult?.error) {
                        return lastResult;
                    }
                }

                return lastResult;
            } finally {
                activeRefreshPromiseRef.current = null;
            }
        })();

        activeRefreshPromiseRef.current = refreshOperation;
        return refreshOperation;
    }, [runFetch]);

    // Initial fetch
    useEffect(() => {
        mountedRef.current = true;
        refreshData({ mode: 'initial' });

        return () => {
            mountedRef.current = false;
        };
    }, [refreshData]);

    // Background refresh
    useEffect(() => {
        if (!autoRefresh) return;

        const refreshMs = deviceTier === 'low' ? 120000 : deviceTier === 'high' ? 30000 : 60000;
        const refreshInterval = setInterval(async () => {
            if (document.visibilityState === 'hidden') {
                return;
            }

            try {
                await refreshData({ mode: 'background' });
            } catch (err) {
                console.warn('Background refresh failed:', err);
            }
        }, refreshMs);

        return () => clearInterval(refreshInterval);
    }, [deviceTier, autoRefresh, refreshData]);

    useEffect(() => {
        if (!autoRefresh) return;

        let lastResumeAt = 0;
        const MIN_RESUME_GAP = 1500;
        const triggerResumeRefresh = () => {
            const now = Date.now();
            if (now - lastResumeAt < MIN_RESUME_GAP) {
                return;
            }

            lastResumeAt = now;
            refreshData({ mode: 'resume' }).catch((err) => {
                console.warn('Resume refresh failed:', err);
            });
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                triggerResumeRefresh();
            }
        };

        window.addEventListener('focus', triggerResumeRefresh);
        window.addEventListener('online', triggerResumeRefresh);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('focus', triggerResumeRefresh);
            window.removeEventListener('online', triggerResumeRefresh);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [autoRefresh, refreshData]);

    const value = {
        cameras,
        areas,
        loading,
        error: initialLoadError,
        recoverableError: backgroundRefreshError,
        initialLoadError,
        backgroundRefreshError,
        deviceTier,
        refreshData
    };

    return (
        <CameraContext.Provider value={value}>
            {children}
        </CameraContext.Provider>
    );
}

export function useCameras() {
    const context = useContext(CameraContext);
    if (!context) {
        throw new Error('useCameras must be used within a CameraProvider');
    }
    return context;
}
