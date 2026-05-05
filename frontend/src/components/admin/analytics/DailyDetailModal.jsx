/*
 * Purpose: Show per-day live viewer sessions using local-SQL history dates without browser UTC shifts.
 * Caller: ViewerAnalytics daily chart detail modal.
 * Deps: React, TimezoneContext, analytics primitives, EmptyState, viewer analytics adapter.
 * MainFuncs: DailyDetailModal.
 * SideEffects: None; invokes onClose from user interaction.
 */

import { useMemo } from 'react';
import { EmptyState } from '../../ui/EmptyState';
import { DeviceIcon, formatDuration, formatWatchTime } from './AnalyticsPrimitives';
import { formatDate } from '../../../utils/admin/viewerAnalyticsAdapter';
import { TIMESTAMP_STORAGE, useTimezone } from '../../../contexts/TimezoneContext';

function getSessionLocalDate(startedAt) {
    if (typeof startedAt === 'string' && /^\d{4}-\d{2}-\d{2}[ T]/.test(startedAt)) {
        return startedAt.slice(0, 10);
    }

    const parsed = new Date(startedAt);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().split('T')[0];
}

export default function DailyDetailModal({ date, sessions, onClose }) {
    const { formatTime } = useTimezone();

    const filteredSessions = useMemo(() => {
        return sessions.filter((session) => {
            if (!date) return false;
            return getSessionLocalDate(session.started_at) === date;
        });
    }, [date, sessions]);

    const stats = useMemo(() => {
        const uniqueIPs = new Set(filteredSessions.map((session) => session.ip_address));
        const totalDuration = filteredSessions.reduce((sum, session) => sum + (session.duration_seconds || 0), 0);
        return {
            totalSessions: filteredSessions.length,
            uniqueVisitors: uniqueIPs.size,
            totalWatchTime: totalDuration,
        };
    }, [filteredSessions]);

    if (!date) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden" onClick={(event) => event.stopPropagation()}>
                <div className="p-6 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Detail Tanggal: {formatDate(date, { year: true })}</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {stats.totalSessions} sesi • {stats.uniqueVisitors} pengunjung unik • {formatWatchTime(stats.totalWatchTime)} total
                            </p>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {filteredSessions.length > 0 ? (
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700">
                                    <th className="pb-3 pr-4">Waktu</th>
                                    <th className="pb-3 pr-4">Kamera</th>
                                    <th className="pb-3 pr-4">IP Address</th>
                                    <th className="pb-3 pr-4">Perangkat</th>
                                    <th className="pb-3 text-right">Durasi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {filteredSessions.map((session, index) => (
                                    <tr key={session.id || index} className="text-sm">
                                        <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                                            {formatTime(session.started_at, {
                                                storage: TIMESTAMP_STORAGE.LOCAL_SQL,
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: undefined,
                                            })}
                                        </td>
                                        <td className="py-3 pr-4 font-semibold text-gray-900 dark:text-white">{session.camera_name}</td>
                                        <td className="py-3 pr-4 font-mono text-gray-600 dark:text-gray-400">{session.ip_address}</td>
                                        <td className="py-3 pr-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
                                                session.device_type === 'mobile' ? 'bg-blue-100 dark:bg-primary/20 text-primary-600 dark:text-blue-400' :
                                                session.device_type === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400' :
                                                'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                            }`}>
                                                <DeviceIcon type={session.device_type} className="w-3 h-3" />
                                                {session.device_type || 'desktop'}
                                            </span>
                                        </td>
                                        <td className="py-3 text-right font-semibold text-gray-900 dark:text-white">{formatDuration(session.duration_seconds)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <EmptyState illustration="NoActivity" title="Tidak ada sesi" description="Tidak ada sesi pada tanggal ini" />
                    )}
                </div>
            </div>
        </div>
    );
}
