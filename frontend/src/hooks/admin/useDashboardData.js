import { useCallback, useEffect, useRef, useState } from 'react';
import { adminService } from '../../services/adminService';
import { REQUEST_POLICY } from '../../services/requestPolicy';
import { useAdminReconnectRefresh } from './useAdminReconnectRefresh';

export function useDashboardData() {
    const [stats, setStats] = useState(null);
    const [streams, setStreams] = useState([]);
    const [streamsLoaded, setStreamsLoaded] = useState(false);
    const [streamsError, setStreamsError] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState(null);
    const [refreshError, setRefreshError] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [dateRange, setDateRange] = useState('today');
    const intervalRef = useRef(null);
    const streamsIntervalRef = useRef(null);
    const statsRef = useRef(null);
    const requestIdRef = useRef(0);
    const streamsRequestIdRef = useRef(0);
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

    // The stream table is too heavy for the 10s stats poll (~142KB of ~145KB), so it loads
    // once, refreshes on a slower cadence for the top-8 panel, and is refetched fresh whenever
    // the "all streams" drawer opens. Stats still poll at 10s for the summary cards.
    const loadStreams = useCallback(async () => {
        const requestId = ++streamsRequestIdRef.current;

        try {
            const response = await adminService.getDashboardStreams(REQUEST_POLICY.BACKGROUND);

            if (!mountedRef.current || requestId !== streamsRequestIdRef.current) {
                return;
            }

            if (response.success) {
                setStreams(response.data?.streams || []);
                setStreamsLoaded(true);
                setStreamsError(false);
            } else {
                setStreamsError(true);
            }
        } catch (err) {
            if (!mountedRef.current || requestId !== streamsRequestIdRef.current) {
                return;
            }
            setStreamsError(true);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        loadStats({ mode: 'initial' });
        loadStreams();
        intervalRef.current = setInterval(() => loadStats({ mode: 'background' }), 10000);
        streamsIntervalRef.current = setInterval(loadStreams, 30000);

        return () => {
            mountedRef.current = false;
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
            if (streamsIntervalRef.current) {
                clearInterval(streamsIntervalRef.current);
            }
        };
    }, [loadStats, loadStreams]);

    useAdminReconnectRefresh(() => {
        loadStats({ mode: 'resume' });
        loadStreams();
    });

    const handleRetry = useCallback(() => {
        setError(null);
        setLoading(true);
        loadStats({ mode: 'initial' });
    }, [loadStats]);

    return {
        stats,
        streams,
        streamsLoaded,
        streamsError,
        loading,
        error,
        lastSuccessfulUpdate,
        refreshError,
        isRetrying,
        dateRange,
        setDateRange,
        setRefreshError,
        loadStats,
        loadStreams,
        handleRetry,
    };
}

export default useDashboardData;
