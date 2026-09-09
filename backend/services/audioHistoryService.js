/*
Purpose: Broadcast history + delivery receipts for Audio Broadcast. One row per play (never per-frame)
         records what was broadcast, to which cameras, and the per-camera result (sounded / failed + why).
         Powers "Riwayat", "Bukti siaran", and "Ulangi terakhir".
Caller: audioController (log a play after it runs; list history).
Deps: connectionPool.
MainFuncs: logPlay, listHistory.
SideEffects: writes audio_play_log (parameterized, one row per broadcast).
*/

import { query, execute } from '../database/connectionPool.js';

/** Record one broadcast event with its per-camera receipt. Best-effort — never throws into the play path. */
export function logPlay({ sourceType, sourceId, sourceName, cameraIds, results, operatorId, operatorName }) {
    try {
        const list = Array.isArray(results) ? results : [];
        const ok = list.filter((r) => r.ok).length;
        execute(
            `INSERT INTO audio_play_log (source_type, source_id, source_name, camera_ids, results, ok_count, total_count, operator_id, operator_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(sourceType || ''), parseInt(sourceId, 10) || 0, sourceName ? String(sourceName).slice(0, 120) : null,
                JSON.stringify(Array.isArray(cameraIds) ? cameraIds : []),
                JSON.stringify(list).slice(0, 20000), ok, list.length,
                operatorId ?? null, operatorName ? String(operatorName).slice(0, 80) : null,
            ],
        );
    } catch (e) {
        console.error('[AudioHistory] logPlay failed:', e.message);
    }
}

/** Recent broadcasts, newest first, with parsed camera_ids + per-camera results. */
export function listHistory(limit = 30) {
    const rows = query('SELECT * FROM audio_play_log ORDER BY id DESC LIMIT ?', [Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100)]);
    return rows.map((r) => {
        let cameraIds = [];
        let results = [];
        try { cameraIds = JSON.parse(r.camera_ids || '[]'); } catch { cameraIds = []; }
        try { results = JSON.parse(r.results || '[]'); } catch { results = []; }
        return {
            id: r.id,
            source_type: r.source_type,
            source_id: r.source_id,
            source_name: r.source_name,
            camera_ids: Array.isArray(cameraIds) ? cameraIds : [],
            results: Array.isArray(results) ? results : [],
            ok_count: r.ok_count,
            total_count: r.total_count,
            operator_name: r.operator_name,
            created_at: r.created_at,
        };
    });
}

export default { logPlay, listHistory };
