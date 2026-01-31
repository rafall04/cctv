/**
 * Top Cameras Widget Component
 * Shows top 5 cameras by viewer count with mini bar chart
 * Lightweight and optimized for all devices
 */
export function TopCamerasWidget({ cameras, onCameraClick }) {
    if (!cameras || cameras.length === 0) {
        return (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Kamera Populer</h3>
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700/50 rounded-xl flex items-center justify-center text-gray-400 dark:text-gray-500 mb-3">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Belum ada viewer aktif</p>
                </div>
            </div>
        );
    }

    const maxViewers = Math.max(...cameras.map(c => c.viewers), 1);

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Kamera Populer</h3>
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    By Viewers
                </span>
            </div>

            <div className="space-y-3">
                {cameras.map((camera, idx) => (
                    <div 
                        key={camera.id} 
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer"
                        onClick={() => onCameraClick && onCameraClick(camera)}
                    >
                        {/* Rank */}
                        <span className={`text-lg font-bold w-6 text-center ${
                            idx === 0 ? 'text-amber-500' :
                            idx === 1 ? 'text-gray-400' :
                            idx === 2 ? 'text-orange-600' :
                            'text-gray-300 dark:text-gray-600'
                        }`}>
                            #{idx + 1}
                        </span>

                        {/* Camera Info & Bar */}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate mb-1">
                                {camera.name}
                            </p>
                            <div className="h-1.5 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full transition-all duration-500"
                                    style={{ width: `${(camera.viewers / maxViewers) * 100}%` }}
                                />
                            </div>
                        </div>

                        {/* Viewer Count */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-100 dark:bg-purple-500/10 rounded-lg">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
                            <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
                                {camera.viewers}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer Info */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    💡 Klik kamera untuk lihat detail viewer
                </p>
            </div>
        </div>
    );
}
