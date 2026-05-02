/*
Purpose: Summary stat cards and attention notices for the admin dashboard.
Caller: pages/Dashboard.jsx.
Deps: None.
MainFuncs: DashboardSummaryCards, DashboardAttentionItems.
SideEffects: Opens viewer modal through parent callback.
*/

export function DashboardAttentionItems({ items }) {
    if (items.length === 0) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {items.map((item) => (
                <div key={item.title} className={`rounded-2xl border px-4 py-3 ${item.tone}`}>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs opacity-90">{item.description}</p>
                </div>
            ))}
        </div>
    );
}

export function DashboardSummaryCards({ stats, cpuLoad, memUsed, memPercent, formatBytes, onOpenViewer }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg hover:border-primary/30 transition-all group">
                <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/30 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cameras</span>
                </div>
                <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{stats?.summary.totalCameras}</h3>
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        {stats?.cameraStatusBreakdown?.online || 0} Online
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{stats?.cameraStatusBreakdown?.offline || 0} Offline</span>
                </div>
            </div>

            <div
                className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg hover:border-purple-500/30 transition-all group cursor-pointer"
                onClick={() => onOpenViewer({
                    title: 'Semua Viewer Aktif',
                    sessions: stats?.allSessions || [],
                })}
            >
                <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-purple-500/30 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Viewers</span>
                </div>
                <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{stats?.summary.activeViewers}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Klik untuk lihat detail</p>
            </div>

            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg hover:border-primary/30 transition-all group">
                <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-primary-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/30 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Memory</span>
                </div>
                <div className="flex items-baseline gap-2 mb-3">
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{memPercent}%</h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Used</span>
                </div>
                <div className="w-full h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-400 to-primary-600 rounded-full transition-all" style={{ width: `${memPercent}%` }}></div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{formatBytes(memUsed)} / {formatBytes(stats?.system.totalMem)}</p>
            </div>

            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg hover:border-amber-500/30 transition-all group">
                <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-amber-500/30 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">CPU</span>
                </div>
                <div className="flex items-baseline gap-2 mb-3">
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{cpuLoad}%</h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Load</span>
                </div>
                <div className="w-full h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all" style={{ width: `${cpuLoad}%` }}></div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate" title={stats?.system.cpuModel}>{stats?.system.cpuModel || 'Unknown'}</p>
            </div>
        </div>
    );
}
