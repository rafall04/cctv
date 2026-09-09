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
          AND ${capClause}
        ORDER BY (c.supports_audio_out = 1) DESC, a.name ASC, c.name ASC`);
    return cameras;
}

/** Every area with its audio-broadcast flag + how many internal-RTSP cameras it holds (for the toggle UI). */
export function listAreas() {
    return query(`
        SELECT a.id, a.name, a.audio_broadcast_enabled,
               (SELECT COUNT(*) FROM cameras c
                  WHERE c.area_id = a.id AND c.enabled = 1 AND c.stream_source = 'internal'
                    AND c.private_rtsp_url IS NOT NULL AND c.private_rtsp_url != '') AS internal_camera_count
        FROM areas a
        ORDER BY a.audio_broadcast_enabled DESC, internal_camera_count DESC, a.name ASC`);
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

export default { listBroadcastTargets, listAreas, setAreaEnabled };
