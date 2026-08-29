// Purpose: Prune operational tables that accumulate rows with nothing to ever remove them.
// Caller: server.js startup scheduler (daily, alongside the security-log cleanup).
// Deps: database/connectionPool, config.
// MainFuncs: pruneOperationalTables, startOperationalRetention, stopOperationalRetention.
// SideEffects: DELETEs rows older than the configured window; logs one summary line per run.
//
// WHAT IS AND IS NOT PRUNED
// -------------------------
// `security_logs`, `login_attempts` and `playback_token_audit_logs` already have
// owners that prune them. These two did not:
//
//   audit_logs    AUDIT_LOG_RETENTION_DAYS (default 90). Now settable from the admin panel
//                 (Keamanan tab) via securitySettingsService — DB over env over default — so an
//                 operator can change the window without SSH-ing in to edit .env.
//   restart_logs  Recorder restart diagnostics (default 30). Production writes ~140/day
//                 (261 process_crashed + 88 stream_frozen in 2.5 days). Same panel, same
//                 precedence (RESTART_LOG_RETENTION_DAYS remains the env fallback).
//
// `telegram_archive_uploads` is deliberately NOT pruned, and must not be added here.
// It looks like a log — it grows by ~4,800 rows/day and is named like an upload
// journal — but it is the INDEX INTO THE TELEGRAM ARCHIVE: archivedSegmentSourceService
// resolves playback of footage that has already been deleted from local disk through
// its `file_id`. Local retention is 4 hours; Telegram is the only copy of anything
// older. On production all 11,946 rows are status='ok' with a non-null file_id, so
// there is not even a failed-upload subset to collect. Deleting a row here does not
// reclaim garbage, it destroys the only pointer to a recording. Its growth is handled
// with an index (idx_tg_archive_camera_recorded), not with a DELETE.

import { execute } from '../database/connectionPool.js';
import { getSecuritySettings } from './securitySettingsService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDays(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Tables are described rather than hard-coded into one query so the retention
 * window per table stays visible and independently tunable.
 */
function getRetentionTargets() {
    // Read fresh each pass (settings are cached ~30s) so a change in the panel takes effect on the
    // next daily prune without a restart. parseDays keeps the >0 floor even if a value slips through.
    const s = getSecuritySettings();
    return [
        {
            table: 'audit_logs',
            column: 'created_at',
            days: parseDays(s.auditLogRetentionDays, 90),
        },
        {
            table: 'restart_logs',
            column: 'created_at',
            days: parseDays(s.restartLogRetentionDays, 30),
        },
    ];
}

function cutoffFor(days) {
    // These columns are written by SQLite's CURRENT_TIMESTAMP / local SQL datetimes,
    // i.e. 'YYYY-MM-DD HH:MM:SS'. Comparing against the same shape keeps the string
    // comparison meaningful; an ISO string with a 'T' would sort wrong against them.
    return new Date(Date.now() - days * DAY_MS)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
}

/**
 * Delete rows past their retention window. Never throws: a missing table on an
 * older database, or a locked write, must not take down the scheduler.
 * @returns {{ table: string, deleted: number }[]}
 */
export function pruneOperationalTables() {
    const results = [];

    for (const target of getRetentionTargets()) {
        try {
            const result = execute(
                `DELETE FROM ${target.table} WHERE ${target.column} < ?`,
                [cutoffFor(target.days)]
            );
            results.push({ table: target.table, deleted: result?.changes || 0 });
        } catch (error) {
            // An older DB may not have the table yet; that is not an incident.
            console.log(`[Retention] Skipped ${target.table}: ${error.message}`);
        }
    }

    // One line per run, and only when something happened — a retention pass that
    // deletes nothing is the normal case and does not need to be narrated.
    const pruned = results.filter((r) => r.deleted > 0);
    if (pruned.length > 0) {
        console.log(`[Retention] Pruned ${pruned.map((r) => `${r.deleted} ${r.table}`).join(', ')}`);
    }

    return results;
}

let retentionIntervalId = null;

export function startOperationalRetention() {
    pruneOperationalTables();
    retentionIntervalId = setInterval(pruneOperationalTables, DAY_MS);
    retentionIntervalId.unref?.();
    return retentionIntervalId;
}

export function stopOperationalRetention() {
    if (retentionIntervalId) {
        clearInterval(retentionIntervalId);
        retentionIntervalId = null;
    }
}

export default { pruneOperationalTables, startOperationalRetention, stopOperationalRetention };
