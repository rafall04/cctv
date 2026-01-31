import { useState, useEffect } from 'react';
import recordingService from '../services/recordingService';
import { useNotification } from '../contexts/NotificationContext';
import { TableSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';

function RecordingDashboard() {
    const [recordings, setRecordings] = useState([]);
    const [restartLogs, setRestartLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { showNotification } = useNotification();

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Refresh setiap 10 detik
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            setError(null);
            
            const [recordingsRes, restartsRes] = await Promise.all([
                recordingService.getRecordingsOverview(),
                recordingService.getRestartLogs()
            ]);

            if (recordingsRes.success && recordingsRes.data) {
                // Handle both old and new response format
                const camerasData = recordingsRes.data.cameras || recordingsRes.data || [];
                setRecordings(camerasData);
            } else {
                setRecordings([]);
            }

            if (restartsRes.success && restartsRes.data) {
                setRestartLogs(restartsRes.data);
            } else {
                setRestartLogs([]);
            }
        } catch (error) {
            console.error('Failed to fetch recording data:', error);
            const errorMessage = error.response?.data?.message || error.message || 'Failed to load recording data';
            setError(errorMessage);
            setRecordings([]);
            setRestartLogs([]);
        } finally {
            setLoading(false);
        }
    };

    const handleStartRecording = async (cameraId) => {
        try {
            const response = await recordingService.startRecording(cameraId);
            if (response.success) {
                showNotification('Recording started successfully', 'success');
                fetchData();
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
                fetchData();
            }
        } catch (error) {
            showNotification(error.response?.data?.message || 'Failed to stop recording', 'error');
        }
    };

    const formatDuration = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString('id-ID', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (loading) {
        return (
            <div className="p-6 space-y-6">
                {/* Stats Skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <StatCardSkeleton />
                    <StatCardSkeleton />
                    <StatCardSkeleton />
                    <StatCardSkeleton />
                </div>
                {/* Table Skeleton */}
                <TableSkeleton rows={8} columns={6} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-dark-900/90 backdrop-blur-md border border-dark-700/50 rounded-xl p-6">
                <h1 className="text-2xl font-bold text-white mb-2">Recording Dashboard</h1>
                <p className="text-dark-300">Monitor dan kelola recording CCTV</p>
            </div>

            {/* Error State */}
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
                        onClick={fetchData}
                        className="mt-4 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Recording Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {recordings.map((recording) => {
                    // Handle both runtime_status object and direct properties
                    const isRecording = recording.runtime_status?.isRecording || recording.recording_status === 'recording';
                    const segmentCount = recording.storage?.segmentCount || recording.segment_count || 0;
                    const totalSize = recording.storage?.totalSize || recording.total_size || 0;
                    const oldestSegment = recording.storage?.oldestSegment || recording.oldest_segment;
                    const newestSegment = recording.storage?.newestSegment || recording.newest_segment;
                    
                    return (
                        <div
                            key={recording.id || recording.camera_id}
                            className="bg-dark-900/90 backdrop-blur-md border border-dark-700/50 rounded-xl p-6"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="text-lg font-semibold text-white">{recording.name || recording.camera_name}</h3>
                                    <p className="text-sm text-dark-300">{recording.location || 'No location'}</p>
                                </div>
                                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                                    isRecording
                                        ? 'bg-red-500/20 text-red-400'
                                        : 'bg-dark-700 text-dark-300'
                                }`}>
                                    {isRecording ? '● Recording' : 'Stopped'}
                                </div>
                            </div>

                            <div className="space-y-2 mb-4">
                                <div className="flex justify-between text-sm">
                                    <span className="text-dark-400">Duration:</span>
                                    <span className="text-white">{recording.recording_duration_hours || 5}h</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-dark-400">Segments:</span>
                                    <span className="text-white">{segmentCount}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-dark-400">Total Size:</span>
                                    <span className="text-white">{formatFileSize(totalSize)}</span>
                                </div>
                                {oldestSegment && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-dark-400">Oldest:</span>
                                        <span className="text-white">{formatTimestamp(oldestSegment)}</span>
                                    </div>
                                )}
                                {newestSegment && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-dark-400">Newest:</span>
                                        <span className="text-white">{formatTimestamp(newestSegment)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-2">
                                {isRecording ? (
                                    <button
                                        onClick={() => handleStopRecording(recording.id || recording.camera_id)}
                                        className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                                    >
                                        Stop Recording
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleStartRecording(recording.id || recording.camera_id)}
                                        className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                                    >
                                        Start Recording
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {recordings.length === 0 && (
                <div className="bg-dark-900/90 backdrop-blur-md border border-dark-700/50 rounded-xl p-12 text-center">
                    <p className="text-dark-400">Tidak ada kamera dengan recording enabled</p>
                </div>
            )}

            {/* Restart Logs */}
            <div className="bg-dark-900/90 backdrop-blur-md border border-dark-700/50 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4">Auto-Restart Logs</h2>
                
                {restartLogs.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-dark-700">
                                    <th className="text-left py-3 px-4 text-dark-300 font-medium">Camera</th>
                                    <th className="text-left py-3 px-4 text-dark-300 font-medium">Reason</th>
                                    <th className="text-left py-3 px-4 text-dark-300 font-medium">Timestamp</th>
                                </tr>
                            </thead>
                            <tbody>
                                {restartLogs.slice(0, 20).map((log, index) => (
                                    <tr key={index} className="border-b border-dark-800 hover:bg-dark-800/50">
                                        <td className="py-3 px-4 text-white">{log.camera_name}</td>
                                        <td className="py-3 px-4">
                                            <span className={`px-2 py-1 rounded text-xs ${
                                                log.reason === 'timeout'
                                                    ? 'bg-yellow-500/20 text-yellow-400'
                                                    : 'bg-red-500/20 text-red-400'
                                            }`}>
                                                {log.reason}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-dark-300">{formatTimestamp(log.restarted_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="text-dark-400 text-center py-8">Belum ada restart logs</p>
                )}
            </div>
        </div>
    );
}

export default RecordingDashboard;
