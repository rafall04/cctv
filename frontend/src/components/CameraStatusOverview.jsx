/**
 * Camera Status Overview Component
 * Lightweight visual breakdown of camera status (online/offline/maintenance)
 * Optimized for all devices
 */
export function CameraStatusOverview({ breakdown, totalCameras }) {
    if (!breakdown || totalCameras === 0) return null;

    const { online = 0, offline = 0, maintenance = 0 } = breakdown;
    
    const onlinePercent = Math.round((online / totalCameras) * 100);
    const offlinePercent = Math.round((offline / totalCameras) * 100);
    const maintenancePercent = Math.round((maintenance / totalCameras) * 100);

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Status Kamera</h3>
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    {totalCameras} Total
                </span>
            </div>

            {/* Status Bars */}
            <div className="space-y-4">
                {/* Online */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Online</span>
                        </div>
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{online}</span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-500"
                            style={{ width: `${onlinePercent}%` }}
                        />
                    </div>
                </div>

                {/* Offline */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500"></span>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Offline</span>
                        </div>
                        <span className="text-sm font-bold text-red-600 dark:text-red-400">{offline}</span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-gradient-to-r from-red-400 to-red-600 rounded-full transition-all duration-500"
                            style={{ width: `${offlinePercent}%` }}
                        />
                    </div>
                </div>

                {/* Maintenance (if any) */}
                {maintenance > 0 && (
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Maintenance</span>
                            </div>
                            <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{maintenance}</span>
                        </div>
                        <div className="h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-amber-400 to-amber-600 rounded-full transition-all duration-500"
                                style={{ width: `${maintenancePercent}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Summary */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Availability</span>
                    <span className={`font-bold ${onlinePercent >= 80 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {onlinePercent}%
                    </span>
                </div>
            </div>
        </div>
    );
}
