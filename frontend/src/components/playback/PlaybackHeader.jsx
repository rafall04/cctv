import CodecBadge from '../CodecBadge';

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
        <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 shadow-lg space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Playback Recording</h1>
                {onShare && (
                    <button
                        onClick={onShare}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        title="Bagikan tautan playback"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        <span className="hidden sm:inline">Bagikan</span>
                    </button>
                )}
            </div>
            
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    Pilih Kamera:
                </label>
                <select
                    value={selectedCamera?.id || ''}
                    onChange={(e) => {
                        const camera = cameras.find(c => c.id === parseInt(e.target.value));
                        onCameraChange(camera);
                    }}
                    className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                    {cameras.map((camera, idx) => (
                        <option key={camera.id ?? `cam-${idx}`} value={camera.id}>
                            {camera.name} - {camera.location || 'No location'}
                        </option>
                    ))}
                </select>
            </div>
            
            {selectedCamera && (
                <div className="p-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {selectedCamera.name}
                        </span>
                        {selectedCamera.video_codec && (
                            <CodecBadge codec={selectedCamera.video_codec} size="sm" showWarning={false} />
                        )}
                    </div>
                    {selectedCamera.location && (
                        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 text-sm">
                            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                            </svg>
                            <span>{selectedCamera.location}</span>
                        </div>
                    )}
                </div>
            )}

            {showPublicNotice && playbackPolicy?.notice?.enabled && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="flex items-start gap-3">
                        <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-300" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.981-1.742 2.981H4.42c-1.53 0-2.492-1.647-1.743-2.98l5.58-9.921zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-7a1 1 0 00-.993.883L9 7v3a1 1 0 001.993.117L11 10V7a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">
                                    {playbackPolicy.notice.title || 'Akses Playback Publik Terbatas'}
                                </span>
                                {typeof playbackPolicy.previewMinutes === 'number' && (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">
                                        Preview {playbackPolicy.previewMinutes} Menit
                                    </span>
                                )}
                            </div>
                            <p className="text-xs sm:text-sm leading-5">
                                {playbackPolicy.notice.text}
                            </p>
                            {contact?.href && (
                                <a
                                    href={contact.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
                                >
                                    {contact.label || 'Hubungi Admin'}
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}
            
            <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1">
                        <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                        </svg>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                Auto-play Segment Berikutnya
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                                {autoPlayEnabled 
                                    ? 'Video akan otomatis lanjut ke segment berikutnya' 
                                    : 'Video akan berhenti di akhir segment'}
                            </div>
                        </div>
                    </div>
                    
                    <button
                        onClick={onAutoPlayToggle}
                        className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                            autoPlayEnabled 
                                ? 'bg-blue-600' 
                                : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                        role="switch"
                        aria-checked={autoPlayEnabled}
                        aria-label="Toggle auto-play"
                    >
                        <span
                            className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                autoPlayEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                        />
                    </button>
                </div>
            </div>
        </div>
    );
}
