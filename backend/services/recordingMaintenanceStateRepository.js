// Purpose: Persist recording maintenance run status for cleanup observability.
// Caller: recordingMaintenanceService, recordingEmergencyDiskService, recordingAssuranceService.
// Deps: database connectionPool helpers.
// MainFuncs: upsertRunState, insertRunEvent, getLatestState.
// SideEffects: Writes and reads recording_maintenance_state and recording_maintenance_events.

import { execute, queryOne } from '../database/connectionPool.js';

class RecordingMaintenanceStateRepository {
    upsertRunState({ maintenanceType, status, startedAt, finishedAt, deleted, deletedBytes, errorMessage }) {
        return execute(
            `INSERT INTO recording_maintenance_state
            (maintenance_type, status, started_at, finished_at, deleted, deleted_bytes, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(maintenance_type) DO UPDATE SET
                status = excluded.status,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                deleted = excluded.deleted,
                deleted_bytes = excluded.deleted_bytes,
                error_message = excluded.error_message,
                updated_at = CURRENT_TIMESTAMP`,
            [maintenanceType, status, startedAt, finishedAt, deleted, deletedBytes, errorMessage]
        );
    }

    insertRunEvent({ maintenanceType, status, startedAt, finishedAt, deleted, deletedBytes, errorMessage }) {
        return execute(
            `INSERT INTO recording_maintenance_events
            (maintenance_type, status, started_at, finished_at, deleted, deleted_bytes, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [maintenanceType, status, startedAt, finishedAt, deleted, deletedBytes, errorMessage]
        );
    }

    getLatestState(maintenanceType) {
        return queryOne(
            `SELECT maintenance_type, status, started_at, finished_at, deleted, deleted_bytes, error_message, updated_at
            FROM recording_maintenance_state
            WHERE maintenance_type = ?`,
            [maintenanceType]
        );
    }
}

export default new RecordingMaintenanceStateRepository();
