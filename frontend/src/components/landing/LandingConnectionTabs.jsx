export default function LandingConnectionTabs({
    connectionTab,
    onChange,
    areaFilteredCameras,
    favorites,
    favoritesInAreaCount,
}) {
    const stableCount = areaFilteredCameras.filter((camera) => camera.is_tunnel !== 1).length;
    const tunnelCount = areaFilteredCameras.filter((camera) => camera.is_tunnel === 1).length;

    return (
        <div>
            <div className="flex w-fit flex-wrap gap-2 rounded-xl bg-gray-100 p-1.5 dark:bg-gray-800">
                <button
                    onClick={() => onChange('all')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        connectionTab === 'all'
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                >
                    Semua ({areaFilteredCameras.length})
                </button>
                <button
                    onClick={() => onChange('stable')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                        connectionTab === 'stable'
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                >
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Stabil ({stableCount})
                </button>
                <button
                    onClick={() => onChange('tunnel')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                        connectionTab === 'tunnel'
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                >
                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                    Tunnel ({tunnelCount})
                </button>
                {favorites.length > 0 && (
                    <button
                        onClick={() => onChange('favorites')}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                            connectionTab === 'favorites'
                                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        }`}
                    >
                        <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                        Favorit ({favoritesInAreaCount})
                    </button>
                )}
            </div>

            {connectionTab === 'tunnel' && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-400">
                    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>Kamera tunnel mungkin kurang stabil. Refresh jika stream tidak muncul.</span>
                </div>
            )}
        </div>
    );
}
