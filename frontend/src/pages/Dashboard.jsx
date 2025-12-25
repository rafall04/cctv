import { useState, useEffect } from 'react';
import { adminService } from '../services/adminService';
import { Link } from 'react-router-dom';

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadStats();
        const interval = setInterval(loadStats, 10000);
        return () => clearInterval(interval);
    }, []);

    const loadStats = async () => {
        try {
            const response = await adminService.getStats();
            if (response.success) {
                setStats(response.data);
            } else {
                setError(response.message);
            }
        } catch (err) {
            setError('Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    if (loading && !stats) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-4 border-sky-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <p className="mt-6 text-gray-500 dark:text-gray-400 font-medium animate-pulse">Loading dashboard...</p>
            </div>
        );
    }

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatUptime = (seconds) => {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    };

    const cpuLoad = stats?.system?.cpuLoad ?? 0;
    const memUsed = stats?.system?.totalMem - stats?.system?.freeMem;
    const memPercent = Math.round((memUsed / stats?.system?.totalMem) * 100);

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-500 mb-1">System Overview</p>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Monitoring {stats?.summary.totalCameras} cameras across {stats?.summary.totalAreas} areas
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Uptime</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatUptime(stats?.system.uptime)}</p>
                    </div>
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${
                        stats?.mtxConnected 
                            ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20 text-green-600 dark:text-green-400' 
                            : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400'
                    }`}>
                        <div className={`w-2 h-2 rounded-full ${stats?.mtxConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-sm font-medium">MediaMTX: {stats?.mtxConnected ? 'Online' : 'Offline'}</span>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Cameras */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-sky-100 dark:bg-sky-500/10 rounded-xl flex items-center justify-center text-sky-500">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Cameras</span>
                    </div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{stats?.summary.totalCameras}</h3>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-2 py-1 rounded-lg">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                            {stats?.summary.activeCameras} Active
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{stats?.summary.disabledCameras} Off</span>
                    </div>
                </div>

                {/* Viewers */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-500/10 rounded-xl flex items-center justify-center text-purple-500">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        </div>
                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Viewers</span>
                    </div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{stats?.summary.activeViewers}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Active Sessions</p>
                </div>

                {/* Memory */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                            </svg>
                        </div>
                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Memory</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-3">
                        <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{memPercent}%</h3>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Used</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${memPercent}%` }}></div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{formatBytes(memUsed)} / {formatBytes(stats?.system.totalMem)}</p>
                </div>

                {/* CPU */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-orange-100 dark:bg-orange-500/10 rounded-xl flex items-center justify-center text-orange-500">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">CPU</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-3">
                        <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{cpuLoad}%</h3>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Load</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${cpuLoad}%` }}></div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate" title={stats?.system.cpuModel}>{stats?.system.cpuModel || 'Unknown'}</p>
                </div>
            </div>

            {/* Content Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Streams Table */}
                <div className="xl:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Live Streams</h2>
                        <Link to="/admin/cameras" className="text-sm font-medium text-sky-500 hover:text-sky-600 transition-colors">
                            Manage All →
                        </Link>
                    </div>
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-200 dark:border-gray-800">
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Camera</th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                                        <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Viewers</th>
                                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Bandwidth</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                                    {!stats?.mtxConnected ? (
                                        <tr>
                                            <td colSpan="4" className="px-6 py-16 text-center">
                                                <div className="flex flex-col items-center gap-3">
                                                    <div className="w-12 h-12 bg-red-100 dark:bg-red-500/10 rounded-xl flex items-center justify-center text-red-500">
                                                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                        </svg>
                                                    </div>
                                                    <p className="font-semibold text-gray-900 dark:text-white">Media Server Offline</p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">Unable to fetch stream statistics</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : stats?.streams.length === 0 ? (
                                        <tr>
                                            <td colSpan="4" className="px-6 py-16 text-center text-gray-500 dark:text-gray-400">
                                                No active streams detected
                                            </td>
                                        </tr>
                                    ) : (
                                        stats?.streams.map(stream => (
                                            <tr key={stream.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center text-gray-400">
                                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                            </svg>
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-gray-900 dark:text-white">{stream.name}</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">ID: {stream.id}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                                                        stream.state === 'ready' 
                                                            ? 'bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400' 
                                                            : 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                                                    }`}>
                                                        {stream.state}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></div>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-white">{stream.viewers}</span>
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <p className="text-sm font-medium text-sky-500">↑ {formatBytes(stream.bytesSent)}</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">↓ {formatBytes(stream.bytesReceived)}</p>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Activity Log */}
                <div className="space-y-4">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Activity Log</h2>
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
                        <div className="space-y-6">
                            {stats?.recentLogs.length === 0 ? (
                                <p className="text-center text-gray-500 dark:text-gray-400 py-8">No recent activity</p>
                            ) : (
                                stats?.recentLogs.map((log, idx) => (
                                    <div key={log.id} className="relative flex gap-4">
                                        {idx !== stats.recentLogs.length - 1 && (
                                            <div className="absolute left-[9px] top-6 bottom-[-24px] w-px bg-gray-200 dark:bg-gray-800"></div>
                                        )}
                                        <div className={`relative z-10 w-[18px] h-[18px] rounded-full mt-0.5 border-4 border-white dark:border-gray-900 ${
                                            log.action.includes('CREATE') ? 'bg-green-500' :
                                            log.action.includes('DELETE') ? 'bg-red-500' : 'bg-sky-500'
                                        }`}></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white">{log.details}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs text-gray-500 dark:text-gray-400">{log.username}</span>
                                                <span className="text-xs text-gray-400 dark:text-gray-500">•</span>
                                                <span className="text-xs text-sky-500">{log.created_at_wib} WIB</span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* System Health */}
                    <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-500/5 dark:to-blue-500/5 border border-sky-200 dark:border-sky-500/10 rounded-2xl p-6">
                        <h4 className="text-sm font-semibold text-sky-600 dark:text-sky-400 mb-4">System Health</h4>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Database</span>
                                </div>
                                <span className="text-xs font-medium text-green-600 dark:text-green-400">Optimal</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${stats?.mtxConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Media Server</span>
                                </div>
                                <span className={`text-xs font-medium ${stats?.mtxConnected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {stats?.mtxConnected ? 'Stable' : 'Offline'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300">API Gateway</span>
                                </div>
                                <span className="text-xs font-medium text-green-600 dark:text-green-400">Online</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
