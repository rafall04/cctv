import { useCallback, useEffect, useRef, useState } from 'react';
import { adminService } from '../../services/adminService';
import { mapPeriodToApi, normalizeAnalyticsData } from '../../utils/admin/viewerAnalyticsAdapter';

export function useViewerAnalyticsData(period, customDate) {
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshError, setRefreshError] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(null);
    const analyticsRef = useRef(null);

    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    const loadAnalytics = useCallback(async (isAutoRefresh = false) => {
        try {
            const apiPeriod = mapPeriodToApi(period, customDate);
            const [analyticsResponse, realtimeResponse] = await Promise.all([
                adminService.getViewerAnalytics(apiPeriod),
                adminService.getRealTimeViewers(),
            ]);

            if (analyticsResponse.success) {
                const normalizedData = normalizeAnalyticsData(
                    analyticsResponse.data,
                    realtimeResponse?.success ? realtimeResponse.data : null
                );
                setAnalytics(normalizedData);
                setError(null);
                setRefreshError(false);
                setLastUpdate(new Date());
            } else if (isAutoRefresh && analyticsRef.current) {
                setRefreshError(true);
            } else {
                setError(analyticsResponse.message || 'Gagal memuat data analytics');
            }
        } catch (requestError) {
            if (isAutoRefresh && analyticsRef.current) {
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
        loadAnalytics(false);
    }, [loadAnalytics]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            loadAnalytics(true);
        }, 30000);

        return () => {
            clearInterval(intervalId);
        };
    }, [loadAnalytics]);

    const retry = useCallback(() => {
        setError(null);
        setLoading(true);
        loadAnalytics(false);
    }, [loadAnalytics]);

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
