// Purpose: Centralize bounded SQLite queries for recording segment cleanup and playback.
// Caller: recordingCleanupService, recordingPlaybackService, repository tests.
// Deps: SQLite connectionPool query/queryOne/execute helpers.
// MainFuncs: findExpiredSegments, findPlaybackSegments, findSegmentByFilename, deleteSegmentById.
// SideEffects: Reads and deletes recording_segments rows.

import { execute, query, queryOne } from '../database/connectionPool.js';

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
}

export default new RecordingSegmentRepository();
