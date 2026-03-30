import { execute, query, queryOne } from '../database/connectionPool.js';
import { getTimezone } from './timezoneService.js';

function getTimestamp() {
    const timezone = getTimezone();
    return new Date().toLocaleString('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}

function normalizeOnlineFlag(value) {
    return value === true || value === 1 ? 1 : 0;
}

class CameraRuntimeStateService {
    constructor() {
        this.tableSupport = null;
    }

    hasRuntimeTable() {
        if (this.tableSupport !== null) {
            return this.tableSupport;
        }

        try {
            const table = queryOne(`
                SELECT name
                FROM sqlite_master
                WHERE type = 'table' AND name = 'camera_runtime_state'
            `);
            this.tableSupport = Boolean(table);
        } catch {
            this.tableSupport = false;
        }

        return this.tableSupport;
    }

    ensureRuntimeState(cameraId, seed = {}) {
        if (!this.hasRuntimeTable()) {
            return {
                camera_id: cameraId,
                is_online: normalizeOnlineFlag(seed.is_online),
                monitoring_state: seed.monitoring_state || (seed.is_online ? 'online' : 'unknown'),
                monitoring_reason: seed.monitoring_reason || (seed.is_online === undefined ? 'seed_unknown' : 'seed_from_camera'),
                last_runtime_signal_at: seed.last_runtime_signal_at || null,
                last_runtime_signal_type: seed.last_runtime_signal_type || null,
                last_health_check_at: seed.last_health_check_at || null,
            };
        }

        const existing = queryOne(`
            SELECT *
            FROM camera_runtime_state
            WHERE camera_id = ?
        `, [cameraId]);

        if (existing) {
            return existing;
        }

        const timestamp = getTimestamp();
        const isOnline = normalizeOnlineFlag(seed.is_online);
        const monitoringState = seed.monitoring_state || (isOnline ? 'online' : 'unknown');
        const monitoringReason = seed.monitoring_reason || (seed.is_online === undefined ? 'seed_unknown' : 'seed_from_camera');

        execute(`
            INSERT INTO camera_runtime_state (
                camera_id,
                is_online,
                monitoring_state,
                monitoring_reason,
                last_runtime_signal_at,
                last_runtime_signal_type,
                last_health_check_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            cameraId,
            isOnline,
            monitoringState,
            monitoringReason,
            seed.last_runtime_signal_at || null,
            seed.last_runtime_signal_type || null,
            seed.last_health_check_at || null,
            timestamp,
        ]);

        return queryOne(`
            SELECT *
            FROM camera_runtime_state
            WHERE camera_id = ?
        `, [cameraId]);
    }

    upsertRuntimeState(cameraId, fields = {}) {
        if (!this.hasRuntimeTable()) {
            return {
                camera_id: cameraId,
                is_online: fields.is_online !== undefined ? normalizeOnlineFlag(fields.is_online) : 0,
                monitoring_state: fields.monitoring_state || 'unknown',
                monitoring_reason: fields.monitoring_reason || null,
                last_runtime_signal_at: fields.last_runtime_signal_at || null,
                last_runtime_signal_type: fields.last_runtime_signal_type || null,
                last_health_check_at: fields.last_health_check_at || null,
                updated_at: getTimestamp(),
            };
        }

        const current = this.ensureRuntimeState(cameraId, fields);
        const timestamp = getTimestamp();

        const nextState = {
            is_online: fields.is_online !== undefined ? normalizeOnlineFlag(fields.is_online) : normalizeOnlineFlag(current.is_online),
            monitoring_state: fields.monitoring_state ?? current.monitoring_state ?? 'unknown',
            monitoring_reason: fields.monitoring_reason ?? current.monitoring_reason ?? null,
            last_runtime_signal_at: fields.last_runtime_signal_at ?? current.last_runtime_signal_at ?? null,
            last_runtime_signal_type: fields.last_runtime_signal_type ?? current.last_runtime_signal_type ?? null,
            last_health_check_at: fields.last_health_check_at ?? current.last_health_check_at ?? null,
            updated_at: timestamp,
        };

        execute(`
            INSERT INTO camera_runtime_state (
                camera_id,
                is_online,
                monitoring_state,
                monitoring_reason,
                last_runtime_signal_at,
                last_runtime_signal_type,
                last_health_check_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(camera_id) DO UPDATE SET
                is_online = excluded.is_online,
                monitoring_state = excluded.monitoring_state,
                monitoring_reason = excluded.monitoring_reason,
                last_runtime_signal_at = excluded.last_runtime_signal_at,
                last_runtime_signal_type = excluded.last_runtime_signal_type,
                last_health_check_at = excluded.last_health_check_at,
                updated_at = excluded.updated_at
        `, [
            cameraId,
            nextState.is_online,
            nextState.monitoring_state,
            nextState.monitoring_reason,
            nextState.last_runtime_signal_at,
            nextState.last_runtime_signal_type,
            nextState.last_health_check_at,
            nextState.updated_at,
        ]);

        return nextState;
    }

    seedMissingRows() {
        if (!this.hasRuntimeTable()) {
            return;
        }

        execute(`
            INSERT INTO camera_runtime_state (
                camera_id,
                is_online,
                monitoring_state,
                monitoring_reason,
                last_health_check_at,
                updated_at
            )
            SELECT
                c.id,
                COALESCE(c.is_online, 0),
                CASE
                    WHEN c.is_online = 1 THEN 'online'
                    WHEN c.is_online = 0 THEN 'offline'
                    ELSE 'unknown'
                END,
                CASE
                    WHEN c.is_online IS NULL THEN 'seed_unknown'
                    ELSE 'seed_from_camera'
                END,
                c.last_online_check,
                COALESCE(c.last_online_check, CURRENT_TIMESTAMP)
            FROM cameras c
            WHERE NOT EXISTS (
                SELECT 1
                FROM camera_runtime_state crs
                WHERE crs.camera_id = c.id
            )
        `);
    }

    getRuntimeStateMap(cameraIds = []) {
        if (!this.hasRuntimeTable()) {
            return new Map();
        }

        if (!Array.isArray(cameraIds) || cameraIds.length === 0) {
            return new Map();
        }

        const placeholders = cameraIds.map(() => '?').join(', ');
        const rows = query(`
            SELECT *
            FROM camera_runtime_state
            WHERE camera_id IN (${placeholders})
        `, cameraIds);

        return new Map(rows.map((row) => [row.camera_id, row]));
    }
}

export default new CameraRuntimeStateService();
