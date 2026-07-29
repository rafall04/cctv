// Purpose: Persist recovery diagnostics for recording files that are pending, retryable, or unrecoverable.
// Caller: recordingSegmentFinalizer, recordingService scanner, recording assurance service.
// Deps: database connectionPool.
// MainFuncs: upsertDiagnostic, clearDiagnostic, listActiveByCamera, summarizeActive.
// SideEffects: Reads and writes recording_recovery_diagnostics rows.

import { existsSync } from 'fs';
import { execute, query, queryOne, transaction } from '../database/connectionPool.js';

class RecordingRecoveryDiagnosticsRepository {
    upsertDiagnostic({
        cameraId,
        filename,
        filePath,
        state,
        reason,
        fileSize = 0,
        detectedAt = new Date().toISOString(),
        lastSeenAt = detectedAt,
        active = 1,
    }) {
        return execute(
            `INSERT INTO recording_recovery_diagnostics
            (camera_id, filename, file_path, state, reason, file_size, detected_at, last_seen_at, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(camera_id, filename, active) DO UPDATE SET
                file_path = excluded.file_path,
                state = excluded.state,
                reason = excluded.reason,
                file_size = excluded.file_size,
                last_seen_at = excluded.last_seen_at,
                updated_at = CURRENT_TIMESTAMP`,
            [cameraId, filename, filePath, state, reason, fileSize, detectedAt, lastSeenAt, active]
        );
    }

    clearDiagnostic({ cameraId, filename }) {
        /*
         * Same UNIQUE(camera_id, filename, active) collision the prune had to solve — but on the
         * SUCCESS path, where it does more damage. A file that failed, was resolved, then failed
         * again holds BOTH an active row and a resolved twin; flipping the active one to 0 raised
         * `UNIQUE constraint failed` right after the segment had already been written by
         * upsertSegment. The finalizer's catch then reported success:false for a segment that
         * actually finalized, skipped the source .partial unlink so the file lingered forever, and
         * the runner re-queued work that was already done.
         *
         * Unlike the prune (where the file is gone, so the older twin suffices), here the ACTIVE
         * row is the interesting one — it carries the latest reason and attempt_count. So drop the
         * stale twin and resolve the current row, atomically.
         */
        const run = transaction(() => {
            execute(
                'DELETE FROM recording_recovery_diagnostics WHERE camera_id = ? AND filename = ? AND active = 0',
                [cameraId, filename]
            );
            return execute(
                `UPDATE recording_recovery_diagnostics
                 SET active = 0, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE camera_id = ? AND filename = ? AND active = 1`,
                [cameraId, filename]
            );
        });
        return run();
    }

    getActiveDiagnostic({ cameraId, filename }) {
        return queryOne(
            `SELECT *
            FROM recording_recovery_diagnostics
            WHERE camera_id = ? AND filename = ? AND active = 1`,
            [cameraId, filename]
        );
    }

    listActiveByCamera(cameraId, limit = 100) {
        return query(
            `SELECT *
            FROM recording_recovery_diagnostics
            WHERE camera_id = ? AND active = 1
            ORDER BY last_seen_at DESC
            LIMIT ?`,
            [cameraId, limit]
        );
    }

    summarizeActive() {
        const rows = query(
            `SELECT state, COUNT(*) as count
            FROM recording_recovery_diagnostics
            WHERE active = 1
            GROUP BY state`,
            []
        );

        return rows.reduce((summary, row) => {
            summary[row.state] = row.count;
            return summary;
        }, {});
    }

    getActiveHealthSummary() {
        return queryOne(
            `SELECT
                MIN(last_seen_at) as oldest_active_seen_at,
                MAX(attempt_count) as max_attempt_count,
                COUNT(*) as active_total
            FROM recording_recovery_diagnostics
            WHERE active = 1`,
            []
        ) || {
            oldest_active_seen_at: null,
            max_attempt_count: 0,
            active_total: 0,
        };
    }

