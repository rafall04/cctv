/*
Purpose: The LOCAL-scoped broadcast target list for Audio Broadcast, plus the per-area enable toggle that
         defines "local". Fixes the shipped picker being flooded by ~394 remote Surabaya cameras: targets
         are gated by a deterministic area allowlist (areas.audio_broadcast_enabled), NOT an IP heuristic.
Caller: audioController (list targets, list/toggle areas).
Deps: connectionPool. (STB speaker-node union arrives with roadmap axis B — cameras only for now.)
MainFuncs: listBroadcastTargets, listAreas, setAreaEnabled.
SideEffects: writes areas.audio_broadcast_enabled (parameterized).

Two gates drop Surabaya: (1) area allowlist (default 0 -> every remote/ATCS area OFF from minute one),
(2) capability = supported (a 404 RTSP never probes supported). Gate (1) is load-bearing and works before
any probe runs.
*/

import { query, queryOne, execute } from '../database/connectionPool.js';
import { triggerBackgroundRecheck } from './audioCapabilityService.js';
import { isAreaQuietNow, hhmmToMinutes } from '../utils/wibClock.js';

/**
 * Cameras that can be audio-broadcast targets, scoped to audio-enabled areas.
 * @param {{includeUnknown?: boolean}} opts includeUnknown=true also returns not-yet-probed cameras (for the
 *   manual picker, badged "perlu tes"); scheduled/automated callers pass false for supported-only.
 */
export function listBroadcastTargets({ includeUnknown = true } = {}) {
    const capClause = includeUnknown
        ? "(c.supports_audio_out = 1 OR c.supports_audio_out IS NULL)"
        : 'c.supports_audio_out = 1';
    const cameras = query(`
        SELECT 'camera' AS target_kind, c.id, c.name, a.name AS area_name, c.area_id,
               c.supports_audio_out, c.audio_out_checked_at, c.audio_out_note
        FROM cameras c JOIN areas a ON a.id = c.area_id
        WHERE c.enabled = 1 AND c.stream_source = 'internal'
          AND c.private_rtsp_url IS NOT NULL AND c.private_rtsp_url != ''
          AND a.audio_broadcast_enabled = 1
          AND c.audio_out_blocked = 0
          AND ${capClause}
        ORDER BY (c.supports_audio_out = 1) DESC, a.name ASC, c.name ASC`);
    return cameras;
}

/** Every area with its audio-broadcast flag + quiet-hours/loop-cap + internal-RTSP camera count. */
export function listAreas() {
    return query(`
        SELECT a.id, a.name, a.audio_broadcast_enabled, a.quiet_start, a.quiet_end, a.max_loop,
               (SELECT COUNT(*) FROM cameras c
                  WHERE c.area_id = a.id AND c.enabled = 1 AND c.stream_source = 'internal'
                    AND c.private_rtsp_url IS NOT NULL AND c.private_rtsp_url != '') AS internal_camera_count
        FROM areas a
        ORDER BY a.audio_broadcast_enabled DESC, internal_camera_count DESC, a.name ASC`);
}

/** Set an area's quiet hours (WIB HH:MM, or empty to clear) + optional loop ceiling. */
export function setAreaPolicy(areaId, { quiet_start, quiet_end, max_loop } = {}) {
    const id = parseInt(areaId, 10);
    const area = queryOne('SELECT id, name FROM areas WHERE id = ?', [id]);
    if (!area) { const e = new Error('Area tidak ditemukan'); e.statusCode = 404; throw e; }
    const norm = (v) => {
        if (v === null || v === undefined || v === '') return null;
        if (hhmmToMinutes(v) == null) { const e = new Error('Jam harus format HH:MM'); e.statusCode = 400; throw e; }
        return String(v).trim();
    };
    const qs = norm(quiet_start);
    const qe = norm(quiet_end);
    // Both-or-neither: a lone bound is meaningless.
    if ((qs && !qe) || (qe && !qs)) { const e = new Error('Isi jam mulai DAN selesai, atau kosongkan keduanya'); e.statusCode = 400; throw e; }
    let cap = null;
    if (max_loop !== null && max_loop !== undefined && max_loop !== '') {
        cap = parseInt(max_loop, 10);
        if (!Number.isInteger(cap) || cap < 1 || cap > 20) { const e = new Error('Plafon ulang 1–20'); e.statusCode = 400; throw e; }
    }
    execute('UPDATE areas SET quiet_start = ?, quiet_end = ?, max_loop = ? WHERE id = ?', [qs, qe, cap, id]);
    return queryOne('SELECT id, name, quiet_start, quiet_end, max_loop FROM areas WHERE id = ?', [id]);
}

/** Which of the given target cameras sit in an area that is in quiet hours right now (for confirm UX). */
export function quietTargets(cameraIds) {
    const ids = [...new Set((cameraIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = query(
        `SELECT c.id, c.name, a.name AS area_name, a.quiet_start, a.quiet_end
         FROM cameras c JOIN areas a ON a.id = c.area_id WHERE c.id IN (${placeholders})`,
        ids,
    );
    return rows.filter((r) => isAreaQuietNow(r)).map((r) => ({ id: r.id, name: r.name, area_name: r.area_name }));
}

/** Turn an area's audio-broadcast allowlist flag on/off. */
export function setAreaEnabled(areaId, enabled) {
    const id = parseInt(areaId, 10);
    const area = queryOne('SELECT id, name FROM areas WHERE id = ?', [id]);
    if (!area) { const e = new Error('Area tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('UPDATE areas SET audio_broadcast_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
    // Enabling an area brings its cameras into scope — probe them in the background so they don't sit
    // on "Perlu tes" until the 6h sweep or a manual click.
    if (enabled) triggerBackgroundRecheck();
    return { id: area.id, name: area.name, audio_broadcast_enabled: enabled ? 1 : 0 };
}

export default { listBroadcastTargets, listAreas, setAreaEnabled, setAreaPolicy, quietTargets };
