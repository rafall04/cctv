/*
Purpose: Announcement templates for Audio Broadcast — a small library of fill-in-the-blank scripts
         ("{nama}" placeholders) an operator turns into speech via TTS or reads over live talk. CRUD only;
         placeholder substitution happens in the UI (pure text), so the server just stores/serves templates.
Caller: audioController (list/create/update/delete templates).
Deps: connectionPool.
MainFuncs: listTemplates, createTemplate, updateTemplate, deleteTemplate.
SideEffects: writes audio_templates (parameterized).
*/

import { query, queryOne, execute } from '../database/connectionPool.js';

const MAX_BODY = 1500; // matches the TTS char cap — a template must fit in one synth

function requireField(value, label, max) {
    const t = typeof value === 'string' ? value.trim() : '';
    if (!t) { const e = new Error(`${label} wajib diisi`); e.statusCode = 400; throw e; }
    if (t.length > max) { const e = new Error(`${label} melebihi ${max} karakter`); e.statusCode = 400; throw e; }
    return t;
}

export function listTemplates() {
    return query('SELECT id, name, category, body, created_at FROM audio_templates ORDER BY category IS NULL, category COLLATE NOCASE, name COLLATE NOCASE');
}

export function createTemplate({ name, category, body, userId = null }) {
    const cleanName = requireField(name, 'Nama template', 80);
    const cleanBody = requireField(body, 'Isi template', MAX_BODY);
    const cleanCat = typeof category === 'string' && category.trim() ? category.trim().slice(0, 40) : null;
    const info = execute('INSERT INTO audio_templates (name, category, body, created_by) VALUES (?, ?, ?, ?)',
        [cleanName, cleanCat, cleanBody, userId]);
    return queryOne('SELECT id, name, category, body, created_at FROM audio_templates WHERE id = ?', [info.lastInsertRowid]);
}

export function updateTemplate(id, { name, category, body } = {}) {
    const tid = parseInt(id, 10);
    const existing = queryOne('SELECT * FROM audio_templates WHERE id = ?', [tid]);
    if (!existing) { const e = new Error('Template tidak ditemukan'); e.statusCode = 404; throw e; }
    const nextName = name !== undefined ? requireField(name, 'Nama template', 80) : existing.name;
    const nextBody = body !== undefined ? requireField(body, 'Isi template', MAX_BODY) : existing.body;
    const nextCat = category !== undefined
        ? (typeof category === 'string' && category.trim() ? category.trim().slice(0, 40) : null)
        : existing.category;
    execute('UPDATE audio_templates SET name = ?, category = ?, body = ? WHERE id = ?', [nextName, nextCat, nextBody, tid]);
    return queryOne('SELECT id, name, category, body, created_at FROM audio_templates WHERE id = ?', [tid]);
}

export function deleteTemplate(id) {
    const tid = parseInt(id, 10);
    const existing = queryOne('SELECT id, name FROM audio_templates WHERE id = ?', [tid]);
    if (!existing) { const e = new Error('Template tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('DELETE FROM audio_templates WHERE id = ?', [tid]);
    return { id: existing.id, name: existing.name };
}

export default { listTemplates, createTemplate, updateTemplate, deleteTemplate };
