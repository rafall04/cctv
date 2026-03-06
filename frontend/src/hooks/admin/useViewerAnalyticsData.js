import { useCallback, useEffect, useRef, useState } from 'react';
import { adminService } from '../../services/adminService';
import { mapPeriodToApi, normalizeAnalyticsData } from '../../utils/admin/viewerAnalyticsAdapter';
import { useAdminReconnectRefresh } from './useAdminReconnectRefresh';

export function useViewerAnalyticsData(period, customDate) {
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshError, setRefreshError] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(null);
    const analyticsRef = useRef(null);
    const requestIdRef = useRef(0);

    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    const loadAnalytics = useCallback(async (mode = 'initial') => {
        const isBackgroundMode = mode === 'background' || mode === 'resume';
        const requestId = ++requestIdRef.current;

        try {
            const apiPeriod = mapPeriodToApi(period, customDate);
            const [analyticsResponse, realtimeResponse] = await Promise.all([
                adminService.getViewerAnalytics(
                    apiPeriod,
                    isBackgroundMode ? { skipGlobalErrorNotification: true } : {}
                ),
                adminService.getRealTimeViewers(
                    isBackgroundMode ? { skipGlobalErrorNotification: true } : {}
                ),
            ]);

            if (requestId !== requestIdRef.current) {
                return;
            }

            if (analyticsResponse.success) {
                const normalizedData = normalizeAnalyticsData(
                    analyticsResponse.data,
                    realtimeResponse?.success ? realtimeResponse.data : null
                );
                setAnalytics(normalizedData);
                setError(null);
                setRefreshError(false);
                setLastUpdate(new Date());
            } else if (isBackgroundMode && analyticsRef.current) {
                setRefreshError(true);
            } else {
                setError(analyticsResponse.message || 'Gagal memuat data analytics');
            }
        } catch (requestError) {
            if (requestId !== requestIdRef.current) {
                return;
            }

            if (isBackgroundMode && analyticsRef.current) {
                setRefreshError(true);
            } else {
                setError('Gagal terhubung ke server');
            }
        } finally {
            setLoading(false);
        }
    }, [customDate, period]);

    useEffect(() => {
        setLoading(true);
        loadAnalytics('initial');
    }, [loadAnalytics]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            loadAnalytics('background');
        }, 30000);

        return () => {
            clearInterval(intervalId);
        };
    }, [loadAnalytics]);

    const retry = useCallback(() => {
        setError(null);
        setLoading(true);
        loadAnalytics('initial');
    }, [loadAnalytics]);

    useAdminReconnectRefresh(() => loadAnalytics('resume'));

    return {
        analytics,
        loading,
        error,
        refreshError,
        lastUpdate,
        setRefreshError,
        retry,
    };
}

export default useViewerAnalyticsData;
