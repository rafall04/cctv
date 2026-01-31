import { useState, useEffect } from 'react';
import { adminService } from '../services/adminService';

/**
 * Quick Stats Mini Cards Component
 * Displays key metrics with comparison based on selected date range
 */
export function QuickStatsCards({ dateRange = 'today' }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadTodayStats();
        // Refresh every 30 seconds
        const interval = setInterval(loadTodayStats, 30000);
        return () => clearInterval(interval);
    }, [dateRange]); // Re-fetch when dateRange changes

    const loadTodayStats = async () => {
        try {
            const response = await adminService.getTodayStats(dateRange);
            if (response.success) {
                setStats(response.data);
            }
        } catch (error) {
            console.error('Failed to load today stats:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatDuration = (seconds) => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m`;
    };

    const formatWatchTime = (seconds) => {
        if (!seconds) return '0m';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    };

    const TrendBadge = ({ value, inverse = false }) => {
        if (value === 0) return null;
        const isPositive = inverse ? value < 0 : value > 0;
        const color = isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
        const bgColor = isPositive ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-red-50 dark:bg-red-500/10';
        const icon = isPositive ? '↑' : '↓';
        
        return (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${color} ${bgColor}`}>
                {icon} {Math.abs(value)}%
            </span>
        );
    };

    if (loading) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 animate-pulse">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16 mb-2"></div>
                        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-12 mb-1"></div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
                    </div>
                ))}
            </div>
        );
    }

    if (!stats) return null;

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {/* Active Now */}
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-500/10 dark:to-purple-600/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4 hover:shadow-lg transition-all">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </div>
                    <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Live</span>
                </div>
                <div className="flex items-baseline gap-2">
                    <h3 className="text-3xl font-bold text-purple-900 dark:text-purple-100">{stats.current.activeNow}</h3>
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                    </span>
                </div>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Viewer aktif</p>
            </div>

            {/* Total Sessions */}
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 hover:shadow-lg transition-all">
                <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 bg-sky-100 dark:bg-sky-500/20 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                        </svg>
                    </div>
                    <TrendBadge value={stats.comparison.sessionsChange} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{stats.current.totalSessions}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Total sesi</p>
            </div>

            {/* Unique Viewers */}
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 hover:shadow-lg transition-all">
                <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                    </div>
                    <TrendBadge value={stats.comparison.viewersChange} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{stats.current.uniqueViewers}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Unique viewers</p>
            </div>

            {/* Average Duration */}
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 hover:shadow-lg transition-all">
                <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 bg-amber-100 dark:bg-amber-500/20 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <TrendBadge value={stats.comparison.durationChange} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{formatDuration(stats.current.avgDuration)}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Rata-rata durasi</p>
            </div>

            {/* Camera Status */}
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 hover:shadow-lg transition-all">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                </div>
                <div className="flex items-baseline gap-1.5">
                    <h3 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.cameras.online}</h3>
                    <span className="text-sm text-gray-400 dark:text-gray-500">/ {stats.cameras.total}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Kamera online
                    {stats.cameras.offline > 0 && (
                        <span className="text-red-500 ml-1">• {stats.cameras.offline} offline</span>
                    )}
                </p>
            </div>
        </div>
    );
}
