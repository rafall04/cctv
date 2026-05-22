/*
Purpose: Admin Security Activity page — read-only viewer for the security audit log.
Caller: App.jsx protected /admin/security route (admin-only).
Deps: adminService.getSecurityLogs / getSecurityStats, TimezoneContext, NotificationContext.
MainFuncs: SecurityActivity.
SideEffects: Fetches paginated security logs and 7-day stats.
*/

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminService } from '../../services/adminService';
import { useNotification } from '../../contexts/NotificationContext';
import { useTimezone } from '../../contexts/TimezoneContext';

// Event types grouped by severity — drives the dropdown and the row tone.
const THREAT_EVENTS = [
    'AUTH_FAILURE', 'ACCOUNT_LOCKOUT', 'RATE_LIMIT_EXCEEDED', 'API_KEY_INVALID',
    'CSRF_INVALID', 'ORIGIN_VALIDATION_FAILURE', 'FINGERPRINT_MISMATCH',
    'AUTHZ_FAILURE', 'VALIDATION_FAILURE', 'PASSWORD_VALIDATION_FAILED',
];
const ADMIN_EVENTS = [
    'ADMIN_ACTION', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED',
    'CAMERA_CREATED', 'CAMERA_UPDATED', 'CAMERA_DELETED',
    'API_KEY_CREATED', 'API_KEY_REVOKED',
];
const AUTH_EVENTS = [
    'AUTH_SUCCESS', 'SESSION_CREATED', 'SESSION_REFRESHED', 'SESSION_INVALIDATED',
    'TOKEN_BLACKLISTED', 'PASSWORD_CHANGED',
];
const ALL_EVENT_TYPES = [...THREAT_EVENTS, ...ADMIN_EVENTS, ...AUTH_EVENTS];

function eventTone(eventType) {
    if (THREAT_EVENTS.includes(eventType)) {
        return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300';
    }
    if (ADMIN_EVENTS.includes(eventType)) {
        return 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300';
    }
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700/70 dark:text-gray-300';
}

/** Pick the most operator-meaningful field out of the JSON details blob. */
function summarizeDetails(rawDetails) {
    if (!rawDetails) return '';
    let parsed;
    try {
        parsed = typeof rawDetails === 'string' ? JSON.parse(rawDetails) : rawDetails;
    } catch {
        return String(rawDetails).slice(0, 120);
    }
    if (!parsed || typeof parsed !== 'object') return String(rawDetails).slice(0, 120);

    const parts = [];
    if (parsed.reason) parts.push(String(parsed.reason));
    if (parsed.action) parts.push(String(parsed.action));
    if (parsed.required_role && parsed.actual_role) {
        parts.push(`role ${parsed.actual_role} → butuh ${parsed.required_role}`);
    }
    if (parsed.lock_type) parts.push(`lock: ${parsed.lock_type}`);
    if (parsed.endpoint_type) parts.push(`tipe: ${parsed.endpoint_type}`);
    if (parsed.target_type) parts.push(`target: ${parsed.target_type}${parsed.target_id ? ` #${parsed.target_id}` : ''}`);
    if (Array.isArray(parsed.validation_errors) && parsed.validation_errors.length) {
        parts.push(parsed.validation_errors.join('; '));
    }
    return parts.join(' · ') || '—';
}

function StatTile({ label, value, tone }) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
            <div className={`mt-1 text-2xl font-bold ${tone || 'text-gray-900 dark:text-white'}`}>{value}</div>
        </div>
    );
}

