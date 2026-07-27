/*
Purpose: Date-ranged viewer analytics tiles (sessions, unique viewers, average duration) with a
  comparison against the previous period.
Caller: pages/Dashboard.jsx, under the DateRangeSelector.
Deps: adminService.getTodayStats, components/ui StatTile/Skeleton.
MainFuncs: QuickStatsCards.
SideEffects: Polls getTodayStats every 30 s while mounted.

Live-viewer and camera-status tiles were moved into DashboardStatsOverview to remove duplicate
counts. What remained was a second, visually different tile design sitting directly under the
first one on the same page — same job, different chrome. Both now render through the shared
StatTile, so the dashboard reads as one instrument panel instead of two.
*/

import { useState, useEffect, useCallback } from 'react';
import { adminService } from '../services/adminService';
import { StatTile } from './ui/StatTile';

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}j ${mins % 60}m`;
}

/**
 * A decline is `status-warn`, never `status-fault`: the metric needs attention, but nothing is
 * broken — red stays reserved for actual faults. The arrow carries the direction so the meaning
 * does not rest on colour alone.
 */
function TrendBadge({ value, inverse = false }) {
    if (!value) return null;
    const improved = inverse ? value < 0 : value > 0;
    return (
        <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${
                improved ? 'bg-status-live/10 text-status-live' : 'bg-status-warn/10 text-status-warn'
            }`}
        >
            <span aria-hidden="true">{value > 0 ? '↑' : '↓'}</span>
            {Math.abs(value)}%
            <span className="sr-only">{improved ? 'membaik' : 'menurun'} dibanding periode sebelumnya</span>
        </span>
    );
}

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

    if (loading) {
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse rounded-card border border-edge bg-surface p-4">
                        <div className="mb-3 h-3 w-16 rounded bg-surface-sunken" />
                        <div className="mb-2 h-7 w-12 rounded bg-surface-sunken" />
                        <div className="h-3 w-20 rounded bg-surface-sunken" />
                    </div>
                ))}
            </div>
        );
    }

    if (!stats) return null;

    const cards = [
        { key: 'sessions', label: 'Total sesi', value: stats.current.totalSessions, change: stats.comparison.sessionsChange },
        { key: 'unique', label: 'Viewer unik', value: stats.current.uniqueViewers, change: stats.comparison.viewersChange },
        { key: 'duration', label: 'Rata-rata durasi', value: formatDuration(stats.current.avgDuration), change: stats.comparison.durationChange },
    ];

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {cards.map((card) => (
                <StatTile
                    key={card.key}
                    label={card.label}
                    value={card.value}
                    tone="data"
                    meta={<TrendBadge value={card.change} />}
                />
            ))}
        </div>
    );
}
