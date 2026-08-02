/*
 * Purpose: Step to the neighbouring recording segment from directly beneath the player.
 * Caller: Playback page, immediately below PlaybackVideo.
 * Deps: Caller-provided segment array and selection handler; Intl date/time formatting.
 * MainFuncs: PlaybackSegmentStepper.
 * SideEffects: Invokes the caller-provided segment click handler.
 *
 * WHY IT EXISTS
 * Changing segment used to mean scrolling past the auto-play toggle, the access panel, an ad, the
 * share button, the usage guide, and the timeline — five blocks a viewer reads once — to reach the
 * list, then scrolling back up to watch. Moving the list up alone would not have fixed it: stepping
 * one segment back would still cost a scroll and a hunt for the right row.
 *
 * DIRECTION
 * "Sebelumnya" means EARLIER IN TIME, matching the recording the viewer is watching rather than the
 * order of the list above it. The list is sorted newest-first, so earlier is a HIGHER index there —
 * hence the sort here is its own, and deliberately not shared.
 */

const formatRange = (segment) => {
    const time = (value) => new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return `${time(segment.start_time)} - ${time(segment.end_time)}`;
};

const formatDay = (value) => new Date(value).toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
});

/** Chevron only on a phone, where the labels would squeeze the timestamp out of the row. */
function StepButton({ label, hint, disabled, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={hint}
            title={hint}
            className="flex shrink-0 items-center gap-1.5 rounded-control border border-edge px-2.5 py-2 text-sm font-medium text-content transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
        >
            {children}
            <span className="hidden sm:inline">{label}</span>
        </button>
    );
}

export default function PlaybackSegmentStepper({
    segments = [],
    selectedSegment,
    onSegmentClick,
}) {
    if (!segments.length) {
        return null;
    }

    // Oldest first, so "previous" is simply one step back.
    const ordered = [...segments].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const current = ordered.findIndex((segment) => segment.id === selectedSegment?.id);
    const older = current > 0 ? ordered[current - 1] : null;
    const newer = current >= 0 && current < ordered.length - 1 ? ordered[current + 1] : null;

    return (
        <div className="flex items-center gap-2 rounded-card border border-edge bg-surface p-2 sm:p-3">
            <StepButton
                label="Sebelumnya"
                hint="Segmen sebelumnya (lebih lama)"
                disabled={!older}
                onClick={() => older && onSegmentClick(older)}
            >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
            </StepButton>

            <div className="min-w-0 flex-1 text-center">
                {selectedSegment ? (
                    <>
                        <div className="truncate text-sm font-semibold tabular-nums text-content">
                            {formatRange(selectedSegment)}
                        </div>
                        <div className="truncate text-xs text-content-muted">
                            {formatDay(selectedSegment.start_time)}
                            {/* Counted oldest-first here would contradict the list; both say "1" for the newest. */}
                            {current >= 0 && ` · Segmen ${ordered.length - current} dari ${ordered.length}`}
                        </div>
                    </>
                ) : (
                    <div className="text-sm text-content-muted">Pilih segmen di bawah</div>
                )}
            </div>

            <StepButton
                label="Berikutnya"
                hint="Segmen berikutnya (lebih baru)"
                disabled={!newer}
                onClick={() => newer && onSegmentClick(newer)}
            >
                <svg className="order-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
            </StepButton>
        </div>
    );
}
