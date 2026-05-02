/*
Purpose: Sidebar widgets for top cameras, recent activity, and dashboard health indicators.
Caller: pages/Dashboard.jsx.
Deps: ../../TopCamerasWidget, ../../ui/EmptyState.
MainFuncs: DashboardSidebar.
SideEffects: None.
*/

import { TopCamerasWidget } from '../../TopCamerasWidget';
import { NoActivityEmptyState } from '../../ui/EmptyState';

function ActivityLog({ logs = [] }) {
    return (
        <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Aktivitas Terkini</h2>
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                <div className="space-y-6">
                    {logs.length === 0 ? (
                        <NoActivityEmptyState />
                    ) : (
                        logs.map((log, idx) => (
                            <div key={log.id} className="relative flex gap-4">
                                {idx !== logs.length - 1 && (
                                    <div className="absolute left-[9px] top-6 bottom-[-24px] w-px bg-gray-200 dark:bg-gray-700"></div>
                                )}
                                <div className={`relative z-10 w-[18px] h-[18px] rounded-full mt-0.5 border-4 border-white dark:border-gray-800 ${
                                    log.action.includes('CREATE') ? 'bg-emerald-500' :
                                        log.action.includes('DELETE') ? 'bg-red-500' : 'bg-primary'
                                }`}></div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">{log.details}</p>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{log.username}</span>
                                        <span className="text-xs text-gray-400 dark:text-gray-500">&bull;</span>
                                        <span className="text-xs text-primary font-medium break-words">{log.created_at_wib}</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function SystemHealth({ mtxConnected }) {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 shadow-sm">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                System Health
            </h4>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span className="text-sm text-gray-700 dark:text-gray-300">Database</span>
                    </div>
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10 px-2 py-0.5 rounded-lg">Optimal</span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${mtxConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                        <span className="text-sm text-gray-700 dark:text-gray-300">Media Server</span>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${mtxConnected ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10' : 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/10'}`}>
                        {mtxConnected ? 'Stable' : 'Offline'}
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span className="text-sm text-gray-700 dark:text-gray-300">API Gateway</span>
                    </div>
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10 px-2 py-0.5 rounded-lg">Online</span>
                </div>
            </div>
        </div>
    );
}

export function DashboardSidebar({ topCameras = [], recentLogs = [], mtxConnected }) {
    return (
        <div className="space-y-6">
            <TopCamerasWidget cameras={topCameras} />
            <ActivityLog logs={recentLogs} />
            <SystemHealth mtxConnected={mtxConnected} />
        </div>
    );
}
