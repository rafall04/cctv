/*
Purpose: Custom MANUAL camera groups for Audio Broadcast — CRUD over a named bag of arbitrary camera
         ids (no area basis). Lets an operator save a selection once ("Musholla" = cam A,B,C) and reuse
         it in one tap in the picker, on top of the area presets that already exist.
Caller: audioController (list/create/update/delete groups).
Deps: connectionPool.
MainFuncs: listGroups, createGroup, updateGroup, deleteGroup.
SideEffects: writes audio_camera_groups (parameterized).

Membership is stored as a JSON array of camera ids exactly as chosen. listGroups resolves each id to a
current camera name/area for display and drops ids that no longer exist, but the STORED list is left
intact so a camera temporarily out of scope (its area toggled off) reappears when it returns.
*/

import { query, queryOne, execute } from '../database/connectionPool.js';

/** Normalise a client-supplied id list into unique positive integers that map to a real camera. */
function sanitizeCameraIds(cameraIds) {
    if (!Array.isArray(cameraIds)) return [];
    const unique = [...new Set(cameraIds.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0))];
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => '?').join(',');
    const existing = query(`SELECT id FROM cameras WHERE id IN (${placeholders})`, unique).map((r) => r.id);
    const set = new Set(existing);
    return unique.filter((id) => set.has(id));
}

function requireName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) { const e = new Error('Nama grup wajib diisi'); e.statusCode = 400; throw e; }
    if (trimmed.length > 80) { const e = new Error('Nama grup maksimal 80 karakter'); e.statusCode = 400; throw e; }
    return trimmed;
}

/** Attach the resolved (still-existing) member cameras to a raw group row. */
function decorate(row) {
    let ids = [];
    try { ids = JSON.parse(row.camera_ids || '[]'); } catch { ids = []; }
    ids = Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n)) : [];
    let cameras = [];
    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = query(
            `SELECT c.id, c.name, a.name AS area_name
             FROM cameras c LEFT JOIN areas a ON a.id = c.area_id
             WHERE c.id IN (${placeholders})`,
            ids,
        );
        const byId = new Map(rows.map((r) => [r.id, r]));
        cameras = ids.map((id) => byId.get(id)).filter(Boolean); // preserve saved order, drop deleted
    }
    return {
        id: row.id,
        name: row.name,
        camera_ids: ids,
        cameras,
        camera_count: cameras.length,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

export function listGroups() {
    return query('SELECT * FROM audio_camera_groups ORDER BY name COLLATE NOCASE ASC').map(decorate);
}

export function createGroup(name, cameraIds, userId = null) {
    const clean = requireName(name);
    const ids = sanitizeCameraIds(cameraIds);
    const info = execute(
        'INSERT INTO audio_camera_groups (name, camera_ids, created_by) VALUES (?, ?, ?)',
        [clean, JSON.stringify(ids), userId],
    );
    return decorate(queryOne('SELECT * FROM audio_camera_groups WHERE id = ?', [info.lastInsertRowid]));
}

export function updateGroup(id, { name, cameraIds } = {}) {
    const gid = parseInt(id, 10);
    const existing = queryOne('SELECT * FROM audio_camera_groups WHERE id = ?', [gid]);
    if (!existing) { const e = new Error('Grup tidak ditemukan'); e.statusCode = 404; throw e; }
    const nextName = name !== undefined ? requireName(name) : existing.name;
    const nextIds = cameraIds !== undefined ? sanitizeCameraIds(cameraIds) : JSON.parse(existing.camera_ids || '[]');
    execute(
        "UPDATE audio_camera_groups SET name = ?, camera_ids = ?, updated_at = datetime('now') WHERE id = ?",
        [nextName, JSON.stringify(nextIds), gid],
    );
    return decorate(queryOne('SELECT * FROM audio_camera_groups WHERE id = ?', [gid]));
}

export function deleteGroup(id) {
    const gid = parseInt(id, 10);
    const existing = queryOne('SELECT id, name FROM audio_camera_groups WHERE id = ?', [gid]);
    if (!existing) { const e = new Error('Grup tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('DELETE FROM audio_camera_groups WHERE id = ?', [gid]);
    return { id: existing.id, name: existing.name };
}

export default { listGroups, createGroup, updateGroup, deleteGroup };
