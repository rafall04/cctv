/**
 * Camera Performance Table Component
 * Menampilkan metrik performa teknis setiap kamera
 */
export function CameraPerformanceTable({ data }) {
    if (!data || data.length === 0) {
        return (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Performa Kamera</h2>
                <div className="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500">
                    <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">Belum ada data performa kamera</p>
                </div>
            </div>
        );
    }

    // Helper untuk menentukan warna badge berdasarkan nilai
    const getBounceRateColor = (rate) => {
        if (rate < 20) return 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400';
        if (rate < 40) return 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400';
        if (rate < 60) return 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400';
        return 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400';
    };

    const getEngagementColor = (rate) => {
        if (rate >= 60) return 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400';
        if (rate >= 40) return 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400';
        if (rate >= 20) return 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400';
        return 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400';
    };

    const formatDuration = (seconds) => {
        if (!seconds || seconds < 60) return `${Math.round(seconds || 0)}s`;
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    };

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-sky-100 dark:bg-sky-500/20 rounded-xl flex items-center justify-center text-sky-500">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Performa Kamera</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Metrik teknis per kamera</p>
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700">
                            <th className="pb-3 pr-4">Kamera</th>
                            <th className="pb-3 pr-4 text-center">Total Sesi</th>
                            <th className="pb-3 pr-4 text-center">Viewer Unik</th>
                            <th className="pb-3 pr-4 text-center">Avg Watch Time</th>
                            <th className="pb-3 pr-4 text-center">Bounce Rate</th>
                            <th className="pb-3 text-center">Engagement</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {data.map((camera, idx) => (
                            <tr key={camera.camera_id || idx} className="text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <td className="py-3 pr-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                        </div>
                                        <span className="font-semibold text-gray-900 dark:text-white truncate max-w-[200px]">
                                            {camera.camera_name}
                                        </span>
                                    </div>
                                </td>
                                <td className="py-3 pr-4 text-center">
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                        {camera.total_sessions}
                                    </span>
                                </td>
                                <td className="py-3 pr-4 text-center">
                                    <span className="text-gray-600 dark:text-gray-400">
                                        {camera.unique_viewers}
                                    </span>
                                </td>
                                <td className="py-3 pr-4 text-center">
                                    <span className="font-mono text-gray-900 dark:text-white">
                                        {formatDuration(camera.avg_watch_time)}
                                    </span>
                                </td>
                                <td className="py-3 pr-4 text-center">
                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${getBounceRateColor(camera.bounce_rate)}`}>
                                        {camera.bounce_rate}%
                                    </span>
                                </td>
                                <td className="py-3 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${getEngagementColor(camera.engagement_rate)}`}>
                                            {camera.engagement_rate}%
                                        </span>
                                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                            ({camera.engaged_sessions}/{camera.total_sessions})
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Legend */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500"></div>
                        <span>Bounce Rate: Sesi &lt;10 detik</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        <span>Engagement: Sesi ≥60 detik</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Performance Summary Card - untuk overview
 */
export function PerformanceSummary({ data }) {
    if (!data || data.length === 0) return null;

    const avgBounceRate = Math.round(
        data.reduce((sum, cam) => sum + (cam.bounce_rate || 0), 0) / data.length
    );
    const avgEngagement = Math.round(
        data.reduce((sum, cam) => sum + (cam.engagement_rate || 0), 0) / data.length
    );

    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-500/10 dark:to-orange-500/10 rounded-xl p-3 border border-red-100 dark:border-red-500/20">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Avg Bounce Rate</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{avgBounceRate}%</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-500/10 dark:to-green-500/10 rounded-xl p-3 border border-emerald-100 dark:border-emerald-500/20">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Avg Engagement</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{avgEngagement}%</p>
            </div>
        </div>
    );
}
