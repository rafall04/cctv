// Purpose: The delivery-health half of archive safety. The routing nag catches "no route"; this
//          catches a route that EXISTS but is not delivering — two independent failure modes:
//            (A) per-camera BROKEN route: recent `status='failed'` uploads (bot removed from the
//                group, chat gone) — footage silently lost while other cameras upload fine, so the
//                pipeline never "stalls" and nothing else notices.
//            (B) sidecar STALLED/DEAD: no upload recorded for a while though cameras are recording.
//                The sidecar has its own 20-min stall alert, but a dead process cannot send it —
//                this app-side check (running in the always-alive backend/recorder) is that backstop.
// Caller: recordingDomainBootstrap.js registers checkAndAlert as a recordingScheduler task.
// Deps: telegramArchiveService.archiveDeliverySnapshot (upload evidence), telegramService (send),
//        settingsService + config (on/off, exempt, persisted state), archiveRouteAlertPolicy (the
//        same pure grace/edge/renag/recover engine the routing nag uses). All injectable for tests.
// MainFuncs: createArchiveUploadAlertService → checkAndAlert.
// SideEffects: sends Telegram messages to the monitoring chat; persists watcher state to settings.
//
// State ({firstSeen/reported/lastNagMs} for the per-camera signal + stallActive for the global one)
// is persisted so grace is wall-clock and a persistent stall is not re-alerted every restart. Each
// signal commits only AFTER its own successful send, so a transient outage retries next tick.

import { config } from '../config/config.js';
import telegramArchiveService from './telegramArchiveService.js';
import settingsService from './settingsService.js';
import { sendHealthAlertMessage, isTelegramConfigured } from './telegramService.js';
import { evaluateArchiveRouteAlert } from './archiveRouteAlertPolicy.js';

const MIN_MS = 60 * 1000;
const num = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};
// A `failed` row is already classified PERMANENT by the uploader (is_permanent_failure excludes the
// transient/rate-limit cases), so grace only needs to outlast a one-sweep blip that self-heals on the
// next retry (~15 min). Short grace = footage lost sooner is noticed sooner.
const DEFAULT_GRACE_MS = num(process.env.ARCHIVE_UPLOAD_ALERT_GRACE_MINUTES, 20) * MIN_MS;
const DEFAULT_RENAG_MS = num(process.env.ARCHIVE_UPLOAD_ALERT_RENAG_HOURS, 12) * 60 * MIN_MS;
const DEFAULT_STALL_MINUTES = num(process.env.ARCHIVE_UPLOAD_ALERT_STALL_MINUTES, 30);
const DEFAULT_FAIL_WINDOW_MINUTES = num(process.env.ARCHIVE_UPLOAD_ALERT_FAIL_WINDOW_MINUTES, 45);
const STATE_KEY = 'archive_upload_alert_state';
const MAX_LIST = 20;

function archiveUploadAlertsEnabled() {
    const stored = settingsService.getSettingValue('archive_upload_alerts_enabled');
    if (stored === true || stored === false) return stored;
    if (stored === 'true' || stored === 1 || stored === '1' || stored === 'on') return true;
    if (stored === 'false' || stored === 0 || stored === '0' || stored === 'off') return false;
    return config.telegram?.archiveUploadAlertsEnabled !== false;
}

function exemptCameraIds() {
    const raw = settingsService.getSettingValue('archive_route_alert_exempt_camera_ids');
    if (!raw) return new Set();
    return new Set(String(raw).split(',').map((s) => Number(s.trim())).filter(Number.isInteger));
}

function normalizeState(parsed) {
    const src = parsed && typeof parsed === 'object' ? parsed : {};
    return {
        firstSeen: src.firstSeen && typeof src.firstSeen === 'object' ? src.firstSeen : {},
        reported: Array.isArray(src.reported) ? src.reported.map(Number).filter(Number.isInteger) : [],
        lastNagMs: typeof src.lastNagMs === 'number' ? src.lastNagMs : null,
        stallActive: src.stallActive === true,
    };
}

