/*
Purpose: Automatic Adzan — reads the prayer config, computes today's prayer times locally (prayerTimeService,
         no external API), and on the primary-worker tick fires the adzan clip at each enabled prayer,
         BYPASSING quiet hours (adzan is whitelisted). Also serves config + a "today's times" preview so the
         operator verifies against their local Kemenag schedule before enabling.
Caller: audioController (config + preview), audioBroadcastBootstrap (startPrayerScheduler).
Deps: connectionPool, prayerTimeService, audioTargetService.listBroadcastTargets, audioCastService.playToCameras,
      audioClipService.getClip, audioHistoryService.logPlay.
MainFuncs: getConfig, setConfig, todayTimes, runDuePrayer, startPrayerScheduler.
SideEffects: writes audio_prayer_config; spawns adzan broadcasts on a due minute.
*/

import { queryOne, execute } from '../database/connectionPool.js';
import { computePrayerTimes } from './prayerTimeService.js';
import { listBroadcastTargets } from './audioTargetService.js';
import { playToCameras } from './audioCastService.js';
import { getClip } from './audioClipService.js';
import { logPlay } from './audioHistoryService.js';

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const LABELS = { fajr: 'Subuh', dhuhr: 'Dzuhur', asr: 'Ashar', maghrib: 'Maghrib', isha: 'Isya' };

/**
 * Pure: "HH:MM" minus `lead` minutes → "HH:MM", wrapping around midnight. Returns null for a malformed
 * time. This is the qori (pre-adzan murottal) trigger-time math — kept pure so the precision is unit-locked.
 */
