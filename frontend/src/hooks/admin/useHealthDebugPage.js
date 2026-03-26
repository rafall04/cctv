import { useCallback, useEffect, useRef, useState } from 'react';
import { adminService } from '../../services/adminService';
import { REQUEST_POLICY } from '../../services/requestPolicy';
import { useAdminReconnectRefresh } from './useAdminReconnectRefresh';

const DEFAULT_QUERY = {
    state: 'problem',
    deliveryType: '',
    errorClass: '',
    search: '',
    page: 1,
    limit: 25,
    sort: 'severity',
};

export function useHealthDebugPage() {
    const [query, setQuery] = useState(DEFAULT_QUERY);
    const [summary, setSummary] = useState(null);
    const [items, setItems] = useState([]);
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 25,
        totalItems: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshError, setRefreshError] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const requestIdRef = useRef(0);
    const mountedRef = useRef(true);
    const queryRef = useRef(DEFAULT_QUERY);
    const itemsRef = useRef([]);

    useEffect(() => {
        queryRef.current = query;
    }, [query]);

    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const loadHealthDebug = useCallback(async ({ mode = 'initial', overrides = null } = {}) => {
        const isBackgroundMode = mode === 'background' || mode === 'resume';
        const requestId = ++requestIdRef.current;
        const effectiveQuery = overrides || queryRef.current;

        try {
            if (!isBackgroundMode && mountedRef.current) {
                setLoading(true);
                setError(null);
            }

            const response = await adminService.getCameraHealthDebug(
                effectiveQuery,
                isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING
            );

            if (!mountedRef.current || requestId !== requestIdRef.current) {
                return;
            }

            if (response.success) {
                setSummary(response.data?.summary || null);
                setItems(Array.isArray(response.data?.items) ? response.data.items : []);
                setPagination(response.data?.pagination || {
                    page: effectiveQuery.page,
                    limit: effectiveQuery.limit,
                    totalItems: 0,
                    totalPages: 1,
                    hasNextPage: false,
                    hasPreviousPage: false,
                });
                setError(null);
                setRefreshError(false);
                setLastUpdated(new Date());
            } else if (isBackgroundMode && itemsRef.current.length > 0) {
                setRefreshError(true);
            } else {
                setError(response.message || 'Failed to load health diagnostics');
            }
        } catch (requestError) {
            if (!mountedRef.current || requestId !== requestIdRef.current) {
                return;
            }

            if (isBackgroundMode && itemsRef.current.length > 0) {
                setRefreshError(true);
            } else {
                setError(requestError.response?.data?.message || 'Failed to load health diagnostics');
            }
        } finally {
            if (mountedRef.current && requestId === requestIdRef.current && !isBackgroundMode) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        loadHealthDebug({ mode: 'initial' });
    }, [loadHealthDebug, query]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            loadHealthDebug({ mode: 'background' });
        }, 30000);

        return () => {
            clearInterval(intervalId);
        };
    }, [loadHealthDebug]);

    useAdminReconnectRefresh(() => loadHealthDebug({ mode: 'resume' }));

    const updateQuery = useCallback((patch) => {
        setQuery((current) => ({
            ...current,
            ...patch,
        }));
    }, []);

    const setFilter = useCallback((key, value) => {
        setQuery((current) => ({
            ...current,
            [key]: value,
            page: 1,
        }));
    }, []);

    const setPage = useCallback((page) => {
        setQuery((current) => ({
            ...current,
            page,
        }));
    }, []);

    const refresh = useCallback(() => {
        loadHealthDebug({ mode: 'initial' });
    }, [loadHealthDebug]);

    return {
        query,
        summary,
        items,
        pagination,
        loading,
        error,
        refreshError,
        lastUpdated,
        updateQuery,
        setFilter,
        setPage,
        refresh,
    };
}

export default useHealthDebugPage;
