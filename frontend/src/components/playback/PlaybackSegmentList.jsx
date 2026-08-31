/*
 * Purpose: Render the selectable list of recorded playback segments for a camera.
 * Caller: Playback page (public preview and admin full scope).
 * Deps: Caller-provided segment array and selection handler; Intl date/time formatting.
 * MainFuncs: PlaybackSegmentList.
 * SideEffects: Invokes the caller-provided segment click handler.
 *
 * WHY THE MEMOISATION IS LOAD-BEARING
 * The page re-renders on every `timeupdate` — about four times a second while a segment plays. This
 * list depends on none of that, but it used to re-sort the whole array (≈21,000 `new Date()`
 * allocations at admin scope) and rebuild every row on each of those renders. `toLocaleDateString`
 * and `toLocaleTimeString` each construct a fresh `Intl.DateTimeFormat` internally, so ~1,065 rows
 * cost ~3,200 formatter constructions per render. Both formatters are now built once per configured
 * timezone (useMemo keyed on it) and passed down as props, the sort is memoised on `segments`, and
 * each row is behind `memo` so changing the selection repaints two rows instead of the whole list.
 *
 * The formatters carry the app's CONFIGURED timezone (not the browser's) so a non-WIB viewer sees
 * the same wall-clock as the video overlay and share text.
 */

import { memo, useMemo } from 'react';
import { useTimezone } from '../../contexts/TimezoneContext.jsx';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round((bytes / 1024 ** i) * 100) / 100} ${SIZE_UNITS[i]}`;
}

const SegmentRow = memo(function SegmentRow({ segment, isSelected, onSegmentClick, dateFmt, timeFmt }) {
    const isLikelyCompatible = segment.duration >= 60;

    return (
        <button
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
                            {dateFmt.format(new Date(segment.start_time))}
                        </span>
                        <span className="text-xs tabular-nums text-content-muted sm:text-sm">
                            {timeFmt.format(new Date(segment.start_time))} - {timeFmt.format(new Date(segment.end_time))}
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
});

function PlaybackSegmentList({
    segments,
    selectedSegment,
    onSegmentClick,
    isLoading = false,
}) {
    const { timezone } = useTimezone();

    const dateFmt = useMemo(() => new Intl.DateTimeFormat('id-ID', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
    }), [timezone]);

    const timeFmt = useMemo(() => new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
    }), [timezone]);

    const newestFirst = useMemo(
        () => [...segments].sort((a, b) => new Date(b.start_time) - new Date(a.start_time)),
        [segments],
    );

    /*
     * Dilipat HANYA saat tepat satu segmen. Halaman ini punya TIGA pemilih segmen — stepper
     * melangkah, timeline bisa diklik, daftar ini bisa dipilih — dan saat cuma ada satu, ketiganya
     * menyatakan fakta yang sama; "Segmen 1 dari 1" di stepper menyebutnya sekali lagi. Empat kali,
     * satu fakta, di tiga kartu besar.
     *
     * Nol tetap terbuka: pesan kosongnya adalah jawabannya. Dua ke atas tetap terbuka: di sana
     * memilih memang berarti sesuatu. Yang dilipat bukan kemampuan — barisnya tetap ada di dalam,
     * satu ketukan, lengkap dengan ukuran berkas yang tidak pernah diberitahu timeline.
     */
    const tunggal = !isLoading && newestFirst.length === 1;

    return (
        /*
         * <details> asli, bukan state React: bisa dibuka lewat keyboard, ikut pencarian browser,
         * dan sudah bekerja sebelum JS hidrasi. `open` hanya menentukan keadaan AWAL — pengunjung
         * tetap boleh melipat daftar panjang kalau ia mau.
         */
        <details open={!tunggal} className="rounded-card border border-edge bg-surface">
            {/*
              * The count is withheld until it is known. "Segmen Rekaman (0)" during the fetch reads
              * as a finished answer — the camera has nothing — when in truth nothing had been asked
              * yet, which is precisely the misleading state this heading used to create.
              */}
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4">
                <h2 className="text-base font-semibold text-content sm:text-lg">
                    Segmen Rekaman {isLoading ? '' : `(${segments.length})`}
                </h2>
                <span className="shrink-0 text-xs text-content-muted">{tunggal ? 'Rincian' : 'Sembunyikan'}</span>
            </summary>

            <div className="px-3 pb-3 sm:px-4 sm:pb-4 md:px-6 md:pb-6">
            {isLoading ? (
                <div className="py-8 text-center text-content-muted sm:py-12">
                    <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-primary sm:mb-4" />
                    <p className="text-sm sm:text-base">Memuat daftar rekaman...</p>
                </div>
            ) : newestFirst.length > 0 ? (
                <div className="max-h-64 divide-y divide-edge overflow-y-auto sm:max-h-80 md:max-h-96">
                    {newestFirst.map((segment, idx) => (
                        <SegmentRow
                            key={segment.id ?? `segment-${idx}`}
                            segment={segment}
                            isSelected={selectedSegment?.id === segment.id}
                            onSegmentClick={onSegmentClick}
                            dateFmt={dateFmt}
                            timeFmt={timeFmt}
                        />
                    ))}
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
        </details>
    );
}

export default memo(PlaybackSegmentList);
