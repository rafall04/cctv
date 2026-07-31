/**
 * Purpose: Expose Telegram-archived segments in the SAME row shape the local recording repository
 *          returns, so the playback list can span both without the caller special-casing either.
 * Caller: recordingPlaybackService.getAccessibleSegments.
 * Deps: connectionPool.
 * MainFuncs: listArchivedSegments.
 * SideEffects: none — read-only.
 *
 * WHY THIS EXISTS
 * Local retention is 4 hours; the archive holds everything since it was switched on. A token sold
 * with 7 days of depth could already STREAM an old segment (publicArchiveAccessService), but the
 * segment LIST still came only from `recording_segments`, so a buyer saw four hours and had no way
 * to discover the rest. Bytes without a listing is not a product.
 *
 * The shape deliberately mirrors recordingSegmentRepository's SELECT — id, camera_id, filename,
 * start_time, end_time, file_size, duration, created_at — because the frontend already renders that
 * shape. The single addition is `source`, which tells the player WHICH endpoint to fetch from:
 * archived segments are no longer on disk, so the local stream route would 404 on them.
 */

import { query } from '../database/connectionPool.js';

class ArchivedSegmentSourceService {
    /**
     * Archived segments for one camera, newest-relevant first is NOT assumed — the caller sorts.
     * `sinceMs` lets the caller skip rows it will discard anyway; the playback window is still
     * applied by the caller so this stays a pure source, not a second policy.
     */
    listArchivedSegments(cameraId, { sinceMs = null, limit = 1000 } = {}) {
        const id = Number.parseInt(cameraId, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return [];
        }

        const params = [id];
        let sinceClause = '';
        if (Number.isFinite(sinceMs)) {
            sinceClause = 'AND u.recorded_at >= ?';
            params.push(new Date(sinceMs).toISOString());
        }
        params.push(Math.max(1, Math.min(Number(limit) || 1000, 5000)));

        try {
            return query(
                `SELECT u.segment_id, u.camera_id, u.filename, u.file_size,
                        u.recorded_at, u.recorded_until, u.duration_seconds, u.uploaded_at
                   FROM telegram_archive_uploads u
                  WHERE u.camera_id = ?
                    AND u.status = 'ok'
                    AND u.file_id IS NOT NULL
                    ${sinceClause}
                  ORDER BY u.recorded_at ASC
                  LIMIT ?`,
                params
            ).map((row) => ({
                id: row.segment_id,
                camera_id: row.camera_id,
                filename: row.filename,
                start_time: row.recorded_at,
                end_time: row.recorded_until,
                file_size: row.file_size,
                duration: row.duration_seconds,
                created_at: row.uploaded_at,
                // The player must fetch these from /api/playback-archive/:id/stream — the local
                // stream route cannot serve them because the file was pruned off disk.
                source: 'archive',
            }));
        } catch (error) {
            /*
             * Degrade to "no archived segments" rather than failing the whole listing. The archive is
             * an ENHANCEMENT to local playback: if its table is missing (a deployment without the
             * sidecar) or unreadable, the visitor should still get the four hours that are on disk.
             */
            console.error('[ArchivedSegmentSource] listing failed:', error.message);
            return [];
        }
    }
}

export default new ArchivedSegmentSourceService();
