import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import recordingService from '../../services/recordingService';
import { REQUEST_POLICY } from '../../services/requestPolicy';
import { useAdminReconnectRefresh } from './useAdminReconnectRefresh';

export function useRecordingDashboardData() {
    const [recordings, setRecordings] = useState([]);
    const [restartLogs, setRestartLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const requestIdRef = useRef(0);

    const fetchData = useCallback(async ({ mode = 'initial' } = {}) => {
        const isBackgroundMode = mode === 'background' || mode === 'resume';
        const requestId = ++requestIdRef.current;

        try {
            if (!isBackgroundMode) {
                setError(null);
            }

            const policy = isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING;
            const [recordingsRes, restartsRes] = await Promise.all([
                recordingService.getRecordingsOverview(policy),
                recordingService.getRestartLogs(null, 50, policy),
            ]);

            if (requestId !== requestIdRef.current) {
                return;
            }

            if (recordingsRes.success && recordingsRes.data) {
                setRecordings(recordingsRes.data.cameras || recordingsRes.data || []);
            } else if (!isBackgroundMode) {
                setRecordings([]);
            }

            if (restartsRes.success && restartsRes.data) {
                setRestartLogs(restartsRes.data);
            } else if (!isBackgroundMode) {
                setRestartLogs([]);
            }
        } catch (error) {
            if (requestId !== requestIdRef.current) {
                return;
            }

            if (!isBackgroundMode) {
                setError(error.response?.data?.message || error.message || 'Failed to load recording data');
                setRecordings([]);
                setRestartLogs([]);
            }
        } finally {
            if (requestId === requestIdRef.current && !isBackgroundMode) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        fetchData({ mode: 'initial' });
        const interval = setInterval(() => fetchData({ mode: 'background' }), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    useAdminReconnectRefresh(() => fetchData({ mode: 'resume' }));

    const summary = useMemo(() => {
        const recordingCount = recordings.filter((item) => item.runtime_status?.isRecording || item.recording_status === 'recording').length;
        const totalSegments = recordings.reduce((total, item) => total + (item.storage?.segmentCount || item.segment_count || 0), 0);
        const totalSize = recordings.reduce((total, item) => total + (item.storage?.totalSize || item.total_size || 0), 0);

        return {
            cameras: recordings.length,
            recordingCount,
            totalSegments,
            totalSize,
        };
    }, [recordings]);

    return {
        recordings,
        restartLogs,
        loading,
        error,
        summary,
        fetchData,
    };
}

export default useRecordingDashboardData;
