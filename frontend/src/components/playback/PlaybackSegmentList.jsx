/*
 * Purpose: Render the selectable list of recorded playback segments for a camera.
 * Caller: Playback page (public preview and admin full scope).
 * Deps: Caller-provided segment array and selection handler; Intl date/time formatting.
 * MainFuncs: PlaybackSegmentList.
 * SideEffects: Invokes the caller-provided segment click handler.
 */

export default function PlaybackSegmentList({
    segments,
    selectedSegment,
    onSegmentClick,
}) {
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const formatSegmentDate = (timestamp) => {
        return new Date(timestamp).toLocaleDateString('id-ID', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    const formatSegmentTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="rounded-card border border-edge bg-surface p-3 sm:p-4 md:p-6">
            <h2 className="mb-3 text-base font-semibold text-content sm:mb-4 sm:text-lg">
                Segmen Rekaman ({segments.length})
            </h2>

            {segments.length > 0 ? (
                <div className="max-h-64 divide-y divide-edge overflow-y-auto sm:max-h-80 md:max-h-96">
                    {[...segments].sort((a, b) =>
                        new Date(b.start_time) - new Date(a.start_time)
                    ).map((segment, idx) => {
                        const isLikelyCompatible = segment.duration >= 60;
                        const isSelected = selectedSegment?.id === segment.id;

                        return (
                            <button
                                key={segment.id ?? `segment-${idx}`}
                                onClick={() => onSegmentClick(segment)}
                                aria-current={isSelected ? 'true' : undefined}
                                /*
                                 * Rows were `border-2` boxes with their own icon tile, which made a
                                 * long scrolling list read as a stack of cards. A shared divider plus
                                 * a left accent on the active row keeps the eye on the content.
                                 */
                                className={`w-full border-l-2 py-2.5 pl-3 pr-2 text-left transition-colors sm:py-3 ${isSelected
                                    ? 'border-l-primary bg-primary/5'
                                    : 'border-l-transparent hover:bg-surface-raised'
                                    }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <span className="truncate text-sm font-medium text-content">
                                                {formatSegmentDate(segment.start_time)}
                                            </span>
                                            <span className="text-xs tabular-nums text-content-muted sm:text-sm">
                                                {formatSegmentTime(segment.start_time)} - {formatSegmentTime(segment.end_time)}
                                            </span>
                                            {!isLikelyCompatible && (
                                                <span className="shrink-0 text-xs font-medium text-status-warn">
                                                    Mungkin tak bisa diputar
                                                </span>
                                            )}
                                        </div>
                                        <div className="truncate text-xs tabular-nums text-content-subtle sm:text-sm">
                                            Durasi: {Math.round(segment.duration / 60)} menit • Ukuran: {formatFileSize(segment.file_size)}
                                        </div>
                                    </div>

                                    {isSelected && (
                                        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary sm:gap-2 sm:text-sm">
                                            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true"></span>
                                            <span className="hidden sm:inline">Diputar</span>
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="py-8 text-center text-content-muted sm:py-12">
                    <svg className="mx-auto mb-3 h-12 w-12 text-content-subtle sm:mb-4 sm:h-16 sm:w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm sm:text-base">Belum ada recording tersedia</p>
                    <p className="mt-2 text-xs sm:text-sm">Recording akan muncul setelah kamera mulai merekam</p>
                </div>
            )}
        </div>
    );
}
