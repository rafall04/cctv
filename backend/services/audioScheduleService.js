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
import { enabledDeviceIdsForCameras, castToDevices } from './audioDeviceService.js';
import { getAppOffsetMinutes } from './timezoneService.js';
import { quietTargets } from './audioTargetService.js';
import { logPlay } from './audioHistoryService.js';
import { alertBroadcastResult } from './audioAlertService.js';

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Wall-clock parts in the app's configured timezone. Historically this was a hard +7 (WIB); it now follows
// the app timezone so a WITA/WIT deployment fires at the right local minute. getAppOffsetMinutes falls back
// to +7 on any error, so a WIB box is unchanged.
function localParts(nowMs = Date.now()) {
    const d = new Date(nowMs + getAppOffsetMinutes(nowMs) * 60000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return { hhmm: `${hh}:${mm}`, dayBit: 1 << d.getUTCDay(), dateKey, minuteKey: `${dateKey} ${hh}:${mm}` };
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function normDate(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (!DATE_RE.test(s)) { const e = new Error('Tanggal harus format YYYY-MM-DD'); e.statusCode = 400; throw e; }
    return s;
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
        out.camera_ids = JSON.stringify([...new Set(ids)]);
    }
    // Explicit Titik Speaker (STB) targets — additive to the area's own devices. A schedule may target
    // cameras, devices, or both.
    if (!partial || f.deviceIds !== undefined) {
        const dids = (f.deviceIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
        out.device_ids = JSON.stringify([...new Set(dids)]);
    }
    if (!partial) { // CREATE: require at least one target (camera OR device)
        const nCam = JSON.parse(out.camera_ids || '[]').length;
        const nDev = JSON.parse(out.device_ids || '[]').length;
        if (nCam + nDev === 0) { const e = new Error('Pilih minimal satu kamera atau titik speaker'); e.statusCode = 400; throw e; }
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
    if (f.gainDb !== undefined) out.gain_db = Math.max(-24, Math.min(24, Number(f.gainDb) || 0));
    if (!partial || f.scheduleKind !== undefined) {
        out.schedule_kind = f.scheduleKind || 'recurring';
        if (!['recurring', 'once', 'range'].includes(out.schedule_kind)) {
            const e = new Error('Jenis jadwal harus recurring/once/range'); e.statusCode = 400; throw e;
        }
    }
    if (f.runDate !== undefined) out.run_date = normDate(f.runDate);
    if (f.startDate !== undefined) out.start_date = normDate(f.startDate);
    if (f.endDate !== undefined) out.end_date = normDate(f.endDate);
    // Cross-field rules on CREATE: clear the columns a kind doesn't use so a switch can't leave stale dates.
    if (!partial) {
        const kind = out.schedule_kind || 'recurring';
        if (kind === 'once') {
            if (!out.run_date) { const e = new Error('Tanggal wajib untuk jadwal sekali-jalan'); e.statusCode = 400; throw e; }
            out.start_date = null; out.end_date = null;
        } else if (kind === 'range') {
            if (!out.start_date && !out.end_date) { const e = new Error('Isi minimal tanggal mulai atau selesai'); e.statusCode = 400; throw e; }
            if (out.start_date && out.end_date && out.start_date > out.end_date) {
                const e = new Error('Tanggal mulai tidak boleh setelah tanggal selesai'); e.statusCode = 400; throw e;
            }
            out.run_date = null;
        } else {
            out.run_date = null; out.start_date = null; out.end_date = null;
        }
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
    `).map((s) => ({ ...s, camera_ids: parseCameraIds(s.camera_ids), device_ids: parseCameraIds(s.device_ids) }));
}

export function createSchedule(fields) {
    const v = validate(fields, false);
    // Use the INSERT's own lastInsertRowid — `last_insert_rowid()` via queryOne routes to a readonly
    // pool connection (returns 0), which would read back id=0 → undefined.
    const info = execute(`INSERT INTO audio_schedules
             (name, camera_ids, device_ids, source_type, source_id, time_hhmm, days_mask, loop_count, enabled,
              schedule_kind, run_date, start_date, end_date, gain_db)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.name, v.camera_ids, v.device_ids ?? '[]', v.source_type, v.source_id, v.time_hhmm, v.days_mask, v.loop_count, v.enabled ?? 1,
            v.schedule_kind ?? 'recurring', v.run_date ?? null, v.start_date ?? null, v.end_date ?? null, v.gain_db ?? 0]);
    return queryOne('SELECT * FROM audio_schedules WHERE id = ?', [info.lastInsertRowid]);
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

/**
 * Is this schedule due on the given WIB day? Evaluated per kind:
 *  - once:      exactly on run_date (days_mask ignored). A missed 'once' (box down) is DROPPED, never
 *               fired at a random later time — dateKey only ever moves forward.
 *  - range:     recurring weekly, but only while start_date <= today <= end_date (inclusive; either open).
 *  - recurring: the original weekly weekday-mask behaviour. Legacy rows (kind NULL) fall here.
 */
function dueOnDay(s, dateKey, dayBit) {
    const kind = s.schedule_kind || 'recurring';
    if (kind === 'once') return s.run_date === dateKey;
    if (kind === 'range') {
        const afterStart = !s.start_date || dateKey >= s.start_date;
        const beforeEnd = !s.end_date || dateKey <= s.end_date;
        return afterStart && beforeEnd && Boolean(s.days_mask & dayBit);
    }
    return Boolean(s.days_mask & dayBit);
}

/** One scheduler tick: fire any enabled schedule due this local minute (guarded against double-firing). */
export function runDueSchedules(nowMs = Date.now()) {
    const { hhmm, dayBit, dateKey, minuteKey } = localParts(nowMs);
    const due = query('SELECT * FROM audio_schedules WHERE enabled = 1 AND time_hhmm = ?', [hhmm])
        .filter((s) => s.last_run_at !== minuteKey && dueOnDay(s, dateKey, dayBit));
    for (const s of due) {
        // Claim BEFORE firing. A 'once' also self-disables so it can never fire on another day.
        if ((s.schedule_kind || 'recurring') === 'once') {
            execute('UPDATE audio_schedules SET last_run_at = ?, enabled = 0 WHERE id = ?', [minuteKey, s.id]);
        } else {
            execute('UPDATE audio_schedules SET last_run_at = ? WHERE id = ?', [minuteKey, s.id]);
        }
        const cams = parseCameraIds(s.camera_ids);
        const explicitDev = parseCameraIds(s.device_ids);
        // Honour the SAME per-area quiet hours a manual play must confirm past: a scheduled blast at 23:00
        // into an area whose quiet window is 22:00–05:00 must NOT fire there. Fail-OPEN — if the quiet
        // lookup errors (e.g. tables absent in a unit env) we broadcast rather than silently drop.
        let quietSkip = new Set();
        try { quietSkip = new Set(quietTargets(cams, nowMs).map((c) => c.id)); } catch { /* no quiet gate */ }
        const active = cams.filter((id) => !quietSkip.has(id));
        // Titik Speaker targets: area-derived (from the quiet-filtered cameras) UNION the schedule's explicit
        // device_ids (explicit ones fire regardless of camera quiet). Clip or playlist. Fire-and-forget,
        // isolated — this fires even when there are no cameras (a device-only schedule) or all are quiet.
        const deviceTargets = [...new Set([...enabledDeviceIdsForCameras(active), ...explicitDev])];
        let dn = 0;
        try { dn = castToDevices(deviceTargets, s.source_type, s.source_id, s.loop_count, {}); }
        catch (e) { console.error(`[Audio] Schedule "${s.name}" titik speaker gagal:`, e.message); }
        if (active.length === 0) {
            console.log(`[Audio] Schedule "${s.name}" ${hhmm}: ${cams.length ? `semua ${cams.length} kamera jam tenang` : 'tanpa kamera'}${dn ? ` — ${dn} titik speaker` : ' — dilewati'}`);
            continue;
        }
        const skipped = cams.length - active.length;
        console.log(`[Audio] Schedule "${s.name}" fired ${hhmm} -> ${active.length} kamera${skipped ? ` (${skipped} dilewati: jam tenang)` : ''}${dn ? ` + ${dn} titik speaker` : ''}`);
        // Area-disabled cameras are dropped inside playToCameras (enforceAreaScope default), so a schedule
        // whose area was later turned off stops sounding there without needing to be edited.
        playToCameras(active, s.source_type, s.source_id, s.loop_count, { gainDb: s.gain_db })
            .then((r) => {
                // Drop cameras that weren't targets (area later turned off -> `skipped`), so a schedule whose
                // whole area is disabled doesn't log a phantom receipt or fire a false "GAGAL 0/N" alert.
                const targeted = r.results.filter((x) => !x.skipped);
                if (targeted.length === 0) {
                    console.log(`[Audio] Schedule "${s.name}": semua kamera area nonaktif — tak ada target`);
                    return;
                }
                const ok = targeted.filter((x) => x.ok).length;
                console.log(`[Audio] Schedule "${s.name}": ${ok}/${targeted.length} kamera OK`);
                // Scheduled broadcasts left NO trace before — the most routine, least-watched path. Record a
                // receipt like every other play, and alert if it reached nobody.
                logPlay({ sourceType: s.source_type, sourceId: s.source_id, sourceName: `JADWAL: ${s.name}`, cameraIds: targeted.map((x) => x.cameraId), results: targeted, operatorName: 'jadwal' });
                alertBroadcastResult({ label: `Jadwal "${s.name}"`, okCount: ok, total: targeted.length });
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
    console.log('[Audio] Broadcast scheduler started (30s tick, zona app)');
    return t;
}

export default { listSchedules, createSchedule, updateSchedule, deleteSchedule, setEnabled, runDueSchedules, startScheduler };