export function minutesBefore(hhmm, lead) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return null;
    const total = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) - (parseInt(lead, 10) || 0);
    const wrapped = ((total % 1440) + 1440) % 1440;
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(Math.floor(wrapped / 60))}:${p2(wrapped % 60)}`;
}

// Local wall-clock at a given UTC offset (tz hours). Prod Node runs in UTC, so we derive the location's
// local date + HH:MM by shifting. tz MUST match the prayer config's timezone (WIB 7 / WITA 8 / WIT 9) —
// using a fixed +7 made non-WIB locations fire an hour off and roll the date wrong near midnight.
function localNow(nowMs = Date.now(), tz = 7) {
    const w = new Date(nowMs + tz * 3600 * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    return {
        year: w.getUTCFullYear(), month: w.getUTCMonth() + 1, day: w.getUTCDate(),
        hhmm: `${p2(w.getUTCHours())}:${p2(w.getUTCMinutes())}`,
        dateKey: `${w.getUTCFullYear()}-${p2(w.getUTCMonth() + 1)}-${p2(w.getUTCDate())}`,
        weekday: w.getUTCDay(), // 0=Minggu … 5=Jumat
    };
}

function decorate(row) {
    let ids = [];
    try { ids = JSON.parse(row.camera_ids || '[]'); } catch { ids = []; }
    return { ...row, camera_ids: Array.isArray(ids) ? ids : [] };
}

export function getConfig() {
    let row = queryOne('SELECT * FROM audio_prayer_config WHERE id = 1');
    if (!row) { execute('INSERT OR IGNORE INTO audio_prayer_config (id) VALUES (1)'); row = queryOne('SELECT * FROM audio_prayer_config WHERE id = 1'); }
    return decorate(row);
}

const numOr = (v, def, lo, hi) => {
    if (v === undefined || v === null || v === '') return def;
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(Math.max(n, lo), hi);
};

export function setConfig(fields = {}) {
    const cur = getConfig();
    const f = { ...cur, ...fields };
    const camIds = Array.isArray(fields.camera_ids)
        ? [...new Set(fields.camera_ids.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0))]
        : cur.camera_ids;
    execute(
        `UPDATE audio_prayer_config SET
            enabled=?, latitude=?, longitude=?, timezone=?, elevation=?, fajr_angle=?, isha_angle=?, asr_factor=?, ikhtiyati=?,
            offset_fajr=?, offset_dhuhr=?, offset_asr=?, offset_maghrib=?, offset_isha=?,
            enable_fajr=?, enable_dhuhr=?, enable_asr=?, enable_maghrib=?, enable_isha=?,
            clip_id=?, clip_id_fajr=?, target_kind=?, area_id=?, camera_ids=?, loop=?, gain_db=?,
            qori_enabled=?, qori_clip_id=?, qori_clip_id_fajr=?, qori_loop=?,
            qori_lead_fajr=?, qori_lead_dhuhr=?, qori_lead_asr=?, qori_lead_maghrib=?, qori_lead_isha=?,
            jumat_dhuhr_mode=?, jumat_dhuhr_clip_id=?, imsak_offset=?
         WHERE id = 1`,
        [
            fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : cur.enabled,
            numOr(f.latitude, cur.latitude, -90, 90), numOr(f.longitude, cur.longitude, -180, 180),
            numOr(f.timezone, cur.timezone ?? 7, 5, 10), numOr(f.elevation, cur.elevation, -500, 9000),
            numOr(f.fajr_angle, cur.fajr_angle, 10, 25), numOr(f.isha_angle, cur.isha_angle, 10, 25), numOr(f.asr_factor, cur.asr_factor, 1, 2),
            Math.round(numOr(f.ikhtiyati, cur.ikhtiyati, 0, 30)),
            Math.round(numOr(f.offset_fajr, cur.offset_fajr, -60, 60)), Math.round(numOr(f.offset_dhuhr, cur.offset_dhuhr, -60, 60)),
            Math.round(numOr(f.offset_asr, cur.offset_asr, -60, 60)), Math.round(numOr(f.offset_maghrib, cur.offset_maghrib, -60, 60)),
            Math.round(numOr(f.offset_isha, cur.offset_isha, -60, 60)),
            f.enable_fajr ? 1 : 0, f.enable_dhuhr ? 1 : 0, f.enable_asr ? 1 : 0, f.enable_maghrib ? 1 : 0, f.enable_isha ? 1 : 0,
            fields.clip_id !== undefined ? (parseInt(fields.clip_id, 10) || null) : cur.clip_id,
            fields.clip_id_fajr !== undefined ? (parseInt(fields.clip_id_fajr, 10) || null) : cur.clip_id_fajr,
            f.target_kind === 'cameras' ? 'cameras' : 'area',
            fields.area_id !== undefined ? (parseInt(fields.area_id, 10) || null) : cur.area_id,
            JSON.stringify(camIds), Math.round(numOr(f.loop, cur.loop, 1, 20)),
            numOr(f.gain_db, cur.gain_db, -24, 24),
            // Qori (murottal before adzan)
            fields.qori_enabled !== undefined ? (fields.qori_enabled ? 1 : 0) : (cur.qori_enabled ?? 0),
            fields.qori_clip_id !== undefined ? (parseInt(fields.qori_clip_id, 10) || null) : (cur.qori_clip_id ?? null),
            fields.qori_clip_id_fajr !== undefined ? (parseInt(fields.qori_clip_id_fajr, 10) || null) : (cur.qori_clip_id_fajr ?? null),
            Math.round(numOr(f.qori_loop, cur.qori_loop ?? 1, 1, 20)),
            Math.round(numOr(f.qori_lead_fajr, cur.qori_lead_fajr ?? 10, 0, 120)),
            Math.round(numOr(f.qori_lead_dhuhr, cur.qori_lead_dhuhr ?? 10, 0, 120)),
            Math.round(numOr(f.qori_lead_asr, cur.qori_lead_asr ?? 10, 0, 120)),
            Math.round(numOr(f.qori_lead_maghrib, cur.qori_lead_maghrib ?? 10, 0, 120)),
            Math.round(numOr(f.qori_lead_isha, cur.qori_lead_isha ?? 10, 0, 120)),
            // Jumat Dzuhur + Imsak
            ['normal', 'skip', 'custom'].includes(f.jumat_dhuhr_mode) ? f.jumat_dhuhr_mode : (cur.jumat_dhuhr_mode || 'normal'),
            fields.jumat_dhuhr_clip_id !== undefined ? (parseInt(fields.jumat_dhuhr_clip_id, 10) || null) : (cur.jumat_dhuhr_clip_id ?? null),
            Math.round(numOr(f.imsak_offset, cur.imsak_offset ?? 10, 0, 60)),
        ],
    );
    return getConfig();
}

function cfgToParams(cfg) {
    return {
        lat: cfg.latitude, lon: cfg.longitude, tz: cfg.timezone ?? 7,
        fajrAngle: cfg.fajr_angle, ishaAngle: cfg.isha_angle, asrFactor: cfg.asr_factor,
        ikhtiyati: cfg.ikhtiyati,
        offsets: { fajr: cfg.offset_fajr, dhuhr: cfg.offset_dhuhr, asr: cfg.offset_asr, maghrib: cfg.offset_maghrib, isha: cfg.offset_isha },
    };
}

// The location is unset when both lat & lon are 0 (the migration default). Computing with 0,0 yields
// times ~7h off (the longitude correction is missing), so we must never fire adzan in that state.
function hasValidLocation(cfg) {
    const lat = Number(cfg.latitude);
    const lon = Number(cfg.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
}

/**
 * Today's computed prayer times + which are enabled, for the preview + scheduler.
 * `overrides` (optional) lets the UI PREVIEW an edited-but-unsaved location/params so the operator sees
 * the times update the instant they pick a kabupaten — without saving first. The stored config is used
 * for anything not overridden, and `cfg` returned is always the stored row (unchanged).
 */
export function todayTimes(nowMs = Date.now(), overrides = null) {
    const cfg = getConfig();
    const eff = overrides && typeof overrides === 'object' ? { ...cfg, ...overrides } : cfg;
    const now = localNow(nowMs, Number(eff.timezone ?? 7));
    const times = computePrayerTimes({ year: now.year, month: now.month, day: now.day }, cfgToParams(eff));
    // Imsak = Subuh − imsak_offset (for matching the Kemenag jadwal + a future Ramadan announce). Syuruq
    // (times.sunrise) is already computed. minutesBefore returns null if fajr is uncomputable.
    times.imsak = minutesBefore(times.fajr, Math.round(numOr(eff.imsak_offset, 10, 0, 60)));
    // Tell the UI when the (effective) location is still unset so it can warn instead of showing wrong times.
    return { date: now.dateKey, times, cfg, locationSet: hasValidLocation(eff) };
}

function resolveTargets(cfg) {
    const supported = listBroadcastTargets({ includeUnknown: false });
    if ((cfg.target_kind || 'area') === 'area') {
        return supported.filter((t) => t.area_id === cfg.area_id).map((t) => t.id);
    }
    const set = new Set(cfg.camera_ids);
    return supported.filter((t) => set.has(t.id)).map((t) => t.id);
}

/** Per-prayer qori lead (minutes before adzan). 0 = no qori for that prayer. */
function qoriLead(cfg, p) {
    return Math.round(numOr(cfg[`qori_lead_${p}`], 0, 0, 120));
}

/**
 * Resolve targets + play one prayer clip. `preempt` = adzan (takes over from a still-playing qori, and
 * bypasses the busy/governor check so the call to prayer reliably sounds); qori runs in normal mode so a
 * later adzan/emergency/manual can displace it. Both bypass quiet hours (not routed through the controller).
 */
async function playPrayerClip(cfg, clipId, loop, { preempt, label, operator }) {
    const ids = resolveTargets(cfg);
    if (ids.length === 0) { console.warn(`[${label}] due but no supported target camera`); return; }
    try {
        const { results } = await playToCameras(ids, 'clip', clipId, loop || 1, { gainDb: cfg.gain_db, preempt });
        const name = getClip(clipId)?.name;
        logPlay({ sourceType: 'clip', sourceId: clipId, sourceName: `${label}: ${name || ''}`.trim(), cameraIds: ids, results, operatorName: operator });
        const ok = results.filter((r) => r.ok).length;
        console.log(`[${label}] -> ${ok}/${results.length} kamera`);
    } catch (e) {
        console.error(`[${label}] play error:`, e.message);
    }
}

/**
 * One prayer tick: for each enabled prayer, play the QORI (murottal) at `qori_lead` minutes before its
 * time, then the ADZAN at its time. Both are once-per-day guarded (last_qori / last_fired). Iterates ALL
 * prayers (no early return) so a qori for one prayer and an adzan for another in the same minute both fire.
 */
export async function runDuePrayer(nowMs = Date.now()) {
    const cfg = getConfig();
    if (!cfg.enabled) return false;
    // Never broadcast at a wrong time: if the location was never set (lat=lon=0), the computed times are
    // ~7h off. Skip loudly rather than blast the mosque call (or qori) at the wrong hour.
    if (!hasValidLocation(cfg)) { console.warn('[Adzan] enabled but location unset (lat=lon=0) — skipping; set kabupaten/koordinat first'); return false; }
    const now = localNow(nowMs, Number(cfg.timezone ?? 7));
    const { times } = todayTimes(nowMs);
    let fired = false;
    for (const p of PRAYERS) {
        if (!cfg[`enable_${p}`]) continue;
        const prayerHHMM = times[p];
        if (!prayerHHMM) continue;

        // Qori/murottal BEFORE the adzan (normal mode — yields to the adzan that follows).
        if (cfg.qori_enabled) {
            const lead = qoriLead(cfg, p);
            const qClip = (p === 'fajr' && cfg.qori_clip_id_fajr) ? cfg.qori_clip_id_fajr : cfg.qori_clip_id;
            if (lead > 0 && qClip && minutesBefore(prayerHHMM, lead) === now.hhmm) {
                const qKey = `${now.dateKey} ${p}`;
                if (cfg.last_qori !== qKey) {
                    execute('UPDATE audio_prayer_config SET last_qori = ? WHERE id = 1', [qKey]);
                    // eslint-disable-next-line no-await-in-loop
                    await playPrayerClip(cfg, qClip, cfg.qori_loop, { preempt: false, label: `Qori ${LABELS[p]} ${now.hhmm}`, operator: 'jadwal-qori' });
                    fired = true;
                }
            }
        }

        // Adzan at the prayer minute — PREEMPTS so it cleanly takes over from a still-playing qori.
        if (prayerHHMM === now.hhmm) {
            const key = `${now.dateKey} ${p}`;
            if (cfg.last_fired !== key) {
                // Resolve the adzan clip (per-prayer), with Friday-Dzuhur handling. null = no adzan (either
                // qori-only mode, or Friday 'skip' because the mosque calls the Jumat adzan live).
                let adzanClipId = (p === 'fajr' && cfg.clip_id_fajr) ? cfg.clip_id_fajr : cfg.clip_id;
                const isJumatDhuhr = p === 'dhuhr' && now.weekday === 5;
                if (isJumatDhuhr) {
                    const mode = cfg.jumat_dhuhr_mode || 'normal';
                    if (mode === 'skip') adzanClipId = null;
                    else if (mode === 'custom') adzanClipId = cfg.jumat_dhuhr_clip_id || adzanClipId;
                }
                if (adzanClipId) {
                    execute('UPDATE audio_prayer_config SET last_fired = ? WHERE id = 1', [key]);
                    // eslint-disable-next-line no-await-in-loop
                    await playPrayerClip(cfg, adzanClipId, cfg.loop, { preempt: true, label: `Adzan ${LABELS[p]}${isJumatDhuhr ? ' (Jumat)' : ''} ${times[p]}`, operator: 'jadwal-adzan' });
                    fired = true;
                }
            }
        }
    }
    return fired;
}

export function startPrayerScheduler() {
    const t = setInterval(() => {
        runDuePrayer().catch((e) => console.error('[Adzan] tick error:', e.message));
    }, 30000);
    if (t.unref) t.unref();
    console.log('[Adzan] Prayer scheduler started (30s tick, WIB)');
    return t;
}

export default { getConfig, setConfig, todayTimes, runDuePrayer, startPrayerScheduler };
