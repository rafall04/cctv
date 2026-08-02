import { execute, query, queryOne } from '../database/connectionPool.js';
import { getTimezone } from './timezoneService.js';
import { nextDeadStreak } from './cameraSourceDeadPolicy.js';

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

// Backfill is self-healing, not on the critical path: the read models LEFT JOIN
// camera_runtime_state and tolerate a missing row, and the 30s health-check loop
// upserts runtime rows anyway. So the INSERT…SELECT only needs to run occasionally,
// not on every camera-list HTTP request (admin + public landing + public map all
// hit it). Throttling it removes a write-lock acquisition from every such request.
const SEED_THROTTLE_MS = 30 * 1000;

class CameraRuntimeStateService {
    constructor() {
        this.tableSupport = null;
        this.sourceDeadSupport = null;
        this._lastSeedAt = 0;
    }

    /**
     * The dead-at-source columns arrived later than the table, so a database that has not run
     * `npm run migrate` yet must keep writing runtime state rather than failing every health tick.
     */
    hasSourceDeadColumns() {
        if (this.sourceDeadSupport !== null) {
            return this.sourceDeadSupport;
        }

        try {
            const columns = query('PRAGMA table_info(camera_runtime_state)').map((c) => c.name);
            this.sourceDeadSupport = columns.includes('source_dead_since')
                && columns.includes('source_dead_reason');
        } catch {
            this.sourceDeadSupport = false;
        }

        return this.sourceDeadSupport;
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

        const inserted = queryOne(`
            SELECT *
            FROM camera_runtime_state
            WHERE camera_id = ?
        `, [cameraId]);

        /*
         * Read-back is NOT guaranteed to see the row we just wrote. connectionPool
         * keeps separate read and write connections, so this SELECT can land on a
         * snapshot taken before the INSERT — the exact hazard SYSTEM_MAP records for
         * this module. It fired in production: 22 x
         *   "[CameraHealth] Check failed: Cannot read properties of undefined
         *    (reading 'last_runtime_signal_at')"
         * because upsertRuntimeState read `current.last_runtime_signal_at` off the
         * undefined this used to return. Its try/catch sits around the whole sweep,
         * so ONE camera in that state stopped every remaining camera from being
         * checked that tick.
         *
         * The values were just written, so returning them directly is both correct
         * and cheaper than retrying the read. Contract: when the table exists, this
         * never returns undefined.
         */
        return inserted || {
            camera_id: cameraId,
            is_online: isOnline,
            monitoring_state: monitoringState,
            monitoring_reason: monitoringReason,
            last_runtime_signal_at: seed.last_runtime_signal_at || null,
            last_runtime_signal_type: seed.last_runtime_signal_type || null,
            last_health_check_at: seed.last_health_check_at || null,
            source_dead_since: null,
            source_dead_reason: null,
            updated_at: timestamp,
        };
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
                source_dead_since: null,
                source_dead_reason: null,
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

        /*
         * "Dead at source" is derived here rather than by the caller because this is the one place
         * every health outcome funnels through — a caller-side version would have to be repeated at
         * each probe path and would drift the moment one of them was missed.
         */
        const streak = nextDeadStreak({
            isOnline: nextState.is_online,
            reason: nextState.monitoring_reason,
            currentSince: current.source_dead_since ?? null,
            currentReason: current.source_dead_reason ?? null,
            /*
             * UTC ISO, NOT the app-local `timestamp` the other columns use. This value is subtracted
             * from a clock to produce "dead for 49 hours", and a local-time string parsed against a
             * process in a different zone is wrong by exactly the offset. New persistence prefers
             * UTC (SYSTEM_MAP, Data And Indexes) and these two columns are new.
             */
            timestamp: new Date().toISOString(),
        });
        nextState.source_dead_since = streak.since;
        nextState.source_dead_reason = streak.reason;

        // Column names come from this fixed list, never from input; the values stay parameterized.
        const columns = [
            'camera_id',
            'is_online',
            'monitoring_state',
            'monitoring_reason',
            'last_runtime_signal_at',
            'last_runtime_signal_type',
            'last_health_check_at',
            'updated_at',
        ];
        const values = [
            cameraId,
            nextState.is_online,
            nextState.monitoring_state,
            nextState.monitoring_reason,
            nextState.last_runtime_signal_at,
            nextState.last_runtime_signal_type,
            nextState.last_health_check_at,
            nextState.updated_at,
        ];

        if (this.hasSourceDeadColumns()) {
            columns.push('source_dead_since', 'source_dead_reason');
            values.push(streak.since, streak.reason);
        }

        const assignments = columns
            .filter((column) => column !== 'camera_id')
            .map((column) => `${column} = excluded.${column}`)
            .join(', ');

        execute(`
            INSERT INTO camera_runtime_state (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
            ON CONFLICT(camera_id) DO UPDATE SET ${assignments}
        `, values);

        return nextState;
    }

    seedMissingRows({ force = false } = {}) {
        if (!this.hasRuntimeTable()) {
            return;
        }

        // Throttle: skip the write entirely when we seeded recently. `force`
        // bypasses it for the rare path that genuinely needs an immediate backfill.
        const now = Date.now();
        if (!force && now - this._lastSeedAt < SEED_THROTTLE_MS) {
            return;
        }
        this._lastSeedAt = now;

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
