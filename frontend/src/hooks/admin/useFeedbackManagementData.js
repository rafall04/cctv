import { useCallback, useEffect, useRef, useState } from 'react';
import { feedbackService } from '../../services/feedbackService';
import { REQUEST_POLICY } from '../../services/requestPolicy';
import { useAdminReconnectRefresh } from './useAdminReconnectRefresh';

export function useFeedbackManagementData() {
    const [feedbacks, setFeedbacks] = useState([]);
    const [stats, setStats] = useState({ total: 0, unread: 0, read: 0, resolved: 0 });
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [filter, setFilter] = useState('');
    const [selectedFeedback, setSelectedFeedback] = useState(null);
    const requestIdRef = useRef(0);

    const fetchFeedbacks = useCallback(async ({ mode = 'initial' } = {}) => {
        const isBackgroundMode = mode === 'background' || mode === 'resume';
        const requestId = ++requestIdRef.current;

        if (!isBackgroundMode) {
            setLoading(true);
        }

        try {
            const params = { page: pagination.page, limit: pagination.limit };
            if (filter) {
                params.status = filter;
            }

            const response = await feedbackService.getAll(
                params,
                isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING
            );

            if (requestId !== requestIdRef.current) {
                return;
            }

            setFeedbacks(response.data);
            setPagination((previous) => ({ ...previous, ...response.pagination }));
        } catch (error) {
            if (requestId === requestIdRef.current) {
                console.error('Failed to fetch feedbacks:', error);
            }
        } finally {
            if (requestId === requestIdRef.current && !isBackgroundMode) {
                setLoading(false);
            }
        }
    }, [filter, pagination.limit, pagination.page]);

    const fetchStats = useCallback(async ({ mode = 'initial' } = {}) => {
        try {
            const response = await feedbackService.getStats(
                mode === 'background' || mode === 'resume'
                    ? REQUEST_POLICY.BACKGROUND
                    : REQUEST_POLICY.BLOCKING
            );
            setStats(response.data);
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        }
    }, []);

    useEffect(() => {
        fetchFeedbacks({ mode: 'initial' });
        fetchStats({ mode: 'initial' });
    }, [fetchFeedbacks, fetchStats]);

    useAdminReconnectRefresh(() => Promise.all([
        fetchFeedbacks({ mode: 'resume' }),
        fetchStats({ mode: 'resume' }),
    ]));

    const refreshAll = useCallback(() => {
        fetchFeedbacks({ mode: 'initial' });
        fetchStats({ mode: 'initial' });
    }, [fetchFeedbacks, fetchStats]);

    return {
        feedbacks,
        stats,
        loading,
        pagination,
        setPagination,
        filter,
        setFilter,
        selectedFeedback,
        setSelectedFeedback,
        fetchFeedbacks,
        fetchStats,
        refreshAll,
    };
}

export default useFeedbackManagementData;
