/*
 * Purpose: Render compact public playback token controls for manual activation and active-token status.
 * Caller: Playback page normal and denied states.
 * Deps: React event handling only.
 * MainFuncs: PlaybackTokenAccess.
 * SideEffects: Invokes token activation/clear callbacks from props.
 */

export default function PlaybackTokenAccess({
    tokenInput,
    onTokenInputChange,
    onActivate,
    onClear,
    isBusy,
    tokenStatus,
    message,
    compact = false,
}) {
    const handleSubmit = (event) => {
        event.preventDefault();
        onActivate(tokenInput);
    };
    const activeCameraCount = tokenStatus?.allowed_camera_ids?.length || tokenStatus?.camera_ids?.length || 0;
    const activeRuleWindow = tokenStatus?.effective_playback_window_hours
        || tokenStatus?.playback_window_hours
        || tokenStatus?.camera_rules?.find((rule) => rule?.playback_window_hours)?.playback_window_hours
        || null;

    return (
        <form
            onSubmit={handleSubmit}
            className={`rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${compact ? 'w-full' : ''}`}
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Token Playback
                    </label>
                    <input
                        type="password"
                        value={tokenInput}
                        onChange={(event) => onTokenInputChange(event.target.value)}
                        placeholder="Masukkan token akses"
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                    />
                </div>
                <div className="flex gap-2">
                    <button
                        type="submit"
                        disabled={isBusy || !tokenInput.trim()}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Aktifkan
                    </button>
                    {tokenStatus && (
                        <button
                            type="button"
                            onClick={onClear}
                            disabled={isBusy}
                            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-200 disabled:opacity-60 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            Hapus
                        </button>
                    )}
                </div>
            </div>
            {(message || tokenStatus) && (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                    {message || 'Token aktif'}
                    {tokenStatus?.expires_at ? ` sampai ${tokenStatus.expires_at}` : tokenStatus ? ' tanpa tanggal kedaluwarsa' : ''}
                    {tokenStatus && activeCameraCount > 0 ? ` - Akses: ${activeCameraCount} kamera` : ''}
                    {tokenStatus && activeRuleWindow ? ` - Window: ${activeRuleWindow} jam terakhir` : ''}
                </div>
            )}
        </form>
    );
}