export default function SecurityActivity() {
    const { error: notifyError } = useNotification();
    const { timezone } = useTimezone();
    const [logs, setLogs] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
    const [stats, setStats] = useState(null);
    const [eventType, setEventType] = useState('');
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);

    const formatTimestamp = useCallback((value) => {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('id-ID', {
            timeZone: timezone || 'Asia/Jakarta',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }, [timezone]);

    const loadLogs = useCallback(async () => {
        setLoading(true);
        const response = await adminService.getSecurityLogs({
            eventType,
            search: appliedSearch,
            page,
            limit: 50,
        });
        if (response.success) {
            setLogs(response.data || []);
            if (response.pagination) {
                setPagination(response.pagination);
            }
        } else {
            notifyError('Gagal Memuat Log', response.message || 'Tidak bisa memuat log keamanan.');
        }
        setLoading(false);
    }, [eventType, appliedSearch, page, notifyError]);

    const loadStats = useCallback(async () => {
        const response = await adminService.getSecurityStats(7);
        if (response.success) {
            setStats(response.data);
        }
    }, []);

    useEffect(() => {
        loadLogs();
    }, [loadLogs]);

    useEffect(() => {
        loadStats();
    }, [loadStats]);

    const summary = useMemo(() => {
        const byType = stats?.events_by_type || {};
        const sumOf = (types) => types.reduce((total, type) => total + (byType[type] || 0), 0);
        return {
            total: stats?.total_events || 0,
            threats: sumOf(THREAT_EVENTS),
            authFailures: byType.AUTH_FAILURE || 0,
            authzFailures: byType.AUTHZ_FAILURE || 0,
        };
    }, [stats]);

    const refresh = () => {
        loadStats();
        loadLogs();
    };

    const applySearch = (event) => {
        event.preventDefault();
        setPage(1);
        setAppliedSearch(search.trim());
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-sm font-semibold text-primary">Keamanan</p>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Aktivitas Keamanan</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Login gagal, lockout, rate-limit, CSRF, penolakan akses, dan aksi admin.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={refresh}
                    className="inline-flex items-center gap-2 self-start rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                </button>
            </div>

            {/* Stats — last 7 days */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Total Event (7 hari)" value={summary.total} />
                <StatTile
                    label="Ancaman / Gagal (7 hari)"
                    value={summary.threats}
                    tone={summary.threats > 0 ? 'text-red-600 dark:text-red-300' : undefined}
                />
                <StatTile
                    label="Login Gagal (7 hari)"
                    value={summary.authFailures}
                    tone={summary.authFailures > 0 ? 'text-amber-600 dark:text-amber-300' : undefined}
                />
                <StatTile
                    label="Akses Ditolak (7 hari)"
                    value={summary.authzFailures}
                    tone={summary.authzFailures > 0 ? 'text-amber-600 dark:text-amber-300' : undefined}
                />
            </div>

            {/* Filters */}
            <form
                onSubmit={applySearch}
                className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70 sm:flex-row sm:items-center"
            >
                <select
                    aria-label="Filter tipe event"
                    value={eventType}
                    onChange={(event) => { setEventType(event.target.value); setPage(1); }}
                    className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                    <option value="">Semua Event</option>
                    {ALL_EVENT_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                    ))}
                </select>
                <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Cari IP, user, endpoint, detail..."
                    className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                <button
                    type="submit"
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
                >
                    Cari
                </button>
            </form>

            {/* Table */}
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700/60">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                            <tr>
                                <th className="px-4 py-3">Waktu</th>
                                <th className="px-4 py-3">Event</th>
                                <th className="px-4 py-3">User</th>
                                <th className="px-4 py-3">IP</th>
                                <th className="px-4 py-3">Endpoint</th>
                                <th className="px-4 py-3">Detail</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40">
                            {loading ? (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Memuat...</td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Tidak ada event yang cocok.</td></tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log.id} className="align-top">
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{formatTimestamp(log.timestamp)}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${eventTone(log.event_type)}`}>
                                                {log.event_type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-800 dark:text-gray-100">{log.username || '—'}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-gray-300">{log.ip_address || '—'}</td>
                                        <td className="max-w-[16rem] truncate px-4 py-3 text-gray-600 dark:text-gray-300" title={log.endpoint || ''}>{log.endpoint || '—'}</td>
                                        <td className="max-w-[20rem] px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{summarizeDetails(log.details)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-700/60">
                    <span className="text-gray-500 dark:text-gray-400">
                        {pagination.total} event · halaman {pagination.page} dari {Math.max(pagination.totalPages, 1)}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            disabled={loading || pagination.page <= 1}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
                        >
                            Sebelumnya
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage((current) => current + 1)}
                            disabled={loading || pagination.page >= pagination.totalPages}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
                        >
                            Berikutnya
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
