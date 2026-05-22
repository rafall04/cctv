// Purpose: Aggregate recording-pipeline observability — scheduler telemetry, recovery
//          queue/diagnostics, recording process counts, restart history, storage — into
//          one snapshot for the admin health dashboard.
// Caller: controllers/adminController.js (GET /api/admin/recording-health).
// Deps: recordingScheduler, recordingRecoveryService, recordingRecoveryDiagnosticsRepository,
//        database connectionPool. All injectable for tests.
// MainFuncs: createRecordingHealthDashboardService → getSnapshot.
// SideEffects: Read-only DB queries; no writes.

import { query, queryOne } from '../database/connectionPool.js';
import recordingScheduler from './recordingScheduler.js';
import recordingRecoveryService from './recordingRecoveryService.js';
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';

const RECOVERY_QUEUE_BACKLOG_THRESHOLD = 50;

/**
 * Build the recording-health dashboard service.
 * Every dependency is injectable so the snapshot can be unit-tested without a
 * live scheduler, queue, or database.
 */
export function createRecordingHealthDashboardService({
    scheduler = recordingScheduler,
    recoveryService = recordingRecoveryService,
    diagnosticsRepository = recordingRecoveryDiagnosticsRepository,
    queryFn = query,
    queryOneFn = queryOne,
    logger = console,
} = {}) {
    /**
     * Each section is computed defensively: a failure in one (e.g. a missing
     * table on an un-migrated deploy) degrades that section to a safe default
     * with an `error` field instead of failing the whole endpoint.
     */
    function safeSection(name, compute, fallback) {
        try {
            return compute();
        } catch (error) {
            logger.error?.(`[RecordingHealth] section '${name}' failed:`, error?.message || error);
            return { ...fallback, error: error?.message || String(error) };
        }
    }

    function buildSchedulerSection(nowMs) {
        const allStats = scheduler.getAllStats?.() || [];
        const tasks = allStats.map((stat) => {
            const msSinceLastRun = stat.lastRunAt ? nowMs - stat.lastRunAt : null;
            // A task that completed long ago relative to its interval is either
            // hung mid-run or was never re-armed — both worth surfacing.
            const overdue = Number.isFinite(msSinceLastRun)
                && Number.isFinite(stat.intervalMs)
                && msSinceLastRun > stat.intervalMs * 2;
            return {
                name: stat.name,
                intervalMs: stat.intervalMs,
                runCount: stat.runCount,
                lastRunAt: stat.lastRunAt,
                lastDurationMs: stat.lastDurationMs,
                lastError: stat.lastError,
                msSinceLastRun,
                healthy: !stat.lastError && !overdue,
                overdue,
            };
        });
        return {
            running: scheduler.isRunning?.() ?? false,
            taskCount: tasks.length,
            tasks,
        };
    }

    function buildRecoverySection() {
        const queueStats = recoveryService.getStats?.() || {
            queueLength: 0,
            inFlightCount: 0,
            activeCount: 0,
            maxConcurrent: 0,
        };

        const byState = diagnosticsRepository.summarizeActive?.() || {};
        const healthSummary = diagnosticsRepository.getActiveHealthSummary?.() || {
            oldest_active_seen_at: null,
            max_attempt_count: 0,
            active_total: 0,
        };

        const terminalRow = queryOneFn(
            `SELECT COUNT(*) AS count
             FROM recording_recovery_diagnostics
             WHERE active = 1 AND terminal_state IS NOT NULL`,
            []
        ) || { count: 0 };

        const recentTerminal = queryFn(
            `SELECT camera_id, filename, reason, terminal_state, quarantined_path, updated_at
             FROM recording_recovery_diagnostics
             WHERE active = 1 AND terminal_state IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 10`,
            []
        ) || [];

        return {
            queue: {
                queueLength: queueStats.queueLength || 0,
                inFlightCount: queueStats.inFlightCount || 0,
                activeCount: queueStats.activeCount || 0,
                maxConcurrent: queueStats.maxConcurrent || 0,
            },
            diagnostics: {
                byState,
                activeTotal: healthSummary.active_total || 0,
                terminalTotal: terminalRow.count || 0,
                maxAttemptCount: healthSummary.max_attempt_count || 0,
                oldestActiveSeenAt: healthSummary.oldest_active_seen_at || null,
                recentTerminal,
            },
        };
    }

    function buildRecordingProcessSection() {
        const rows = queryFn(
            `SELECT COALESCE(recording_status, 'unknown') AS status, COUNT(*) AS count
             FROM cameras
             WHERE enabled = 1
             GROUP BY recording_status`,
            []
        ) || [];
        const byStatus = rows.reduce((acc, row) => {
            acc[row.status] = row.count;
            return acc;
        }, {});
        return {
            byStatus,
            recording: byStatus.recording || 0,
            stopped: byStatus.stopped || 0,
        };
    }

    function buildRestartSection() {
        const last24h = queryFn(
            `SELECT success, COUNT(*) AS count
             FROM restart_logs
             WHERE restart_time >= datetime('now', '-1 day')
             GROUP BY success`,
            []
        ) || [];
        const succeeded = last24h.find((r) => r.success === 1)?.count || 0;
        const failed = last24h.find((r) => r.success === 0)?.count || 0;

        const recent = queryFn(
            `SELECT camera_id, reason, restart_time, recovery_time, success
             FROM restart_logs
             ORDER BY restart_time DESC
             LIMIT 10`,
            []
        ) || [];

        return {
            last24h: { total: succeeded + failed, succeeded, failed },
            recent,
        };
    }

    function buildStorageSection() {
        const row = queryOneFn(
            `SELECT COUNT(*) AS segment_count, COALESCE(SUM(file_size), 0) AS total_size
             FROM recording_segments`,
            []
        ) || { segment_count: 0, total_size: 0 };
        const totalSize = row.total_size || 0;
        return {
            totalSegments: row.segment_count || 0,
            totalSizeBytes: totalSize,
            totalSizeGB: Number((totalSize / 1024 / 1024 / 1024).toFixed(2)),
        };
    }

    /**
     * Derive a single operator-facing health verdict from the sections.
     * - critical: the maintenance pipeline itself is broken (scheduler down or
     *   a task throwing) — recordings will silently stop being cleaned/recovered.
     * - warning: the pipeline runs but has a backlog or unrecoverable files —
     *   needs attention but not an outage.
     */
    function deriveStatus({ schedulerSection, recoverySection }) {
        const reasons = [];
        let level = 'ok';

        if (!schedulerSection.running) {
            level = 'critical';
            reasons.push('scheduler is not running');
        }
        const failingTasks = schedulerSection.tasks.filter((t) => t.lastError);
        if (failingTasks.length > 0) {
            level = 'critical';
            reasons.push(`${failingTasks.length} scheduler task(s) failing: ${failingTasks.map((t) => t.name).join(', ')}`);
        }
        const overdueTasks = schedulerSection.tasks.filter((t) => t.overdue && !t.lastError);
        if (overdueTasks.length > 0 && level !== 'critical') {
            level = 'warning';
        }
        if (overdueTasks.length > 0) {
            reasons.push(`${overdueTasks.length} scheduler task(s) overdue: ${overdueTasks.map((t) => t.name).join(', ')}`);
        }

        const terminalTotal = recoverySection.diagnostics?.terminalTotal || 0;
        if (terminalTotal > 0) {
            if (level === 'ok') level = 'warning';
            reasons.push(`${terminalTotal} unrecoverable recording file(s)`);
        }

        const queueLength = recoverySection.queue?.queueLength || 0;
        if (queueLength > RECOVERY_QUEUE_BACKLOG_THRESHOLD) {
            if (level === 'ok') level = 'warning';
            reasons.push(`recovery queue backlog (${queueLength} pending)`);
        }

        return { level, reasons };
    }

    function getSnapshot(nowMs = Date.now()) {
        const schedulerSection = safeSection('scheduler', () => buildSchedulerSection(nowMs), {
            running: false,
            taskCount: 0,
            tasks: [],
        });
        const recoverySection = safeSection('recovery', buildRecoverySection, {
            queue: { queueLength: 0, inFlightCount: 0, activeCount: 0, maxConcurrent: 0 },
            diagnostics: {
                byState: {},
                activeTotal: 0,
                terminalTotal: 0,
                maxAttemptCount: 0,
                oldestActiveSeenAt: null,
                recentTerminal: [],
            },
        });
        const recordingProcesses = safeSection('recordingProcesses', buildRecordingProcessSection, {
            byStatus: {},
            recording: 0,
            stopped: 0,
        });
        const restarts = safeSection('restarts', buildRestartSection, {
            last24h: { total: 0, succeeded: 0, failed: 0 },
            recent: [],
        });
        const storage = safeSection('storage', buildStorageSection, {
            totalSegments: 0,
            totalSizeBytes: 0,
            totalSizeGB: 0,
        });

        const status = deriveStatus({ schedulerSection, recoverySection });

        return {
            generatedAt: new Date(nowMs).toISOString(),
            status,
            scheduler: schedulerSection,
            recovery: recoverySection,
            recordingProcesses,
            restarts,
            storage,
        };
    }

    return { getSnapshot };
}

export default createRecordingHealthDashboardService();