    incrementAttempt({
        cameraId,
        filename,
        filePath,
        reason,
        attemptedAt = new Date().toISOString(),
    }) {
        // Atomic: UPSERT then SELECT inside one transaction so the returned
        // attempt_count reflects this insertion even under concurrent recovery.
        const run = transaction(() => {
            execute(
                `INSERT INTO recording_recovery_diagnostics
                (camera_id, filename, file_path, state, reason, detected_at, last_seen_at, active, attempt_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
                ON CONFLICT(camera_id, filename, active) DO UPDATE SET
                    file_path = excluded.file_path,
                    state = excluded.state,
                    reason = excluded.reason,
                    last_seen_at = excluded.last_seen_at,
                    attempt_count = attempt_count + 1,
                    updated_at = CURRENT_TIMESTAMP`,
                [cameraId, filename, filePath, 'retryable_failed', reason, attemptedAt, attemptedAt]
            );

            return queryOne(
                `SELECT
                    camera_id,
                    filename,
                    file_path,
                    state,
                    reason,
                    detected_at,
                    last_seen_at,
                    updated_at,
                    attempt_count,
                    terminal_state,
                    quarantined_path
                FROM recording_recovery_diagnostics
                WHERE camera_id = ? AND filename = ? AND active = 1`,
                [cameraId, filename]
            );
        });

        return run();
    }

    /**
     * Resolve (active=0) any active diagnostic whose underlying file is gone.
     *
     * A diagnostic row only matters while its file still exists on disk. Once
     * the segment retention/cleanup has deleted the .partial (and there is no
     * quarantined copy), the row is just noise — but nothing else ever clears
     * a terminal/unrecoverable row, so the dashboard kept counting long-dead
     * files forever (e.g. "17 unrecoverable" stuck for days after the files
     * were purged). This prunes exactly those orphaned rows. Rows whose file
     * (or quarantined copy) still exists are left untouched.
     *
     * @param {object} opts
     * @param {(path: string) => boolean} [opts.fileExists] existence checker (injectable for tests)
     * @returns {number} how many rows were resolved
     */
    pruneAbsentActiveDiagnostics({ fileExists = existsSync } = {}) {
        const rows = query(
            `SELECT id, file_path, quarantined_path
             FROM recording_recovery_diagnostics
             WHERE active = 1`,
            []
        );

        const absentIds = [];
        for (const row of rows) {
            const filePresent = Boolean(row.file_path) && fileExists(row.file_path);
            const quarantinePresent = Boolean(row.quarantined_path) && fileExists(row.quarantined_path);
            if (!filePresent && !quarantinePresent) {
                absentIds.push(row.id);
            }
        }

        if (absentIds.length === 0) {
            return 0;
        }

        /*
         * The table is UNIQUE on (camera_id, filename, active). A file can therefore hold BOTH an
         * active row and an already-resolved row for the same name — which happens routinely when
         * a segment is retried. Flipping the active one to 0 then collides with its resolved twin,
         * and because every UPDATE ran inside ONE transaction, that single collision rolled the
         * whole batch back. The prune then failed identically on every cycle forever: observed in
         * production as 873 orphan rows still active while the log repeated
         * "Error pruning recovery diagnostics: UNIQUE constraint failed".
         *
         * The file is gone either way, so a duplicate active row carries no information its
         * resolved twin does not already hold — delete it instead of resolving it. Rows with no
         * twin still resolve normally.
         */
        const run = transaction((ids) => {
            let cleared = 0;
            for (const id of ids) {
                const hasResolvedTwin = queryOne(
                    `SELECT 1 AS present
                     FROM recording_recovery_diagnostics AS orphan
                     WHERE orphan.id = ?
                       AND EXISTS (
                           SELECT 1
                           FROM recording_recovery_diagnostics AS twin
                           WHERE twin.camera_id = orphan.camera_id
                             AND twin.filename = orphan.filename
                             AND twin.active = 0
                             AND twin.id <> orphan.id
                       )`,
                    [id]
                );

                const result = hasResolvedTwin
                    ? execute(
                        'DELETE FROM recording_recovery_diagnostics WHERE id = ? AND active = 1',
                        [id]
                    )
                    : execute(
                        `UPDATE recording_recovery_diagnostics
                         SET active = 0, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ? AND active = 1`,
                        [id]
                    );

                cleared += result?.changes || 0;
            }
            return cleared;
        });

        return run(absentIds);
    }

    markTerminal({
        cameraId,
        filename,
        reason,
        terminalState = 'unrecoverable',
        quarantinedPath = null,
    }) {
        return execute(
            `UPDATE recording_recovery_diagnostics
            SET
                state = ?,
                reason = ?,
                terminal_state = ?,
                quarantined_path = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE camera_id = ? AND filename = ? AND active = 1`,
            [terminalState, reason, terminalState, quarantinedPath, cameraId, filename]
        );
    }
}

export default new RecordingRecoveryDiagnosticsRepository();
