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
     * Archived segments for one camera, returned oldest-first — the caller merges and re-sorts.
     * `range` is ISO-8601 UTC bounds ({from, to}, either side optional): the caller's entitlement
     * already intersected with whatever day it is showing, so the query reads only what will be
     * rendered. The playback window is still re-applied by the caller, so this stays a pure source
     * rather than a second copy of the policy.
     *
     * The LIMIT is taken off the NEWEST end. It used to order ASC and cut there, which quietly kept
     * the OLDEST `limit` rows: on production each camera had ~1,400 archived segments, so 334-431 of
     * the most recent ones were dropped — precisely the stretch local retention had already pruned
     * off disk. The playback timeline then drew a 42-63 hour band of red "Hilang" over footage that
     * was sitting in the archive the whole time. An archive is read from the recent end; a cap that
     * discards the newest rows is never the one an operator wants.
     */
    listArchivedSegments(cameraId, { range = null, limit = 1000 } = {}) {
        const id = Number.parseInt(cameraId, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return [];
        }

        const params = [id];
        const bounds = [];
        if (range?.from) {
            bounds.push('AND u.recorded_at >= ?');
            params.push(range.from);
        }
        if (range?.to) {
            // Half-open [from, to): exclusive upper on the segment START (recorded_at), matching the
            // local-recording gate so an archived segment starting at the bound does not overshoot it.
            bounds.push('AND u.recorded_at < ?');
            params.push(range.to);
        }
        params.push(Math.max(1, Math.min(Number(limit) || 1000, 5000)));

        try {
            const rows = query(
                `SELECT u.segment_id, u.camera_id, u.filename, u.file_size,
                        u.recorded_at, u.recorded_until, u.duration_seconds, u.uploaded_at
                   FROM telegram_archive_uploads u
                  WHERE u.camera_id = ?
                    AND u.status = 'ok'
                    AND u.file_id IS NOT NULL
                    ${bounds.join(' ')}
                  ORDER BY u.recorded_at DESC
                  LIMIT ?`,
                params
            );
            // Selected newest-first so the cap bites the far end of history; handed back oldest-first
            // because that is the order the merge and the timeline read in.
            if (!Array.isArray(rows)) return [];
            rows.reverse();
            return rows.map((row) => ({
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