function defaultLoadState() {
    const raw = settingsService.getSettingValue(STATE_KEY);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function defaultSaveState(state) {
    settingsService.updateSetting(STATE_KEY, state, 'Auto: state internal alert kesehatan pengiriman arsip');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function buildFailingMessage(cameras, reason) {
    const n = cameras.length;
    const title = reason === 'renag'
        ? 'Pengingat — Rute Arsip TIDAK Berfungsi'
        : 'Rute Arsip TIDAK Berfungsi';
    const lines = [`🔴 <b>${title}</b>`];
    lines.push(`${n} kamera PUNYA rute arsip tetapi upload-nya GAGAL — footage tak sampai ke Telegram`);
    lines.push('(penyebab tersering: bot dikeluarkan dari grup atau izin kirim dicabut):');
    lines.push('');
    cameras.slice(0, MAX_LIST).forEach((cam) => {
        const why = cam.detail ? ` — ${escapeHtml(cam.detail)}` : '';
        lines.push(`• ${escapeHtml(cam.name)}${cam.areaName ? ` (${escapeHtml(cam.areaName)})` : ''}${why}`);
    });
    if (n > MAX_LIST) lines.push(`• …dan ${n - MAX_LIST} lainnya`);
    lines.push('');
    lines.push('Cek grup tujuannya (bot masih di dalam & bisa kirim?) di Admin → Arsip ke Telegram.');
    return lines.join('\n');
}

export function buildFailingRecoverMessage() {
    return [
        '✅ <b>Rute Arsip Pulih</b>',
        'Upload arsip yang tadi gagal kini berhasil lagi — footage kembali terkirim ke Telegram.',
    ].join('\n');
}

export function buildStallMessage(backlogMinutes) {
    const behind = backlogMinutes == null ? '' : ` — footage terbaru tertinggal ~${Math.round(backlogMinutes)} menit`;
    return [
        '🔴 <b>Arsip Telegram BERHENTI</b>',
        `Sidecar arsip tidak mengunggah footage baru${behind}, padahal kamera sedang merekam —`,
        'kemungkinan prosesnya mati atau tersumbat. Footage baru TIDAK sedang tercadang off-site.',
        '',
        'Cek di server: <code>systemctl status tg-archive</code> lalu <code>journalctl -u tg-archive -n 50</code>.',
    ].join('\n');
}

export function buildStallRecoverMessage() {
    return [
        '✅ <b>Arsip Telegram Jalan Lagi</b>',
        'Sidecar arsip kembali mengunggah — pencadangan off-site berlanjut.',
    ].join('\n');
}

export function createArchiveUploadAlertService({
    getSnapshot = (opts) => telegramArchiveService.archiveDeliverySnapshot(opts),
    sidecarAvailable = () => telegramArchiveService.isAvailable(),
    hasRoutes = () => telegramArchiveService.hasConfiguredRoutes(),
    sendMessage = sendHealthAlertMessage,
    telegramConfigured = isTelegramConfigured,
    isEnabled = archiveUploadAlertsEnabled,
    exemptIds = exemptCameraIds,
    loadState = defaultLoadState,
    saveState = defaultSaveState,
    graceMs = DEFAULT_GRACE_MS,
    renagMs = DEFAULT_RENAG_MS,
    stallMinutes = DEFAULT_STALL_MINUTES,
    failWindowMinutes = DEFAULT_FAIL_WINDOW_MINUTES,
    logger = console,
} = {}) {
    let state = { firstSeen: {}, reported: [], lastNagMs: null, stallActive: false };
    let loaded = false;

    function ensureLoaded() {
        if (loaded) return;
        loaded = true;
        try {
            const parsed = loadState();
            if (parsed) state = normalizeState(parsed);
        } catch (error) {
            logger.error?.('[ArchiveUpload] load state failed:', error?.message || error);
        }
    }

    function persist(next) {
        if (JSON.stringify(next) === JSON.stringify(state)) {
            state = next;
            return;
        }
        state = next;
        try {
            saveState(next);
        } catch (error) {
            logger.error?.('[ArchiveUpload] save state failed:', error?.message || error);
        }
    }

    async function trySend(message) {
        try {
            return (await sendMessage(message)) !== false;
        } catch (error) {
            logger.error?.('[ArchiveUpload] send failed:', error?.message || error);
            return false;
        }
    }

    /**
     * Evaluate both signals (stall + per-camera failing) and send whatever transitioned. Each
     * signal's state advances only after its own send succeeds; state is persisted once at the end.
     */
    async function checkAndAlert(nowMs = Date.now()) {
        if (!isEnabled()) return { skipped: 'disabled' };
        if (!telegramConfigured()) return { skipped: 'telegram_not_configured' };
        if (!sidecarAvailable()) return { skipped: 'sidecar_unavailable' };
        if (!hasRoutes()) return { skipped: 'not_configured' };

        ensureLoaded();

        let snapshot;
        try {
            snapshot = getSnapshot({ failWindowMinutes });
        } catch (error) {
            logger.error?.('[ArchiveUpload] snapshot failed:', error?.message || error);
            return { skipped: 'snapshot_error' };
        }
        // "Cannot read the evidence" is NOT "all clear". HOLD every signal rather than risk a false
        // recovery that would silence a real, still-active alarm.
        if (!snapshot.evidenceAvailable) return { skipped: 'evidence_unavailable' };

        const backlog = snapshot.backlogMinutes;
        const stalled = backlog != null && backlog > stallMinutes;
        const current = backlog != null && backlog <= stallMinutes; // sidecar PROVEN to be keeping up

        const next = { ...state };
        const result = { changed: false };

        // Signal B — sidecar stall/death. Recovery needs POSITIVE proof the sidecar is current, not
        // merely the absence of a stall reading (which also happens when the fleet goes idle). When
        // the state is indeterminate (neither stalled nor current), HOLD stallActive as-is.
        if (stalled && !state.stallActive) {
            if (await trySend(buildStallMessage(backlog))) {
                next.stallActive = true;
                result.changed = true;
                result.stall = 'alert';
            }
        } else if (current && state.stallActive) {
            if (await trySend(buildStallRecoverMessage())) {
                next.stallActive = false;
                result.changed = true;
                result.stall = 'recover';
            }
        }

        // Signal A — per-camera broken route. Trust the failing set ONLY while the sidecar is proven
        // current: while it is stalled/indeterminate the `failed` rows are not being refreshed, so
        // their absence is an artifact of the stall, not a fix. HOLD Signal A entirely otherwise, so
        // a dead sidecar can never emit a false "route recovered".
        if (current) {
            const exempt = exemptIds();
            const failing = snapshot.failingCameras.filter(
                (cam) => cam.cameraClass !== 'subscriber' && !exempt.has(cam.id),
            );
            const policy = evaluateArchiveRouteAlert(
                { firstSeen: state.firstSeen, reported: state.reported, lastNagMs: state.lastNagMs },
                { unrouted: failing, nowMs, graceMs, renagMs },
            );
            if (policy.action.type === 'none') {
                Object.assign(next, policy.state);
            } else {
                const message = policy.action.type === 'recover'
                    ? buildFailingRecoverMessage()
                    : buildFailingMessage(policy.action.cameras, policy.action.reason);
                if (await trySend(message)) {
                    Object.assign(next, policy.state);
                    result.changed = true;
                    result.failing = policy.action.type;
                    result.cameras = policy.action.cameras?.length ?? 0;
                }
            }
        }

        persist(next);
        return result;
    }

    function _reset() {
        state = { firstSeen: {}, reported: [], lastNagMs: null, stallActive: false };
        loaded = true;
    }

    return {
        checkAndAlert,
        buildFailingMessage,
        buildStallMessage,
        buildStallRecoverMessage,
        buildFailingRecoverMessage,
        _reset,
    };
}

export default createArchiveUploadAlertService();
