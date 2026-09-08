/*
Purpose: Set recording_duration_hours (jendela retensi, JAM) untuk BANYAK kamera sekaligus, per Area /
         per Grup / daftar id — supaya operator tak perlu buka kartu kamera satu per satu.
Caller: controllers/cameraController.js (bulkUpdateRecordingDuration).
Deps: database/connectionPool (query/queryOne/execute/transaction), cameraService (invalidasi cache).
MainFuncs: createBulkRecordingDurationUpdater (factory, deps di-inject untuk tes), default = terpasang.
SideEffects: UPDATE cameras + INSERT audit_logs (satu transaksi), invalidasi cache kamera.

Kenapa MODUL SENDIRI, bukan method di cameraService: cameraService.js beku di ratchet ukuran file
(guardrails). Retensi dibaca SEGAR tiap siklus cleanup (recordingCleanupService baca kolom ini per
kamera), jadi cukup UPDATE DB + invalidate cache — TIDAK perlu restart recorder. SQL parameterized penuh.
*/

import {
    query as defaultQuery,
    queryOne as defaultQueryOne,
    execute as defaultExecute,
    transaction as defaultTransaction,
} from '../database/connectionPool.js';
import cameraService from './cameraService.js';

export const RECORDING_DURATION_MIN_HOURS = 1;
// 2160 jam = 90 hari — selaras dengan batas validasi schemaValidators (updateCamera).
export const RECORDING_DURATION_MAX_HOURS = 2160;

const badRequest = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
};

export function createBulkRecordingDurationUpdater({
    query = defaultQuery,
    queryOne = defaultQueryOne,
    execute = defaultExecute,
    transaction = defaultTransaction,
    invalidateCameras = () => cameraService.invalidateCameraCache(),
} = {}) {
    return async function bulkUpdateRecordingDuration(
        { scope, areaId, groupName, cameraIds, recordingDurationHours } = {},
        request,
    ) {
        const hours = parseInt(recordingDurationHours, 10);
        if (!Number.isInteger(hours) || hours < RECORDING_DURATION_MIN_HOURS || hours > RECORDING_DURATION_MAX_HOURS) {
            throw badRequest(`recording_duration_hours harus bilangan bulat antara ${RECORDING_DURATION_MIN_HOURS} dan ${RECORDING_DURATION_MAX_HOURS} jam`);
        }

        let targets;
        let scopeLabel;
        if (scope === 'area') {
            const parsedAreaId = parseInt(areaId, 10);
            if (!Number.isInteger(parsedAreaId)) {
                throw badRequest('areaId diperlukan untuk scope area');
            }
            const area = queryOne('SELECT id, name FROM areas WHERE id = ?', [parsedAreaId]);
            if (!area) {
                const err = new Error('Area tidak ditemukan');
                err.statusCode = 404;
                throw err;
            }
            targets = query('SELECT id, name FROM cameras WHERE area_id = ? AND enabled = 1 ORDER BY id ASC', [parsedAreaId]);
            scopeLabel = `area "${area.name}"`;
        } else if (scope === 'group') {
            const name = typeof groupName === 'string' ? groupName.trim() : '';
            if (!name) {
                throw badRequest('groupName diperlukan untuk scope group');
            }
            targets = query('SELECT id, name FROM cameras WHERE group_name = ? AND enabled = 1 ORDER BY id ASC', [name]);
            scopeLabel = `grup "${name}"`;
        } else if (scope === 'ids') {
            const ids = Array.isArray(cameraIds)
                ? cameraIds.map((value) => parseInt(value, 10)).filter((value) => Number.isInteger(value))
                : [];
            if (ids.length === 0) {
                throw badRequest('cameraIds diperlukan untuk scope ids');
            }
            const placeholders = ids.map(() => '?').join(', ');
            targets = query(
                `SELECT id, name FROM cameras WHERE id IN (${placeholders}) AND enabled = 1 ORDER BY id ASC`,
                ids,
            );
            scopeLabel = `${ids.length} kamera terpilih`;
        } else {
            throw badRequest('scope harus salah satu dari: area, group, ids');
        }

        if (targets.length === 0) {
            throw badRequest('Tidak ada kamera enabled yang cocok dengan pilihan ini');
        }

        const targetIds = targets.map((camera) => camera.id);
        const placeholders = targetIds.map(() => '?').join(', ');
        transaction(() => {
            execute(
                `UPDATE cameras SET recording_duration_hours = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
                [hours, ...targetIds],
            );
            execute(
                'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
                [
                    request?.user?.id ?? null,
                    'BULK_UPDATE_RECORDING_DURATION',
                    `Set retensi ${hours} jam untuk ${targets.length} kamera (${scopeLabel})`,
                    request?.ip ?? null,
                ],
            );
        });

        invalidateCameras();

        return {
            updated: targets.length,
            recording_duration_hours: hours,
            scope,
            cameras: targets,
        };
    };
}

export default createBulkRecordingDurationUpdater();
