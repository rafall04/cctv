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
// A single camera restarting this many times in 24h is stuck in a loop, not recovering
// (production: camera 37 restarted every 45-75s, ~1000/day). Well above any healthy camera.
const RESTART_STORM_PER_CAMERA_THRESHOLD = 24;
// Fleet-wide failed restarts in 24h that signal systemic trouble even when spread thin.
const RESTART_STORM_TOTAL_FAILED_THRESHOLD = 100;
// A live, recording-enabled camera that has produced NO segment for this long has a broken
// pipeline (a healthy recorder writes a segment every ~10 min). This is the class of silent
// failure that was invisible: 17 prod cameras had enable_recording=1 and zero segments while
// the dashboard stayed green.
const RECORDING_STALE_SEGMENT_WINDOW_MS = 60 * 60 * 1000;

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
        // Count ACTUAL recorder processes from recording_process_state (what the worker publishes),
        // NOT the cameras.recording_status column. That column is written optimistically on start and
        // only reset on a clean stop or a handled crash, so it over-reports: production showed 32
        // 'recording' there versus 22 real ffmpeg. recording_process_state is kept honest by the
        // worker, which deletes a row the instant a recorder is no longer active.
        const rows = queryFn(
            `SELECT status, COUNT(*) AS count
             FROM recording_process_state
             GROUP BY status`,
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

    function buildRestartSection(nowMs) {
        // restart_time is stored as an ISO string (toISOString). Compare against an ISO cutoff
        // computed here, not SQLite's datetime('now',...) which renders 'YYYY-MM-DD HH:MM:SS' with
        // no 'T'/'Z' — a lexicographic mismatch that stretched the 24h window toward 48h.
        const cutoffIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
        const last24h = queryFn(
            `SELECT success, COUNT(*) AS count
             FROM restart_logs
             WHERE restart_time >= ?
             GROUP BY success`,
            [cutoffIso]
        ) || [];
        const succeeded = last24h.find((r) => r.success === 1)?.count || 0;
        const failed = last24h.find((r) => r.success === 0)?.count || 0;

        // A single dominating camera is the signature of a restart loop, and it hides inside a
        // fleet-wide total. Surfacing it is what lets deriveStatus flag cam37-style loops.
        const topRows = queryFn(
            `SELECT camera_id, COUNT(*) AS count
             FROM restart_logs
             WHERE restart_time >= ?
             GROUP BY camera_id
             ORDER BY count DESC
             LIMIT 1`,
            [cutoffIso]
        ) || [];
        const topCamera24h = topRows[0] || null;

        const recent = queryFn(
            `SELECT camera_id, reason, restart_time, recovery_time, success
             FROM restart_logs
             ORDER BY restart_time DESC
             LIMIT 10`,
            []
        ) || [];

        return {
            last24h: { total: succeeded + failed, succeeded, failed },
            topCamera24h,
            recent,
        };
    }

    /**
     * Cameras that are supposed to be recording (enabled + enable_recording), are LIVE (is_online=1),
     * have been started long enough ago to have produced a segment, yet have none in the window.
     * That is a recording-pipeline failure for a camera whose source works — precisely the silent
     * failure the dashboard used to miss. Cameras with is_online=0 are excluded on purpose: those are
     * upstream outages, not a pipeline fault, and they show up through the restart signal instead.
     */
    function buildRecordingIntegritySection(nowMs) {
        const cutoffIso = new Date(nowMs - RECORDING_STALE_SEGMENT_WINDOW_MS).toISOString();
        const expectedRow = queryOneFn(
            `SELECT COUNT(*) AS count FROM cameras
             WHERE enabled = 1 AND enable_recording = 1`,
            []
        ) || { count: 0 };
        const staleRow = queryOneFn(
            `SELECT COUNT(*) AS count FROM cameras c
             WHERE c.enabled = 1 AND c.enable_recording = 1 AND c.is_online = 1
               AND c.last_recording_start IS NOT NULL AND c.last_recording_start <= ?
               AND NOT EXISTS (
                   SELECT 1 FROM recording_segments s
                   WHERE s.camera_id = c.id AND s.start_time >= ?
               )`,
            [cutoffIso, cutoffIso]
        ) || { count: 0 };
        return {
            expectedRecording: expectedRow.count || 0,
            liveButNoRecentSegments: staleRow.count || 0,
            windowMinutes: Math.round(RECORDING_STALE_SEGMENT_WINDOW_MS / 60000),
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
    function deriveStatus({ schedulerSection, recoverySection, restartsSection, integritySection }) {
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

        // Restart storm: a single looping camera, or a high fleet-wide failure count. Previously the
        // derivation ignored restarts entirely, so 1,889 restarts/24h (1,094 failed) with cam37
        // restarting every 45-75s left the badge green and the Telegram alert silent.
        const failed24h = restartsSection?.last24h?.failed || 0;
        const topCamera = restartsSection?.topCamera24h || null;
        if (topCamera && topCamera.count >= RESTART_STORM_PER_CAMERA_THRESHOLD) {
            if (level === 'ok') level = 'warning';
            reasons.push(`camera ${topCamera.camera_id} restarted ${topCamera.count}× in 24h (stuck in a restart loop)`);
        } else if (failed24h >= RESTART_STORM_TOTAL_FAILED_THRESHOLD) {
            if (level === 'ok') level = 'warning';
            reasons.push(`${failed24h} failed recorder restarts in 24h`);
        }

        // Live cameras enabled for recording but producing nothing — the silent-failure class that
        // was completely invisible before (17 such cameras on production under a green badge).
        const liveButSilent = integritySection?.liveButNoRecentSegments || 0;
        if (liveButSilent > 0) {
            if (level === 'ok') level = 'warning';
            reasons.push(`${liveButSilent} live camera(s) enabled for recording but producing no segments (last ${integritySection.windowMinutes}m)`);
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
        const restarts = safeSection('restarts', () => buildRestartSection(nowMs), {
            last24h: { total: 0, succeeded: 0, failed: 0 },
            topCamera24h: null,
            recent: [],
        });
        const integrity = safeSection('integrity', () => buildRecordingIntegritySection(nowMs), {
            expectedRecording: 0,
            liveButNoRecentSegments: 0,
            windowMinutes: Math.round(RECORDING_STALE_SEGMENT_WINDOW_MS / 60000),
        });
        const storage = safeSection('storage', buildStorageSection, {
            totalSegments: 0,
            totalSizeBytes: 0,
            totalSizeGB: 0,
        });

        const status = deriveStatus({
            schedulerSection,
            recoverySection,
            restartsSection: restarts,
            integritySection: integrity,
        });

        return {
            generatedAt: new Date(nowMs).toISOString(),
            status,
            scheduler: schedulerSection,
            recovery: recoverySection,
            recordingProcesses,
            restarts,
            integrity,
            storage,
        };
    }

    return { getSnapshot };
}

export default createRecordingHealthDashboardService();
