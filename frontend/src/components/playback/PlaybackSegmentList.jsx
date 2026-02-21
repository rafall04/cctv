const DEBUG_MODE = true;
function log(...args) {
    if (DEBUG_MODE) console.log('[PlaybackSegmentList]', ...args);
}

export default function PlaybackSegmentList({
    segments,
    selectedSegment,
    onSegmentClick,
    formatTimestamp,
}) {
    log('📋 Render', { segmentsCount: segments.length, segmentIds: segments.map(s => s.id), selectedSegmentId: selectedSegment?.id });
    
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 shadow-lg">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">
                Recording Segments ({segments.length})
            </h2>
            
            {segments.length > 0 ? (
                <div className="space-y-2 max-h-64 sm:max-h-80 md:max-h-96 overflow-y-auto">
                    {[...segments].sort((a, b) => 
                        new Date(b.start_time) - new Date(a.start_time)
                    ).map((segment, idx) => {
                        const isLikelyCompatible = segment.duration >= 60;
                        
                        return (
                            <button
                                key={segment.id ?? `segment-${idx}`}
                                onClick={() => onSegmentClick(segment)}
                                className={`w-full text-left p-2 sm:p-3 md:p-4 rounded-lg border-2 transition-all ${
                                    selectedSegment?.id === segment.id
                                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                        : 'border-gray-200 dark:border-gray-800 hover:border-primary-300 dark:hover:border-primary-700'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                            selectedSegment?.id === segment.id
                                                ? 'bg-primary-500 text-white'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                                        }`}>
                                            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M8 5v14l11-7z"/>
                                            </svg>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <div className="font-medium text-sm sm:text-base text-gray-900 dark:text-white truncate">
                                                    {formatTimestamp(segment.start_time)} - {formatTimestamp(segment.end_time)}
                                                </div>
                                                {!isLikelyCompatible && (
                                                    <span className="px-1.5 sm:px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded flex-shrink-0">
                                                        May not play
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">
                                                Duration: {Math.round(segment.duration / 60)} min • Size: {formatFileSize(segment.file_size)}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {selectedSegment?.id === segment.id && (
                                        <div className="flex items-center gap-1 sm:gap-2 text-primary-500 flex-shrink-0">
                                            <svg className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                                                <circle cx="12" cy="12" r="10"/>
                                            </svg>
                                            <span className="hidden sm:inline text-sm font-medium">Playing</span>
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="text-center py-8 sm:py-12 text-gray-600 dark:text-gray-400">
                    <svg className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm sm:text-base">Belum ada recording tersedia</p>
                    <p className="text-xs sm:text-sm mt-2">Recording akan muncul setelah kamera mulai merekam</p>
                </div>
            )}
        </div>
    );
}
