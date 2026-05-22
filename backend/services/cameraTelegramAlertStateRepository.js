/*
Purpose: Persist per-camera Telegram alert-confirmation state so a backend
         restart or stream refresh does not drop an in-flight DOWN alert.
Caller: cameraHealthService (hydrate on tick, persist after each evaluation).
Deps: database connectionPool. Degrades gracefully if the table is absent.
MainFuncs: getStateMap, upsertStates.
SideEffects: Reads/writes the camera_telegram_alert_state table.
*/

import { execute, query, queryOne, transaction } from '../database/connectionPool.js';

class CameraTelegramAlertStateRepository {
    constructor() {
        this.tableSupport = null;
    }

    hasTable() {
        if (this.tableSupport !== null) {
            return this.tableSupport;
        }
        try {
            const table = queryOne(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'camera_telegram_alert_state'"
            );
            this.tableSupport = Boolean(table);
        } catch {
            this.tableSupport = false;
        }
        return this.tableSupport;
    }

    /**
     * Load persisted alert-confirmation state for the given camera ids.
     * @returns {Map<number, object>} cameraId → parsed confirmation state
     */
    getStateMap(cameraIds = []) {
        if (!this.hasTable() || !Array.isArray(cameraIds) || cameraIds.length === 0) {
            return new Map();
        }
        try {
            const placeholders = cameraIds.map(() => '?').join(', ');
            const rows = query(
                `SELECT camera_id, alert_state FROM camera_telegram_alert_state WHERE camera_id IN (${placeholders})`,
                cameraIds
            );
            const map = new Map();
            for (const row of rows) {
                try {
                    const parsed = JSON.parse(row.alert_state);
                    if (parsed && typeof parsed === 'object') {
                        map.set(row.camera_id, parsed);
                    }
                } catch {
                    // Skip a corrupt row rather than failing the whole hydrate.
                }
            }
            return map;
        } catch (error) {
            console.warn('[TelegramAlertState] read failed:', error.message);
            return new Map();
        }
    }

    /**
     * Persist alert-confirmation state for a batch of cameras in one transaction.
     * @param {Array<{cameraId:number, state:object}>} entries
     */
    upsertStates(entries = []) {
        if (!this.hasTable() || !Array.isArray(entries) || entries.length === 0) {
            return;
        }
        try {
            const run = transaction((items) => {
                for (const { cameraId, state } of items) {
                    if (!Number.isFinite(Number(cameraId)) || !state || typeof state !== 'object') {
                        continue;
                    }
                    execute(
                        `INSERT INTO camera_telegram_alert_state (camera_id, alert_state, updated_at)
                         VALUES (?, ?, CURRENT_TIMESTAMP)
                         ON CONFLICT(camera_id) DO UPDATE SET
                             alert_state = excluded.alert_state,
                             updated_at = excluded.updated_at`,
                        [Number(cameraId), JSON.stringify(state)]
                    );
                }
            });
            run(entries);
        } catch (error) {
            console.warn('[TelegramAlertState] write failed:', error.message);
        }
    }
}

export default new CameraTelegramAlertStateRepository();
