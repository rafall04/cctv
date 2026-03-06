function formatFileSize(bytes) {
    if (bytes === 0) {
        return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const index = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, index)) * 100) / 100} ${sizes[index]}`;
}

function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function RecordingCameraGrid({ recordings, onStartRecording, onStopRecording }) {
    if (recordings.length === 0) {
        return (
            <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700/50 dark:bg-gray-800/60">
                <p className="text-gray-500 dark:text-gray-400">Tidak ada kamera dengan recording enabled</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {recordings.map((recording) => {
                const cameraId = recording.id || recording.camera_id;
                const isRecording = recording.runtime_status?.isRecording || recording.recording_status === 'recording';
                const segmentCount = recording.storage?.segmentCount || recording.segment_count || 0;
                const totalSize = recording.storage?.totalSize || recording.total_size || 0;
                const oldestSegment = recording.storage?.oldestSegment || recording.oldest_segment;
                const newestSegment = recording.storage?.newestSegment || recording.newest_segment;

                return (
                    <div key={cameraId} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/60">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{recording.name || recording.camera_name}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{recording.location || 'No location'}</p>
                            </div>
                            <div className={`rounded-full px-3 py-1 text-xs font-medium ${
                                isRecording ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                                {isRecording ? 'Recording' : 'Stopped'}
                            </div>
                        </div>

                        <div className="space-y-2 mb-4">
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">Duration:</span>
                                <span className="text-gray-900 dark:text-white">{recording.recording_duration_hours || 5}h</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">Segments:</span>
                                <span className="text-gray-900 dark:text-white">{segmentCount}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">Total Size:</span>
                                <span className="text-gray-900 dark:text-white">{formatFileSize(totalSize)}</span>
                            </div>
                            {oldestSegment && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-gray-400">Oldest:</span>
                                    <span className="text-gray-900 dark:text-white">{formatTimestamp(oldestSegment)}</span>
                                </div>
                            )}
                            {newestSegment && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-gray-400">Newest:</span>
                                    <span className="text-gray-900 dark:text-white">{formatTimestamp(newestSegment)}</span>
                                </div>
                            )}
                        </div>

                        {isRecording ? (
                            <button
                                onClick={() => onStopRecording(cameraId)}
                                className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                            >
                                Stop Recording
                            </button>
                        ) : (
                            <button
                                onClick={() => onStartRecording(cameraId)}
                                className="w-full bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                            >
                                Start Recording
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
