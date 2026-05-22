/*
Purpose: Operator-facing health panel for the recording maintenance pipeline.
Caller: pages/RecordingDashboard.jsx.
Deps: adminService.getRecordingHealth (GET /api/admin/recording-health).
MainFuncs: RecordingHealthPanel.
SideEffects: Polls the recording-health endpoint every 15s while mounted and visible.
*/

import { useCallback, useEffect, useState } from 'react';
import { adminService } from '../../../services/adminService';

const POLL_INTERVAL_MS = 15000;

const STATUS_STYLES = {
    ok: {
        label: 'Sehat',
        badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
        dot: 'bg-emerald-500',
    },
    warning: {
        label: 'Perlu Perhatian',
        badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
        dot: 'bg-amber-500',
    },
    critical: {
        label: 'Kritis',
        badge: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200',
        dot: 'bg-red-500',
    },
};

function formatRelative(timestamp) {
    if (!timestamp) return 'belum pernah';
    const ms = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    if (!Number.isFinite(ms)) return '—';
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 0) return 'baru saja';
    if (diffSec < 60) return `${diffSec}d lalu`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m lalu`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}j lalu`;
    return `${Math.floor(diffSec / 86400)}h lalu`;
}

function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function MiniStat({ label, value, tone = 'text-gray-900 dark:text-white' }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700/70 dark:bg-gray-900/40">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
            <div className={`mt-0.5 text-lg font-bold ${tone}`}>{value}</div>
        </div>
    );
}

export default function RecordingHealthPanel() {
    const [health, setHealth] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        const response = await adminService.getRecordingHealth();
        if (response.success && response.data) {
            setHealth(response.data);
            setError(null);
        } else {
            setError(response.message || 'Gagal memuat kesehatan recording');
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                load();
            }
        }, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [load]);

    if (loading) {
        return (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70 md:p-6">
                <div className="h-5 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-700/50" />
                    ))}
                </div>
            </div>
        );
    }

    if (error && !health) {
        return (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 md:p-6">
                {error}
            </div>
        );
    }

    if (!health) return null;

    const status = STATUS_STYLES[health.status?.level] || STATUS_STYLES.ok;
    const reasons = health.status?.reasons || [];
    const scheduler = health.scheduler || { running: false, tasks: [] };
    const recovery = health.recovery || {};
    const diagnostics = recovery.diagnostics || {};
    const queue = recovery.queue || {};
    const restarts = health.restarts?.last24h || { total: 0, succeeded: 0, failed: 0 };

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70 md:p-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Kesehatan Pipeline Recording</h2>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        Scheduler, antrian recovery, dan auto-restart · diperbarui {formatRelative(health.generatedAt)}
                    </p>
                </div>
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${status.badge}`}>
                    <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                    {status.label}
                </span>
            </div>

            {/* Reasons (only when not ok) */}
            {reasons.length > 0 && (
                <ul className="mt-3 space-y-1">
                    {reasons.map((reason) => (
                        <li key={reason} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                            <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400 dark:bg-gray-500" />
                            {reason}
                        </li>
                    ))}
                </ul>
            )}

            {/* Mini stats */}
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                <MiniStat
                    label="Scheduler"
                    value={scheduler.running ? 'Jalan' : 'Mati'}
                    tone={scheduler.running ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}
                />
                <MiniStat label="Antrian Recovery" value={queue.queueLength ?? 0} />
                <MiniStat
                    label="Recovery Aktif"
                    value={diagnostics.activeTotal ?? 0}
                    tone={(diagnostics.activeTotal ?? 0) > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-gray-900 dark:text-white'}
                />
                <MiniStat
                    label="Tidak Terselamatkan"
                    value={diagnostics.terminalTotal ?? 0}
                    tone={(diagnostics.terminalTotal ?? 0) > 0 ? 'text-red-600 dark:text-red-300' : 'text-gray-900 dark:text-white'}
                />
                <MiniStat
                    label="Restart Gagal (24j)"
                    value={`${restarts.failed} / ${restarts.total}`}
                    tone={restarts.failed > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-gray-900 dark:text-white'}
                />
            </div>

            {/* Scheduler tasks */}
            {scheduler.tasks?.length > 0 && (
                <div className="mt-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Task Maintenance
                    </h3>
                    <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-700/60">
                        {scheduler.tasks.map((task) => (
                            <div key={task.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`h-2 w-2 rounded-full ${task.healthy ? 'bg-emerald-500' : task.lastError ? 'bg-red-500' : 'bg-amber-500'}`}
                                    />
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{task.name}</span>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                    <span>{task.runCount}× jalan</span>
                                    <span>terakhir {formatRelative(task.lastRunAt)}</span>
                                    <span>{formatDuration(task.lastDurationMs)}</span>
                                </div>
                                {task.lastError && (
                                    <p className="w-full text-xs text-red-600 dark:text-red-300">Error: {task.lastError}</p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
