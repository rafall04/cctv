/**
 * Top Performing Cameras Widget
 * Visual ranking of cameras by viewer count
 */
export function TopCamerasWidget({ cameras = [] }) {
    if (!cameras || cameras.length === 0) {
        return (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">🏆 Top Cameras</h3>
                <div className="text-center py-8">
                    <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400">Belum ada data viewer</p>
                </div>
            </div>
        );
    }

    const getRankIcon = (index) => {
        if (index === 0) return '🥇';
        if (index === 1) return '🥈';
        if (index === 2) return '🥉';
        return `${index + 1}.`;
    };

    const getRankColor = (index) => {
        if (index === 0) return 'from-amber-400 to-yellow-500';
        if (index === 1) return 'from-gray-300 to-gray-400';
        if (index === 2) return 'from-orange-400 to-amber-500';
        return 'from-gray-200 to-gray-300';
    };

    const getBarColor = (index) => {
        if (index === 0) return 'bg-gradient-to-r from-amber-500 to-yellow-600';
        if (index === 1) return 'bg-gradient-to-r from-gray-400 to-gray-500';
        if (index === 2) return 'bg-gradient-to-r from-orange-500 to-amber-600';
        return 'bg-gradient-to-r from-sky-400 to-blue-500';
    };

    // Calculate max viewers for bar width
    const maxViewers = Math.max(...cameras.map(c => c.viewers), 1);

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">🏆 Top Cameras</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">By viewers</span>
            </div>

            <div className="space-y-4">
                {cameras.map((camera, index) => {
                    const barWidth = maxViewers > 0 ? (camera.viewers / maxViewers) * 100 : 0;
                    
                    return (
                        <div key={camera.id} className="group">
                            <div className="flex items-center gap-3 mb-2">
                                {/* Rank Badge */}
                                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getRankColor(index)} flex items-center justify-center text-white font-bold shadow-lg flex-shrink-0`}>
                                    {index < 3 ? (
                                        <span className="text-xl">{getRankIcon(index)}</span>
                                    ) : (
                                        <span className="text-sm">{index + 1}</span>
                                    )}
                                </div>

                                {/* Camera Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <h4 className="font-semibold text-gray-900 dark:text-white truncate text-sm">
                                            {camera.name}
                                        </h4>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                            <span className="text-sm font-bold text-gray-900 dark:text-white">
                                                {camera.viewers}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="relative h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                                        <div 
                                            className={`h-full ${getBarColor(index)} transition-all duration-500 ease-out`}
                                            style={{ width: `${barWidth}%` }}
                                        >
                                            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {cameras.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <p className="text-sm">Belum ada viewer aktif</p>
                </div>
            )}
        </div>
    );
}
