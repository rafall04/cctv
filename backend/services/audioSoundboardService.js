/*
Purpose: Soundboard for Audio Broadcast — saved one-tap shortcuts (label + source clip/playlist + target
         cameras + loop) an operator fires from a big-button grid. CRUD only; firing a button reuses the
         normal play path (playToCameras + the wide/quiet confirm guard), so no new broadcast logic here.
Caller: audioController (list/create/update/delete buttons).
Deps: connectionPool.
MainFuncs: listButtons, createButton, updateButton, deleteButton.
SideEffects: writes audio_soundboard (parameterized).
*/

import { query, queryOne, execute } from '../database/connectionPool.js';

function sanitizeCameraIds(cameraIds) {
    if (!Array.isArray(cameraIds)) return [];
    return [...new Set(cameraIds.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

function validate({ label, sourceType, sourceId, loop }) {
    const cleanLabel = typeof label === 'string' ? label.trim() : '';
    if (!cleanLabel) { const e = new Error('Label wajib diisi'); e.statusCode = 400; throw e; }
    if (cleanLabel.length > 40) { const e = new Error('Label maksimal 40 karakter'); e.statusCode = 400; throw e; }
    if (!['clip', 'playlist'].includes(sourceType)) { const e = new Error('sourceType harus clip atau playlist'); e.statusCode = 400; throw e; }
    const sid = parseInt(sourceId, 10);
    if (!Number.isInteger(sid) || sid <= 0) { const e = new Error('Sumber tidak valid'); e.statusCode = 400; throw e; }
    const n = Math.min(Math.max(parseInt(loop, 10) || 1, 1), 20);
    return { cleanLabel, sid, n };
}

function decorate(row) {
    let ids = [];
    try { ids = JSON.parse(row.camera_ids || '[]'); } catch { ids = []; }
    return { ...row, camera_ids: Array.isArray(ids) ? ids : [] };
}

export function listButtons() {
    return query('SELECT * FROM audio_soundboard ORDER BY sort_order ASC, id ASC').map(decorate);
}

export function createButton({ label, color, sourceType, sourceId, cameraIds, loop, userId = null }) {
    const { cleanLabel, sid, n } = validate({ label, sourceType, sourceId, loop });
    const info = execute(
        `INSERT INTO audio_soundboard (label, color, source_type, source_id, camera_ids, loop, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM audio_soundboard), ?)`,
        [cleanLabel, color ? String(color).slice(0, 20) : null, sourceType, sid, JSON.stringify(sanitizeCameraIds(cameraIds)), n, userId],
    );
    return decorate(queryOne('SELECT * FROM audio_soundboard WHERE id = ?', [info.lastInsertRowid]));
}

export function updateButton(id, { label, color, sourceType, sourceId, cameraIds, loop } = {}) {
    const bid = parseInt(id, 10);
    const existing = queryOne('SELECT * FROM audio_soundboard WHERE id = ?', [bid]);
    if (!existing) { const e = new Error('Tombol tidak ditemukan'); e.statusCode = 404; throw e; }
    const merged = {
        label: label !== undefined ? label : existing.label,
        sourceType: sourceType !== undefined ? sourceType : existing.source_type,
        sourceId: sourceId !== undefined ? sourceId : existing.source_id,
        loop: loop !== undefined ? loop : existing.loop,
    };
    const { cleanLabel, sid, n } = validate(merged);
    const nextColor = color !== undefined ? (color ? String(color).slice(0, 20) : null) : existing.color;
    const nextIds = cameraIds !== undefined ? sanitizeCameraIds(cameraIds) : JSON.parse(existing.camera_ids || '[]');
    execute(
        'UPDATE audio_soundboard SET label = ?, color = ?, source_type = ?, source_id = ?, camera_ids = ?, loop = ? WHERE id = ?',
        [cleanLabel, nextColor, merged.sourceType, sid, JSON.stringify(nextIds), n, bid],
    );
    return decorate(queryOne('SELECT * FROM audio_soundboard WHERE id = ?', [bid]));
}

export function deleteButton(id) {
    const bid = parseInt(id, 10);
    const existing = queryOne('SELECT id, label FROM audio_soundboard WHERE id = ?', [bid]);
    if (!existing) { const e = new Error('Tombol tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('DELETE FROM audio_soundboard WHERE id = ?', [bid]);
    return { id: existing.id, label: existing.label };
}

export default { listButtons, createButton, updateButton, deleteButton };
