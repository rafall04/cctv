import recordingService from '../services/recordingService';
import { useNotification } from '../contexts/NotificationContext';
import { TableSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';
import { useRecordingDashboardData } from '../hooks/admin/useRecordingDashboardData';
import RecordingSummaryCards from '../components/admin/recordings/RecordingSummaryCards';
import RecordingCameraGrid from '../components/admin/recordings/RecordingCameraGrid';
import RecordingRestartLogs from '../components/admin/recordings/RecordingRestartLogs';

function RecordingLoadingState() {
    return (
        <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
            </div>
            <TableSkeleton rows={8} columns={6} />
        </div>
    );
}

export default function RecordingDashboard() {
    const { showNotification } = useNotification();
    const {
        recordings,
        restartLogs,
        loading,
        error,
        refreshError,
        lastSuccessfulUpdate,
        summary,
        fetchData,
    } = useRecordingDashboardData();

    const formatLastUpdate = (date) => {
        if (!date) return 'Belum ada data';
        const diff = Math.floor((Date.now() - date.getTime()) / 1000);
        if (diff < 60) return 'Baru saja';
        if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
        return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    };

    const handleStartRecording = async (cameraId) => {
        try {
            const response = await recordingService.startRecording(cameraId);
            if (response.success) {
                showNotification('Recording started successfully', 'success');
                fetchData({ mode: 'initial' });
            }
        } catch (error) {
            showNotification(error.response?.data?.message || 'Failed to start recording', 'error');
        }
    };

    const handleStopRecording = async (cameraId) => {
        try {
            const response = await recordingService.stopRecording(cameraId);
            if (response.success) {
                showNotification('Recording stopped successfully', 'success');
                fetchData({ mode: 'initial' });
            }
        } catch (error) {
            showNotification(error.response?.data?.message || 'Failed to stop recording', 'error');
        }
    };

    if (loading) {
        return <RecordingLoadingState />;
    }

    return (
        <div className="space-y-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/60">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-primary">Recording Overview</p>
                        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">Recording Dashboard</h1>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Monitor recording aktif, kapasitas segmen, dan auto-restart kamera.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            Update terakhir: {formatLastUpdate(lastSuccessfulUpdate)}
                        </span>
                        <button
                            onClick={() => fetchData({ mode: 'initial' })}
                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {refreshError && !error && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                    Refresh background gagal. Data terakhir yang valid tetap ditampilkan.
                </div>
            )}

            {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-500/30 dark:bg-red-500/10">
                    <div className="flex items-center gap-3">
                        <svg className="w-6 h-6 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <h3 className="font-semibold text-red-700 dark:text-red-400">Error Loading Data</h3>
                            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{error}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => fetchData({ mode: 'initial' })}
                        className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
                    >
                        Retry
                    </button>
                </div>
            )}

            <RecordingSummaryCards summary={summary} />
            <RecordingCameraGrid
                recordings={recordings}
                onStartRecording={handleStartRecording}
                onStopRecording={handleStopRecording}
            />
            <RecordingRestartLogs logs={restartLogs} />
        </div>
    );
}
