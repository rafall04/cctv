// Purpose: Centralize bounded SQLite queries for recording segment cleanup and playback.
// Caller: recordingCleanupService, recordingPlaybackService, repository tests.
// Deps: SQLite connectionPool query/queryOne/execute helpers.
// MainFuncs: upsertSegment, findExpiredSegments, findPlaybackSegments, findSegmentByFilename, findSegmentInWindow, deleteSegmentById.
// SideEffects: Reads, inserts, updates, and deletes recording_segments rows.

import { execute, query, queryOne, transaction } from '../database/connectionPool.js';

const SEGMENT_SELECT_FIELDS = `
    id,
    camera_id,
    filename,
    start_time,
    end_time,
    file_size,
    duration,
    created_at,
    file_path
`;

class RecordingSegmentRepository {
    upsertSegment({
        cameraId,
        filename,
        startTime,
        endTime,
        fileSize,
        duration,
        filePath,
    }) {
        const persistSegment = transaction(() => {
            const updateResult = execute(
                `UPDATE recording_segments
                SET
                start_time = ?,
                end_time = ?,
                file_size = ?,
                duration = ?,
                file_path = ?
                WHERE camera_id = ? AND filename = ?`,
                [startTime, endTime, fileSize, duration, filePath, cameraId, filename]
            );

            if (updateResult.changes > 0) {
                if (updateResult.changes > 1) {
                    execute(
                        `DELETE FROM recording_segments
                        WHERE camera_id = ?
                          AND filename = ?
                          AND id NOT IN (
                              SELECT MAX(id)
                              FROM recording_segments
                              WHERE camera_id = ? AND filename = ?
                          )`,
                        [cameraId, filename, cameraId, filename]
                    );
                }

                return updateResult;
            }

            return execute(
                `INSERT INTO recording_segments
                (camera_id, filename, start_time, end_time, file_size, duration, file_path)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [cameraId, filename, startTime, endTime, fileSize, duration, filePath]
            );
        });

        return persistSegment();
    }

    findExpiredSegments({ cameraId, cutoffIso, limit }) {
        return query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ? AND start_time < ?
            ORDER BY start_time ASC
            LIMIT ?`,
            [cameraId, cutoffIso, limit]
        );
    }

    /** Total byte yang dipakai SELURUH rekaman terdaftar. Untuk gerbang batas penyimpanan. */
    totalStoredBytes() {
        const row = queryOne('SELECT COALESCE(SUM(file_size), 0) AS n FROM recording_segments');
        return Number(row?.n || 0);
    }

    findMissingFileCandidates({ cameraId, olderThanIso, limit }) {
        return query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ? AND start_time < ?
            ORDER BY start_time ASC
            LIMIT ?`,
            [cameraId, olderThanIso, limit]
        );
    }

    listFilenamesByCamera(cameraId) {
        return query(
            'SELECT filename FROM recording_segments WHERE camera_id = ?',
            [cameraId]
        ).map((row) => row.filename);
    }

    findExistingFilenames({ cameraId, filenames }) {
        if (!filenames.length) {
            return [];
        }

        const placeholders = filenames.map(() => '?').join(', ');
        return query(
            `SELECT filename
            FROM recording_segments
            WHERE camera_id = ? AND filename IN (${placeholders})`,
            [cameraId, ...filenames]
        ).map((row) => row.filename);
    }

    deleteSegmentById(id) {
        return execute('DELETE FROM recording_segments WHERE id = ?', [id]);
    }

    findPlaybackSegments({ cameraId, order = 'oldest', limit = 500, returnAscending = false, fromIso = null, toIso = null }) {
        const direction = order === 'latest' ? 'DESC' : 'ASC';
        // Optional [fromIso, toIso] scope the LIMIT to the entitled window. Without it, a plain
        // ORDER BY start_time ASC LIMIT keeps the OLDEST rows and silently drops the NEWEST — so a
        // recent range on a high-retention camera returned nothing on disk (the deep-playback path).
        // Both bounds string-compare against the ISO-8601 UTC start_time, same convention as the range policy.
        // HALF-OPEN interval [fromIso, toIso): the ceiling is EXCLUSIVE on the segment START. Segments
        // are keyed by start only but each plays ~one duration past it, so an inclusive `<=` admitted the
        // segment starting exactly at toIso (e.g. a 10:00 segment for an 08:00-10:00 token) and let it
        // play to ~10:10 — a full-segment overshoot. `<` drops it so the last segment ends at the bound.
        const clauses = ['camera_id = ?'];
        const params = [cameraId];
        if (fromIso) { clauses.push('start_time >= ?'); params.push(fromIso); }
        if (toIso) { clauses.push('start_time < ?'); params.push(toIso); }
        params.push(limit);

        const rows = query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE ${clauses.join(' AND ')}
            ORDER BY start_time ${direction}
            LIMIT ?`,
            params
        );

        if (returnAscending && direction === 'DESC') {
            return [...rows].reverse();
        }

        return rows;
    }

    findSegmentByFilename({ cameraId, filename }) {
        return queryOne(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ? AND filename = ?`,
            [cameraId, filename]
        );
    }

    findSegmentInWindow({ cameraId, filename, startAfterIso = null, startBeforeIso = null }) {
        if (!startAfterIso && !startBeforeIso) {
            return this.findSegmentByFilename({ cameraId, filename });
        }

        // Floor (>= startAfterIso) AND, for an absolute-range token, EXCLUSIVE ceiling (< startBeforeIso).
        // Both string-compare against the ISO-8601 UTC start_time (chronological), same as the range
        // policy. `<` (not `<=`) so a segment starting exactly at the token's upper bound cannot be
        // streamed either — the ceiling here must match the list gate in findPlaybackSegments.
        const clauses = ['camera_id = ?', 'filename = ?'];
        const params = [cameraId, filename];
        if (startAfterIso) { clauses.push('start_time >= ?'); params.push(startAfterIso); }
        if (startBeforeIso) { clauses.push('start_time < ?'); params.push(startBeforeIso); }

        return queryOne(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE ${clauses.join(' AND ')}`,
            params
        );
    }

    findOldestSegmentsForEmergency({ afterStartTime = null, afterId = 0, limit = 200 } = {}) {
        if (!afterStartTime) {
            return query(
                `SELECT ${SEGMENT_SELECT_FIELDS}
                FROM recording_segments
                ORDER BY start_time ASC, id ASC
                LIMIT ?`,
                [limit]
            );
        }

        return query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE start_time > ? OR (start_time = ? AND id > ?)
            ORDER BY start_time ASC, id ASC
            LIMIT ?`,
            [afterStartTime, afterStartTime, afterId, limit]
        );
    }
}

export default new RecordingSegmentRepository();
