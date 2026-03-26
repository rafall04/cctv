import { useCallback, useEffect, useRef, useState } from 'react';
import { adminService } from '../../services/adminService';
import { REQUEST_POLICY } from '../../services/requestPolicy';
import { useAdminReconnectRefresh } from './useAdminReconnectRefresh';

export function useDashboardData() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState(null);
    const [refreshError, setRefreshError] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [dateRange, setDateRange] = useState('today');
    const intervalRef = useRef(null);
    const statsRef = useRef(null);
    const requestIdRef = useRef(0);
    const mountedRef = useRef(true);

    useEffect(() => {
        statsRef.current = stats;
    }, [stats]);

    const loadStats = useCallback(async ({ mode = 'initial' } = {}) => {
        const isBackgroundMode = mode === 'background' || mode === 'resume';
        const requestId = ++requestIdRef.current;

        try {
            if (!isBackgroundMode) {
                setIsRetrying(true);
            }

            const response = await adminService.getStats(
                isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING
            );

            if (!mountedRef.current || requestId !== requestIdRef.current) {
                return;
            }

            if (response.success) {
                setStats(response.data);
                setError(null);
                setRefreshError(false);
                setLastSuccessfulUpdate(new Date());
            } else if (isBackgroundMode && statsRef.current) {
                setRefreshError(true);
            } else {
                setError(response.message || 'Failed to load dashboard data');
            }
        } catch (err) {
            if (!mountedRef.current || requestId !== requestIdRef.current) {
                return;
            }

            if (isBackgroundMode && statsRef.current) {
                setRefreshError(true);
            } else {
                setError('Failed to connect to server. Please check your connection.');
            }
        } finally {
            if (mountedRef.current && requestId === requestIdRef.current) {
                setLoading(false);
                setIsRetrying(false);
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        loadStats({ mode: 'initial' });
        intervalRef.current = setInterval(() => loadStats({ mode: 'background' }), 10000);

        return () => {
            mountedRef.current = false;
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [loadStats]);

    useAdminReconnectRefresh(() => loadStats({ mode: 'resume' }));

    const handleRetry = useCallback(() => {
        setError(null);
        setLoading(true);
        loadStats({ mode: 'initial' });
    }, [loadStats]);

    return {
        stats,
        loading,
        error,
        lastSuccessfulUpdate,
        refreshError,
        isRetrying,
        dateRange,
        setDateRange,
        setRefreshError,
        loadStats,
        handleRetry,
    };
}

export default useDashboardData;
