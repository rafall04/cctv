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
        summary,
        fetchData,
    } = useRecordingDashboardData();

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
            <div className="bg-dark-900/90 backdrop-blur-md border border-dark-700/50 rounded-xl p-6">
                <h1 className="text-2xl font-bold text-white mb-2">Recording Dashboard</h1>
                <p className="text-dark-300">Monitor dan kelola recording CCTV</p>
            </div>

            {error && (
                <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <h3 className="text-red-400 font-semibold">Error Loading Data</h3>
                            <p className="text-red-300 text-sm mt-1">{error}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => fetchData({ mode: 'initial' })}
                        className="mt-4 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
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
