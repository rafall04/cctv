/*
 * Purpose: Render the playback page header — camera picker, selected-camera summary, public access notice, and auto-play toggle.
 * Caller: Playback page (public preview and admin full scope).
 * Deps: Caller-provided camera list, playback policy payload, and share/toggle handlers.
 * MainFuncs: PlaybackHeader.
 * SideEffects: Invokes caller-provided camera change, share, and auto-play toggle handlers.
 */

export default function PlaybackHeader({
    cameras,
    selectedCamera,
    onCameraChange,
    autoPlayEnabled,
    onAutoPlayToggle,
    onShare,
    playbackPolicy = null,
    showPublicNotice = false,
}) {
    const contact = playbackPolicy?.contact || null;

    return (
        <div className="space-y-3 rounded-card border border-edge bg-surface p-3 sm:space-y-4 sm:p-4 md:p-6">
            <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold text-content sm:text-xl md:text-2xl">Playback Recording</h1>
                {onShare && (
                    <button
                        onClick={onShare}
                        className="flex items-center gap-2 rounded-control border border-edge px-3 py-1.5 text-sm font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface-raised"
                        title="Bagikan tautan playback"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        <span className="hidden sm:inline">Bagikan</span>
                    </button>
                )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="whitespace-nowrap text-sm font-medium text-content-muted">
                    Pilih Kamera:
                </label>
                <select
                    value={selectedCamera?.id || ''}
                    onChange={(e) => {
                        const camera = cameras.find(c => c.id === parseInt(e.target.value));
                        onCameraChange(camera);
                    }}
                    className="flex-1 rounded-control border border-edge bg-surface px-4 py-2 text-content focus:border-transparent focus:ring-2 focus:ring-primary"
                >
                    {cameras.map((camera, idx) => (
                        <option key={camera.id ?? `cam-${idx}`} value={camera.id}>
                            {camera.name} - {camera.location || 'No location'}
                        </option>
                    ))}
                </select>
            </div>

            {selectedCamera && (
                <div className="rounded-control border border-edge bg-surface-raised p-2.5">
                    {/* The codec badge that used to sit here was pinned to showWarning={false},
                        so it could only ever announce "H.264/AVC" — decoration, never advice. */}
                    <div className="text-sm font-semibold text-content">
                        {selectedCamera.name}
                    </div>
                    {selectedCamera.location && (
                        <div className="mt-1 flex items-center gap-1.5 text-sm text-content-muted">
                            <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                            </svg>
                            <span>{selectedCamera.location}</span>
                        </div>
                    )}
                </div>
            )}

            {showPublicNotice && playbackPolicy?.notice?.enabled && (
                // Genuinely a warning, so it keeps a warning colour — but from the token
                // layer, and as a left rule rather than a filled amber slab.
                <div className="rounded-control border border-edge border-l-2 border-l-status-warn bg-surface-raised px-4 py-3 text-sm text-content">
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">
                                {playbackPolicy.notice.title || 'Akses Playback Publik Terbatas'}
                            </span>
                            {typeof playbackPolicy.previewMinutes === 'number' && (
                                <span className="text-[11px] font-medium tabular-nums text-status-warn">
                                    Preview {playbackPolicy.previewMinutes} Menit
                                </span>
                            )}
                        </div>
                        <p className="text-xs leading-5 text-content-muted sm:text-sm">
                            {playbackPolicy.notice.text}
                        </p>
                        {contact?.href && (
                            <a
                                href={contact.href}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-2 rounded-control border border-edge px-3 py-1.5 text-xs font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface"
                            >
                                {contact.label || 'Hubungi Admin'}
                            </a>
                        )}
                    </div>
                </div>
            )}

            {/* Was a blue→indigo gradient panel, which introduced a second accent colour
                competing with the brand primary for a plain settings row. */}
            <div className="rounded-control border border-edge p-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-content">
                            Auto-play Segment Berikutnya
                        </div>
                        <div className="text-xs text-content-muted">
                            {autoPlayEnabled
                                ? 'Video akan otomatis lanjut ke segment berikutnya'
                                : 'Video akan berhenti di akhir segment'}
                        </div>
                    </div>

                    <button
                        onClick={onAutoPlayToggle}
                        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${autoPlayEnabled ? 'bg-primary' : 'bg-edge-strong'
                            }`}
                        role="switch"
                        aria-checked={autoPlayEnabled}
                        aria-label="Toggle auto-play"
                    >
                        <span
                            className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white transition duration-200 ease-in-out ${autoPlayEnabled ? 'translate-x-5' : 'translate-x-0'
                                }`}
                        />
                    </button>
                </div>
            </div>
        </div>
    );
}
