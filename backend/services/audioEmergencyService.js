/*
Purpose: Emergency broadcast for Audio Broadcast — fire a clip/playlist to an area's supported cameras
         with PREEMPTION (displace whatever is playing) and NO quiet-hours gate, for banjir/kebakaran/etc.
         Plus CRUD for saved "panic" presets so an operator taps one thing under stress. Fan-out is capped
         so an emergency can't melt the weak box; firing always requires an explicit confirm (in the API).
Caller: audioController (preset CRUD + fire).
Deps: connectionPool, audioTargetService.listBroadcastTargets, audioCastService.playToCameras.
MainFuncs: listPresets, createPreset, updatePreset, deletePreset, resolveTargets, fireEmergency.
SideEffects: writes audio_emergency_presets; spawns preempting broadcasts on fire.
*/

import { query, queryOne, execute } from '../database/connectionPool.js';
import { listBroadcastTargets } from './audioTargetService.js';
import { playToCameras } from './audioCastService.js';

const MAX_EMERGENCY_CAMERAS = Math.max(1, parseInt(process.env.AUDIO_MAX_EMERGENCY || '12', 10));

function sanitizeIds(cameraIds) {
    if (!Array.isArray(cameraIds)) return [];
    return [...new Set(cameraIds.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

function validate({ label, sourceType, sourceId, targetKind, areaId, cameraIds, loop }) {
    const cleanLabel = typeof label === 'string' ? label.trim() : '';
    if (!cleanLabel) { const e = new Error('Label wajib diisi'); e.statusCode = 400; throw e; }
    if (!['clip', 'playlist'].includes(sourceType)) { const e = new Error('sourceType harus clip atau playlist'); e.statusCode = 400; throw e; }
    const sid = parseInt(sourceId, 10);
    if (!Number.isInteger(sid) || sid <= 0) { const e = new Error('Sumber tidak valid'); e.statusCode = 400; throw e; }
    const kind = targetKind === 'cameras' ? 'cameras' : 'area';
    const aid = kind === 'area' ? parseInt(areaId, 10) : null;
    if (kind === 'area' && (!Number.isInteger(aid) || aid <= 0)) { const e = new Error('Pilih area target'); e.statusCode = 400; throw e; }
    const ids = kind === 'cameras' ? sanitizeIds(cameraIds) : [];
    const n = Math.min(Math.max(parseInt(loop, 10) || 3, 1), 20);
    return { cleanLabel, sourceType, sid, kind, aid, ids, n };
}

function decorate(row) {
    let ids = [];
    try { ids = JSON.parse(row.camera_ids || '[]'); } catch { ids = []; }
    return { ...row, camera_ids: Array.isArray(ids) ? ids : [] };
}

export function listPresets() {
    return query('SELECT * FROM audio_emergency_presets ORDER BY id ASC').map(decorate);
}

export function createPreset(data) {
    const v = validate(data);
    const info = execute(
        `INSERT INTO audio_emergency_presets (label, source_type, source_id, target_kind, area_id, camera_ids, loop, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.cleanLabel, v.sourceType, v.sid, v.kind, v.aid, JSON.stringify(v.ids), v.n, data.userId ?? null],
    );
    return decorate(queryOne('SELECT * FROM audio_emergency_presets WHERE id = ?', [info.lastInsertRowid]));
}

export function updatePreset(id, data) {
    const pid = parseInt(id, 10);
    const existing = queryOne('SELECT * FROM audio_emergency_presets WHERE id = ?', [pid]);
    if (!existing) { const e = new Error('Preset darurat tidak ditemukan'); e.statusCode = 404; throw e; }
    const merged = {
        label: data.label !== undefined ? data.label : existing.label,
        sourceType: data.sourceType !== undefined ? data.sourceType : existing.source_type,
        sourceId: data.sourceId !== undefined ? data.sourceId : existing.source_id,
        targetKind: data.targetKind !== undefined ? data.targetKind : existing.target_kind,
        areaId: data.areaId !== undefined ? data.areaId : existing.area_id,
        cameraIds: data.cameraIds !== undefined ? data.cameraIds : JSON.parse(existing.camera_ids || '[]'),
        loop: data.loop !== undefined ? data.loop : existing.loop,
    };
    const v = validate(merged);
    execute(
        'UPDATE audio_emergency_presets SET label = ?, source_type = ?, source_id = ?, target_kind = ?, area_id = ?, camera_ids = ?, loop = ? WHERE id = ?',
        [v.cleanLabel, v.sourceType, v.sid, v.kind, v.aid, JSON.stringify(v.ids), v.n, pid],
    );
    return decorate(queryOne('SELECT * FROM audio_emergency_presets WHERE id = ?', [pid]));
}

export function deletePreset(id) {
    const pid = parseInt(id, 10);
    const existing = queryOne('SELECT id, label FROM audio_emergency_presets WHERE id = ?', [pid]);
    if (!existing) { const e = new Error('Preset darurat tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('DELETE FROM audio_emergency_presets WHERE id = ?', [pid]);
    return { id: existing.id, label: existing.label };
}

/** SUPPORTED, in-scope cameras for an emergency target, capped so a panic can't melt the box. */
export function resolveTargets({ targetKind, areaId, cameraIds }) {
    const supported = listBroadcastTargets({ includeUnknown: false }); // proven-to-sound only
    let ids;
    if ((targetKind || 'area') === 'area') {
        const aid = parseInt(areaId, 10);
        ids = supported.filter((t) => t.area_id === aid).map((t) => t.id);
    } else {
        const set = new Set(supported.map((t) => t.id));
        ids = sanitizeIds(cameraIds).filter((id) => set.has(id));
    }
    return ids.slice(0, MAX_EMERGENCY_CAMERAS);
}

/**
 * Fire an emergency: PREEMPT the resolved supported cameras and play the source now, bypassing quiet
 * hours + the governor cap. Returns { results, ids }. Throws 400 if nothing to target.
 */
export async function fireEmergency({ sourceType = 'clip', sourceId, targetKind, areaId, cameraIds, loop = 3 }) {
    const ids = resolveTargets({ targetKind, areaId, cameraIds });
    if (ids.length === 0) { const e = new Error('Tak ada kamera didukung untuk target darurat ini'); e.statusCode = 400; throw e; }
    const { results } = await playToCameras(ids, sourceType, parseInt(sourceId, 10),
        Math.min(Math.max(parseInt(loop, 10) || 3, 1), 20), { preempt: true });
    return { results, ids };
}

export default { listPresets, createPreset, updatePreset, deletePreset, resolveTargets, fireEmergency, MAX_EMERGENCY_CAMERAS };
