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

function wibNow(nowMs = Date.now()) {
    const w = new Date(nowMs + 7 * 3600 * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    return {
        year: w.getUTCFullYear(), month: w.getUTCMonth() + 1, day: w.getUTCDate(),
        hhmm: `${p2(w.getUTCHours())}:${p2(w.getUTCMinutes())}`,
        dateKey: `${w.getUTCFullYear()}-${p2(w.getUTCMonth() + 1)}-${p2(w.getUTCDate())}`,
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
            enabled=?, latitude=?, longitude=?, elevation=?, fajr_angle=?, isha_angle=?, asr_factor=?, ikhtiyati=?,
            offset_fajr=?, offset_dhuhr=?, offset_asr=?, offset_maghrib=?, offset_isha=?,
            enable_fajr=?, enable_dhuhr=?, enable_asr=?, enable_maghrib=?, enable_isha=?,
            clip_id=?, clip_id_fajr=?, target_kind=?, area_id=?, camera_ids=?, loop=?, gain_db=?
         WHERE id = 1`,
        [
            fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : cur.enabled,
            numOr(f.latitude, cur.latitude, -90, 90), numOr(f.longitude, cur.longitude, -180, 180), numOr(f.elevation, cur.elevation, -500, 9000),
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
        ],
    );
    return getConfig();
}

function cfgToParams(cfg) {
    return {
        lat: cfg.latitude, lon: cfg.longitude, tz: 7,
        fajrAngle: cfg.fajr_angle, ishaAngle: cfg.isha_angle, asrFactor: cfg.asr_factor,
        ikhtiyati: cfg.ikhtiyati,
        offsets: { fajr: cfg.offset_fajr, dhuhr: cfg.offset_dhuhr, asr: cfg.offset_asr, maghrib: cfg.offset_maghrib, isha: cfg.offset_isha },
    };
}

/** Today's computed prayer times (WIB) + which are enabled, for the preview + scheduler. */
export function todayTimes(nowMs = Date.now()) {
    const cfg = getConfig();
    const now = wibNow(nowMs);
    const times = computePrayerTimes({ year: now.year, month: now.month, day: now.day }, cfgToParams(cfg));
    return { date: now.dateKey, times, cfg };
}

function resolveTargets(cfg) {
    const supported = listBroadcastTargets({ includeUnknown: false });
    if ((cfg.target_kind || 'area') === 'area') {
        return supported.filter((t) => t.area_id === cfg.area_id).map((t) => t.id);
    }
    const set = new Set(cfg.camera_ids);
    return supported.filter((t) => set.has(t.id)).map((t) => t.id);
}

/** One prayer tick: if a currently-enabled prayer matches this WIB minute, play the adzan (once). */
export async function runDuePrayer(nowMs = Date.now()) {
    const cfg = getConfig();
    if (!cfg.enabled || !cfg.clip_id) return false;
    const now = wibNow(nowMs);
    const { times } = todayTimes(nowMs);
    for (const p of PRAYERS) {
        if (!cfg[`enable_${p}`]) continue;
        if (times[p] !== now.hhmm) continue;
        const key = `${now.dateKey} ${p}`;
        if (cfg.last_fired === key) return false; // already fired this prayer today
        execute('UPDATE audio_prayer_config SET last_fired = ? WHERE id = 1', [key]);
        const ids = resolveTargets(cfg);
        if (ids.length === 0) { console.warn(`[Adzan] ${LABELS[p]} due but no supported target camera`); return false; }
        const clipId = (p === 'fajr' && cfg.clip_id_fajr) ? cfg.clip_id_fajr : cfg.clip_id;
        try {
            const { results } = await playToCameras(ids, 'clip', clipId, cfg.loop || 1, { gainDb: cfg.gain_db }); // bypasses quiet hours (not via the play controller)
            const name = getClip(clipId)?.name;
            logPlay({ sourceType: 'clip', sourceId: clipId, sourceName: `ADZAN ${LABELS[p]}: ${name || ''}`.trim(), cameraIds: ids, results, operatorName: 'jadwal-adzan' });
            const ok = results.filter((r) => r.ok).length;
            console.log(`[Adzan] ${LABELS[p]} ${times[p]} -> ${ok}/${results.length} kamera`);
        } catch (e) {
            console.error(`[Adzan] ${LABELS[p]} play error:`, e.message);
        }
        return true;
    }
    return false;
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
