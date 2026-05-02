// Purpose: Centralize bounded SQLite queries for recording segment cleanup and playback.
// Caller: recordingCleanupService, recordingPlaybackService, repository tests.
// Deps: SQLite connectionPool query/queryOne/execute helpers.
// MainFuncs: upsertSegment, findExpiredSegments, findPlaybackSegments, findSegmentByFilename, deleteSegmentById.
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

    findPlaybackSegments({ cameraId, order = 'oldest', limit = 500, returnAscending = false }) {
        const direction = order === 'latest' ? 'DESC' : 'ASC';
        const rows = query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ?
            ORDER BY start_time ${direction}
            LIMIT ?`,
            [cameraId, limit]
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
