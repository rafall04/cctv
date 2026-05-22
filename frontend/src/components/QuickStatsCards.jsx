import { useState, useEffect, useCallback } from 'react';
import { adminService } from '../services/adminService';

/**
 * Quick Stats Cards — date-range viewer analytics (sessions, unique viewers,
 * average duration) with comparison to the previous period.
 *
 * Live-viewer and camera-status tiles were moved into DashboardStatsOverview
 * to remove the duplicate counts that previously cluttered the dashboard.
 */
export function QuickStatsCards({ dateRange = 'today' }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadTodayStats = useCallback(async () => {
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
    }, [dateRange]);

    useEffect(() => {
        setLoading(true);
        loadTodayStats();
        const interval = setInterval(loadTodayStats, 30000);
        return () => clearInterval(interval);
    }, [loadTodayStats]);

    const formatDuration = (seconds) => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m`;
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
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

    const cards = [
        {
            key: 'sessions',
            value: stats.current.totalSessions,
            label: 'Total sesi',
            change: stats.comparison.sessionsChange,
            iconBg: 'bg-sky-100 dark:bg-sky-500/20',
            iconColor: 'text-sky-500',
            icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z',
        },
        {
            key: 'unique',
            value: stats.current.uniqueViewers,
            label: 'Unique viewers',
            change: stats.comparison.viewersChange,
            iconBg: 'bg-blue-100 dark:bg-blue-500/20',
            iconColor: 'text-blue-500',
            icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
        },
        {
            key: 'duration',
            value: formatDuration(stats.current.avgDuration),
            label: 'Rata-rata durasi',
            change: stats.comparison.durationChange,
            iconBg: 'bg-amber-100 dark:bg-amber-500/20',
            iconColor: 'text-amber-500',
            icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
        },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {cards.map((card) => (
                <div
                    key={card.key}
                    className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 hover:shadow-md transition-all"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className={`w-8 h-8 ${card.iconBg} rounded-lg flex items-center justify-center`}>
                            <svg className={`w-4 h-4 ${card.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                            </svg>
                        </div>
                        <TrendBadge value={card.change} />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{card.value}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{card.label}</p>
                </div>
            ))}
        </div>
    );
}
