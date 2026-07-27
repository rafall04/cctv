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
import { Modal } from '../../ui/Modal';

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
        <Modal
            title={`Detail Tanggal: ${formatDate(date, { year: true })}`}
            description={`${stats.totalSessions} sesi • ${stats.uniqueVisitors} pengunjung unik • ${formatWatchTime(stats.totalWatchTime)} total`}
            size="xl"
            onClose={onClose}
        >
                <div>
                    {filteredSessions.length > 0 ? (
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-xs font-semibold text-content-muted uppercase border-b border-edge">
                                    <th className="pb-3 pr-4">Waktu</th>
                                    <th className="pb-3 pr-4">Kamera</th>
                                    <th className="pb-3 pr-4">IP Address</th>
                                    <th className="pb-3 pr-4">Perangkat</th>
                                    <th className="pb-3 text-right">Durasi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-edge">
                                {filteredSessions.map((session, index) => (
                                    <tr key={session.id || index} className="text-sm">
                                        <td className="py-3 pr-4 text-content-muted">
                                            {formatTime(session.started_at, {
                                                storage: TIMESTAMP_STORAGE.LOCAL_SQL,
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: undefined,
                                            })}
                                        </td>
                                        <td className="py-3 pr-4 font-semibold text-content">{session.camera_name}</td>
                                        <td className="py-3 pr-4 font-mono text-content-muted">{session.ip_address}</td>
                                        <td className="py-3 pr-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
                                                session.device_type === 'mobile' ? 'bg-blue-100 dark:bg-primary/20 text-primary-600 dark:text-blue-400' :
                                                session.device_type === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400' :
                                                'bg-gray-100 dark:bg-gray-700 text-gray-600'
                                            }`}>
                                                <DeviceIcon type={session.device_type} className="w-3 h-3" />
                                                {session.device_type || 'desktop'}
                                            </span>
                                        </td>
                                        <td className="py-3 text-right font-semibold text-content">{formatDuration(session.duration_seconds)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <EmptyState illustration="NoActivity" title="Tidak ada sesi" description="Tidak ada sesi pada tanggal ini" />
                    )}
                </div>
        </Modal>
    );
}
