import { useState, useEffect } from 'react';
import { adminService } from '../services/adminService';
import { Link } from 'react-router-dom';

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadStats();
        const interval = setInterval(loadStats, 10000); // Refresh every 10s
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
                    <div className="absolute inset-0 border-4 border-primary-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <p className="mt-6 text-dark-400 font-bold animate-pulse uppercase tracking-[0.2em] text-[10px]">Initializing System...</p>
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

    const formatWIB = (dateString) => {
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(new Date(dateString));
    };

    // Use real-time CPU load from backend
    const cpuLoad = stats?.system?.cpuLoad ?? 0;

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Top Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></div>
                        <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.3em]">System Overview</span>
                    </div>
                    <h1 className="text-4xl font-black text-white tracking-tighter">Dashboard</h1>
                    <p className="text-dark-400 font-medium mt-1">Monitoring {stats?.summary.totalCameras} cameras across {stats?.summary.totalAreas} areas</p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    <div className="px-5 py-3 bg-dark-900/50 border border-white/5 rounded-2xl flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-[10px] text-dark-500 font-black uppercase tracking-widest">System Uptime</p>
                            <p className="text-sm font-bold text-white">{formatUptime(stats?.system.uptime)}</p>
                        </div>
                        <div className="w-px h-8 bg-white/5"></div>
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest ${stats?.mtxConnected ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${stats?.mtxConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`}></div>
                            MediaMTX: {stats?.mtxConnected ? 'Online' : 'Offline'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Core Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Camera Summary */}
                <div className="group bg-dark-900/40 border border-white/5 p-8 rounded-[2rem] hover:bg-dark-900/60 transition-all duration-500 hover:border-primary-500/20">
                    <div className="flex justify-between items-start mb-6">
                        <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500 group-hover:scale-110 transition-transform duration-500">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-black text-dark-500 uppercase tracking-widest">Cameras</span>
                    </div>
                    <h3 className="text-4xl font-black text-white mb-2">{stats?.summary.totalCameras}</h3>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded-lg">
                            <div className="w-1 h-1 rounded-full bg-green-500"></div>
                            {stats?.summary.activeCameras} Active
                        </span>
                        <span className="text-[10px] font-bold text-dark-500">
                            {stats?.summary.disabledCameras} Off
                        </span>
                    </div>
                </div>

                {/* Viewers Summary */}
                <div className="group bg-dark-900/40 border border-white/5 p-8 rounded-[2rem] hover:bg-dark-900/60 transition-all duration-500 hover:border-accent-500/20">
                    <div className="flex justify-between items-start mb-6">
                        <div className="w-12 h-12 bg-accent-500/10 rounded-2xl flex items-center justify-center text-accent-500 group-hover:scale-110 transition-transform duration-500">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-black text-dark-500 uppercase tracking-widest">Viewers</span>
                    </div>
                    <h3 className="text-4xl font-black text-white mb-2">{stats?.summary.activeViewers}</h3>
                    <p className="text-[10px] font-bold text-dark-500 uppercase tracking-widest">Active Sessions</p>
                </div>

                {/* Memory Usage */}
                <div className="group bg-dark-900/40 border border-white/5 p-8 rounded-[2rem] hover:bg-dark-900/60 transition-all duration-500 hover:border-blue-500/20">
                    <div className="flex justify-between items-start mb-6">
                        <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform duration-500">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-black text-dark-500 uppercase tracking-widest">Memory</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-4">
                        <h3 className="text-4xl font-black text-white">
                            {Math.round(((stats?.system.totalMem - stats?.system.freeMem) / stats?.system.totalMem) * 100)}%
                        </h3>
                        <span className="text-[10px] font-bold text-dark-500 uppercase">Used</span>
                    </div>
                    <div className="space-y-2">
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                                style={{ width: `${((stats?.system.totalMem - stats?.system.freeMem) / stats?.system.totalMem) * 100}%` }}
                            ></div>
                        </div>
                        <p className="text-[10px] font-bold text-dark-500 text-right">
                            {formatBytes(stats?.system.totalMem - stats?.system.freeMem)} / {formatBytes(stats?.system.totalMem)}
                        </p>
                    </div>
                </div>

                {/* CPU Status */}
                <div className="group bg-dark-900/40 border border-white/5 p-8 rounded-[2rem] hover:bg-dark-900/60 transition-all duration-500 hover:border-orange-500/20">
                    <div className="flex justify-between items-start mb-6">
                        <div className="w-12 h-12 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-500 group-hover:scale-110 transition-transform duration-500">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-black text-dark-500 uppercase tracking-widest">Processor</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-4">
                        <h3 className="text-4xl font-black text-white">{cpuLoad}%</h3>
                        <span className="text-[10px] font-bold text-dark-500 uppercase">Load</span>
                    </div>
                    <div className="space-y-2">
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-orange-500 rounded-full transition-all duration-1000"
                                style={{ width: `${cpuLoad}%` }}
                            ></div>
                        </div>
                        <p className="text-[10px] font-bold text-white truncate" title={stats?.system.cpuModel}>
                            {stats?.system.cpuModel || 'Unknown CPU'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Detailed Status Sections */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
                {/* Active Streams Table */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <h2 className="text-2xl font-black text-white tracking-tight">Live Streams</h2>
                        <Link to="/admin/cameras" className="text-[10px] font-black text-primary-500 uppercase tracking-[0.2em] hover:text-primary-400 transition-colors">
                            Manage All →
                        </Link>
                    </div>

                    <div className="bg-dark-900/40 border border-white/5 rounded-[2rem] overflow-hidden backdrop-blur-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-white/5">
                                        <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-dark-500">Camera Feed</th>
                                        <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-dark-500">Status</th>
                                        <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-dark-500 text-center">Viewers</th>
                                        <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-dark-500 text-right">Bandwidth</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {!stats?.mtxConnected ? (
                                        <tr>
                                            <td colSpan="4" className="px-8 py-20 text-center">
                                                <div className="flex flex-col items-center gap-4">
                                                    <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
                                                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                        </svg>
                                                    </div>
                                                    <div>
                                                        <p className="text-white font-bold">Media Server Offline</p>
                                                        <p className="text-xs text-dark-500 mt-1">Unable to fetch real-time stream statistics.</p>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : stats?.streams.length === 0 ? (
                                        <tr>
                                            <td colSpan="4" className="px-8 py-20 text-center text-dark-500 font-medium">
                                                No active camera streams detected
                                            </td>
                                        </tr>
                                    ) : (
                                        stats?.streams.map(stream => (
                                            <tr key={stream.id} className="group hover:bg-white/[0.02] transition-colors">
                                                <td className="px-8 py-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-dark-800 rounded-xl flex items-center justify-center text-dark-400 group-hover:bg-primary-500/10 group-hover:text-primary-500 transition-colors">
                                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                            </svg>
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-white text-sm">{stream.name}</p>
                                                            <p className="text-[10px] text-dark-500 font-black uppercase tracking-widest mt-0.5">ID: {stream.id}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6">
                                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${stream.state === 'ready' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
                                                        }`}>
                                                        {stream.state}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-6 text-center">
                                                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 rounded-lg">
                                                        <div className="w-1 h-1 rounded-full bg-accent-500 animate-pulse"></div>
                                                        <span className="font-mono text-xs font-bold text-white">{stream.viewers}</span>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6 text-right">
                                                    <div className="space-y-1">
                                                        <p className="text-xs font-mono font-bold text-primary-400">↑ {formatBytes(stream.bytesSent)}</p>
                                                        <p className="text-[10px] font-mono text-dark-500">↓ {formatBytes(stream.bytesReceived)}</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Recent Activity Sidebar */}
                <div className="space-y-6">
                    <h2 className="text-2xl font-black text-white tracking-tight px-2">Activity Log</h2>
                    <div className="bg-dark-900/40 border border-white/5 rounded-[2rem] p-8 backdrop-blur-sm">
                        <div className="space-y-8">
                            {stats?.recentLogs.length === 0 ? (
                                <p className="text-center text-dark-500 py-10">No recent activity</p>
                            ) : (
                                stats?.recentLogs.map((log, idx) => (
                                    <div key={log.id} className="relative flex gap-6 group">
                                        {idx !== stats.recentLogs.length - 1 && (
                                            <div className="absolute left-[11px] top-8 bottom-[-32px] w-px bg-white/5"></div>
                                        )}
                                        <div className={`relative z-10 w-[22px] h-[22px] rounded-full mt-1 flex items-center justify-center border-4 border-dark-950 ${log.action.includes('CREATE') ? 'bg-green-500' :
                                            log.action.includes('DELETE') ? 'bg-red-500' : 'bg-primary-500'
                                            }`}></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-white leading-relaxed group-hover:text-primary-400 transition-colors">{log.details}</p>
                                            <div className="flex items-center gap-3 mt-2">
                                                <span className="text-[10px] font-black text-dark-500 uppercase tracking-[0.2em]">{log.username}</span>
                                                <div className="w-1 h-1 rounded-full bg-white/10"></div>
                                                <span className="text-[10px] font-bold text-primary-500/60">
                                                    {log.created_at_wib} WIB
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <button className="w-full mt-10 py-4 bg-white/5 hover:bg-white/10 border border-white/5 text-dark-300 text-[10px] font-black uppercase tracking-[0.3em] rounded-2xl transition-all active:scale-95">
                            View Full Audit
                        </button>
                    </div>

                    {/* Quick System Health */}
                    <div className="bg-gradient-to-br from-primary-500/10 to-accent-500/5 border border-primary-500/10 rounded-[2rem] p-8">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary-500 mb-6">System Integrity</h4>
                        <div className="space-y-5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                                    <span className="text-xs font-bold text-dark-200">Database Engine</span>
                                </div>
                                <span className="text-[10px] font-black text-green-500 uppercase tracking-widest">Optimal</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`w-1.5 h-1.5 rounded-full ${stats?.mtxConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`}></div>
                                    <span className="text-xs font-bold text-dark-200">Media Server</span>
                                </div>
                                <span className={`text-[10px] font-black uppercase tracking-widest ${stats?.mtxConnected ? 'text-green-500' : 'text-red-500'}`}>
                                    {stats?.mtxConnected ? 'Stable' : 'Offline'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                                    <span className="text-xs font-bold text-dark-200">API Gateway</span>
                                </div>
                                <span className="text-[10px] font-black text-green-500 uppercase tracking-widest">Online</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
