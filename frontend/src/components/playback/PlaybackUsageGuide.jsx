/**
 * Purpose: Presents public/admin playback usage guidance and preview policy messaging.
 * Caller: Playback page below share controls.
 * Deps: React JSX runtime and playback policy props.
 * MainFuncs: PlaybackUsageGuide.
 * SideEffects: None; presentational only.
 */
export default function PlaybackUsageGuide({ isAdminPlayback, playbackPolicy }) {
    return (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-3">
                <svg className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                {/* min-w-0: without it this flex-1 column keeps min-width:auto (= min-content),
                    and the unbreakable "Sebelumnya/Berikutnya" below pushed the admin shell to
                    322px inside a 320px phone at the Android 1.5x font scale. */}
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm sm:text-base font-semibold text-blue-900 dark:text-blue-100 mb-2">Cara Menggunakan Playback</h3>
                    <ul className="space-y-1.5 break-words text-xs sm:text-sm text-blue-800 dark:text-blue-200">
                        <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">&bull;</span><span className="min-w-0"><strong>Skip Video:</strong> Maksimal lompat 3 menit per sekali skip</span></li>
                        <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">&bull;</span><span className="min-w-0"><strong>Cari waktu:</strong> Klik pada batang waktu untuk melompat ke menit tertentu</span></li>
                        <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">&bull;</span><span className="min-w-0"><strong>Kecepatan:</strong> Klik tombol di pojok kanan atas video (0.5x - 2x)</span></li>
                        {/* "di bawah" was true until the segment list moved above this guide. */}
                        <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">&bull;</span><span className="min-w-0"><strong>Segment:</strong> Pakai tombol Sebelumnya/Berikutnya di bawah video, atau pilih dari daftar segmen</span></li>
                        {!isAdminPlayback && typeof playbackPolicy?.previewMinutes === 'number' && (
                            <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">-</span><span className="min-w-0"><strong>Preview Publik:</strong> Hanya {playbackPolicy.previewMinutes} menit awal yang tersedia demi privasi</span></li>
                        )}
                    </ul>
                    {/*
                     * The responsible-use warning moved OUT of here to directly under the player.
                     * At the foot of the last block on the page it was read by nobody who came to
                     * watch a clip and leave. See PlaybackResponsibleUseNotice.
                     */}
                </div>
            </div>
        </div>
    );
}
