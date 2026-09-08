/*
Purpose: Schedule audio broadcasts (a clip or playlist to camera(s) at a WIB time on chosen weekdays)
         and fire them. The scheduling brain of the Audio Broadcast feature.
Caller: audioController (CRUD), server.js boot (startScheduler).
Deps: connectionPool, audioCastService (playToCameras).
MainFuncs: listSchedules, createSchedule, updateSchedule, deleteSchedule, setEnabled, runDueSchedules,
           startScheduler.
SideEffects: writes audio_schedules; on a due tick, spawns broadcasts via audioCastService.

TIME MODEL: time_hhmm is WIB (UTC+7) wall-clock and days_mask is a 7-bit weekday mask (bit0=Sunday).
Prod Node runs in UTC, so we derive WIB from Date.now()+7h — WIB has no DST, so a fixed offset is exact.
The tick runs every 30s; last_run_at (a WIB 'YYYY-MM-DD HH:MM' key) stops a schedule firing twice in
the same minute while still letting it fire again the next day.
*/

import { query, queryOne, execute } from '../database/connectionPool.js';
import { playToCameras } from './audioCastService.js';

const WIB_OFFSET_MS = 7 * 3600 * 1000;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function wibParts(nowMs = Date.now()) {
    const d = new Date(nowMs + WIB_OFFSET_MS);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return { hhmm: `${hh}:${mm}`, dayBit: 1 << d.getUTCDay(), minuteKey: `${dateKey} ${hh}:${mm}` };
}

function parseCameraIds(raw) {
    try {
        const a = JSON.parse(raw || '[]');
        return Array.isArray(a) ? a.map((x) => parseInt(x, 10)).filter(Number.isInteger) : [];
    } catch { return []; }
}

function validate(f, partial = false) {
    const out = {};
    if (!partial || f.name !== undefined) {
        out.name = String(f.name || '').trim().slice(0, 120);
        if (!out.name) { const e = new Error('Nama jadwal wajib diisi'); e.statusCode = 400; throw e; }
    }
    if (!partial || f.timeHHmm !== undefined) {
        out.time_hhmm = String(f.timeHHmm || '');
        if (!HHMM_RE.test(out.time_hhmm)) { const e = new Error('Format jam harus HH:MM (24 jam)'); e.statusCode = 400; throw e; }
    }
    if (!partial || f.sourceType !== undefined) {
        out.source_type = f.sourceType;
        if (!['clip', 'playlist'].includes(out.source_type)) { const e = new Error('sourceType harus clip atau playlist'); e.statusCode = 400; throw e; }
    }
    if (!partial || f.sourceId !== undefined) {
        out.source_id = parseInt(f.sourceId, 10);
        if (!Number.isInteger(out.source_id)) { const e = new Error('sourceId tidak valid'); e.statusCode = 400; throw e; }
    }
    if (!partial || f.cameraIds !== undefined) {
        const ids = (f.cameraIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
        if (ids.length === 0) { const e = new Error('Pilih minimal satu kamera'); e.statusCode = 400; throw e; }
        out.camera_ids = JSON.stringify([...new Set(ids)]);
    }
    if (!partial || f.daysMask !== undefined) {
        let d = parseInt(f.daysMask, 10);
        if (!Number.isInteger(d) || d < 1 || d > 127) d = 127;
        out.days_mask = d;
    }
    if (!partial || f.loopCount !== undefined) {
        let l = parseInt(f.loopCount, 10);
        if (!Number.isInteger(l) || l < 1) l = 1;
        out.loop_count = Math.min(l, 20);
    }
    if (f.enabled !== undefined) out.enabled = f.enabled === true || f.enabled === 1 || f.enabled === '1' ? 1 : 0;
    return out;
}

export function listSchedules() {
    return query(`
        SELECT s.*,
            CASE WHEN s.source_type = 'clip'
                THEN (SELECT name FROM audio_clips WHERE id = s.source_id)
                ELSE (SELECT name FROM audio_playlists WHERE id = s.source_id) END AS source_name
        FROM audio_schedules s ORDER BY s.time_hhmm ASC, s.id ASC
    `).map((s) => ({ ...s, camera_ids: parseCameraIds(s.camera_ids) }));
}

export function createSchedule(fields) {
    const v = validate(fields, false);
    execute(`INSERT INTO audio_schedules (name, camera_ids, source_type, source_id, time_hhmm, days_mask, loop_count, enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.name, v.camera_ids, v.source_type, v.source_id, v.time_hhmm, v.days_mask, v.loop_count, v.enabled ?? 1]);
    const id = queryOne('SELECT last_insert_rowid() AS id').id;
    return queryOne('SELECT * FROM audio_schedules WHERE id = ?', [id]);
}

export function updateSchedule(id, fields) {
    const row = queryOne('SELECT id FROM audio_schedules WHERE id = ?', [parseInt(id, 10)]);
    if (!row) { const e = new Error('Jadwal tidak ditemukan'); e.statusCode = 404; throw e; }
    const v = validate(fields, true);
    const keys = Object.keys(v);
    if (keys.length) {
        execute(`UPDATE audio_schedules SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
            [...keys.map((k) => v[k]), row.id]);
    }
    return queryOne('SELECT * FROM audio_schedules WHERE id = ?', [row.id]);
}

export function setEnabled(id, enabled) {
    const row = queryOne('SELECT id FROM audio_schedules WHERE id = ?', [parseInt(id, 10)]);
    if (!row) { const e = new Error('Jadwal tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('UPDATE audio_schedules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, row.id]);
    return queryOne('SELECT * FROM audio_schedules WHERE id = ?', [row.id]);
}

export function deleteSchedule(id) {
    const row = queryOne('SELECT id FROM audio_schedules WHERE id = ?', [parseInt(id, 10)]);
    if (!row) { const e = new Error('Jadwal tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('DELETE FROM audio_schedules WHERE id = ?', [row.id]);
    return { deleted: row.id };
}

/** One scheduler tick: fire any enabled schedule due this WIB minute (guarded against double-firing). */
export function runDueSchedules(nowMs = Date.now()) {
    const { hhmm, dayBit, minuteKey } = wibParts(nowMs);
    const due = query('SELECT * FROM audio_schedules WHERE enabled = 1 AND time_hhmm = ?', [hhmm])
        .filter((s) => (s.days_mask & dayBit) && s.last_run_at !== minuteKey);
    for (const s of due) {
        execute('UPDATE audio_schedules SET last_run_at = ? WHERE id = ?', [minuteKey, s.id]); // claim BEFORE firing
        const cams = parseCameraIds(s.camera_ids);
        console.log(`[Audio] Schedule "${s.name}" fired ${hhmm} WIB -> ${cams.length} kamera`);
        playToCameras(cams, s.source_type, s.source_id, s.loop_count)
            .then((r) => {
                const ok = r.results.filter((x) => x.ok).length;
                console.log(`[Audio] Schedule "${s.name}": ${ok}/${r.results.length} kamera OK`);
            })
            .catch((e) => console.error(`[Audio] Schedule "${s.name}" gagal:`, e.message));
    }
    return due.length;
}

export function startScheduler() {
    const t = setInterval(() => {
        try { runDueSchedules(); } catch (e) { console.error('[Audio] Scheduler tick error:', e.message); }
    }, 30000);
    if (t.unref) t.unref();
    console.log('[Audio] Broadcast scheduler started (30s tick, WIB)');
    return t;
}

export default { listSchedules, createSchedule, updateSchedule, deleteSchedule, setEnabled, runDueSchedules, startScheduler };
