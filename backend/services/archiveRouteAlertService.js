// Purpose: Scheduled watcher that sends a Telegram nag when a recording camera has no archive
//          route — its footage lives only on the box with no off-site copy. One message when a
//          gap appears, a slow renag while it is ignored, and a recovery notice once it is closed.
// Caller: recordingDomainBootstrap.js registers checkAndAlert as a recordingScheduler task.
// Deps: telegramArchiveService (unrouted set + sidecar/route availability), telegramService
//        (monitoring chat send), settingsService + config (master on/off, exempt list, persisted
//        state), archiveRouteAlertPolicy (pure transition core). All injectable for tests.
// MainFuncs: createArchiveRouteAlertService → checkAndAlert.
// SideEffects: sends a Telegram message to the monitoring chat; persists watcher state to settings.
//
// This is the proactive half of the archive story: the loud banner on /admin/telegram-archive only
// helps when someone visits it, so this brings the gap TO the admin.
//
// SCOPE — what this DOES and does NOT catch:
//   - Catches: a recording camera (enabled=1 AND enable_recording=1, class != subscriber) with NO
//     matching route row. That is "you forgot to add an archive route".
//   - Does NOT catch: a route that EXISTS but is failing to upload (bot kicked from the group,
//     permission revoked, chat migrated). That is a separate upload-evidence check against the
//     sidecar's `uploaded` state.db and is intentionally out of scope here.
//
// State (firstSeen per camera + reported + lastNagMs) is PERSISTED to a settings row, so the grace
// window is real wall-clock time and survives restarts/deploys — the whole point being to catch a
// camera forgotten for a long time, which is exactly the case that outlives many restarts. State is
// committed only AFTER a successful send, so a transient Telegram outage retries next tick instead
// of silently marking the gap "reported".

import { config } from '../config/config.js';
import telegramArchiveService from './telegramArchiveService.js';
import settingsService from './settingsService.js';
import { sendHealthAlertMessage, isTelegramConfigured } from './telegramService.js';
import { evaluateArchiveRouteAlert } from './archiveRouteAlertPolicy.js';

const HOUR_MS = 60 * 60 * 1000;
const toHours = (raw, fallback) => {
    const n = Number(raw);
    return (Number.isFinite(n) && n >= 0 ? n : fallback) * HOUR_MS;
};
// Setup legitimately finishes in minutes, and local retention is short, so grace stays small: a real
// gap is caught while footage still exists, without nagging mid-setup. Renag is kept below retention
// so a reminder still has salvage value rather than arriving after everything is deleted.
const DEFAULT_GRACE_MS = toHours(process.env.ARCHIVE_ROUTE_ALERT_GRACE_HOURS, 2);
const DEFAULT_RENAG_MS = toHours(process.env.ARCHIVE_ROUTE_ALERT_RENAG_HOURS, 12);
const STATE_KEY = 'archive_route_alert_state';
const MAX_LIST = 20;

/**
 * Master on/off. Precedence DB -> env -> default(on): the admin setting
 * (`archive_route_alerts_enabled`) wins, the env var (ARCHIVE_ROUTE_ALERTS_ENABLED) is a working
 * fallback, and an untouched install keeps nagging. Read fresh each tick, never throws.
 */
function archiveRouteAlertsEnabled() {
    const stored = settingsService.getSettingValue('archive_route_alerts_enabled');
    if (stored === true || stored === false) return stored;
    if (stored === 'true' || stored === 1 || stored === '1' || stored === 'on') return true;
    if (stored === 'false' || stored === 0 || stored === '0' || stored === 'off') return false;
    return config.telegram?.archiveRouteAlertsEnabled !== false;
}

/** Camera ids the operator has deliberately chosen NOT to archive (e.g. a camera kept local on
 *  purpose). Comma-separated setting; keeps a standing decision from becoming a permanent renag. */
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
    };
}

function defaultLoadState() {
    const raw = settingsService.getSettingValue(STATE_KEY);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function defaultSaveState(state) {
    settingsService.updateSetting(STATE_KEY, state, 'Auto: state internal alert rute arsip Telegram');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function buildAlertMessage(cameras, reason) {
    const n = cameras.length;
    const title = reason === 'renag'
        ? 'Pengingat — Rekaman Belum Dicadangkan ke Telegram'
        : 'Rekaman Belum Dicadangkan ke Telegram';
    const lines = [`⚠️ <b>${title}</b>`];
    lines.push(`${n} kamera merekam tetapi footage-nya HANYA ada di server — belum punya cadangan off-site:`);
    lines.push('');
    cameras.slice(0, MAX_LIST).forEach((cam) => {
        lines.push(`• ${escapeHtml(cam.name)}${cam.areaName ? ` — ${escapeHtml(cam.areaName)}` : ''}`);
    });
    if (n > MAX_LIST) lines.push(`• …dan ${n - MAX_LIST} lainnya`);
    lines.push('');
    lines.push('Atur tujuannya di Admin → Arsip ke Telegram (/admin/telegram-archive).');
    return lines.join('\n');
}

export function buildRecoverMessage() {
    // Deliberately does NOT assert "backed up": the gap can also close by disabling recording or
    // deleting the camera. The honest claim is that no recording camera currently lacks a route.
    return [
        '✅ <b>Arsip Telegram — Tidak Ada Kamera Terlewat</b>',
        'Tidak ada lagi kamera perekam yang belum punya tujuan arsip Telegram.',
    ].join('\n');
}

export function createArchiveRouteAlertService({
    listUnrouted = () => telegramArchiveService.unroutedRecordingCameras(),
    sidecarAvailable = () => telegramArchiveService.isAvailable(),
    hasRoutes = () => telegramArchiveService.hasConfiguredRoutes(),
    sendMessage = sendHealthAlertMessage,
    telegramConfigured = isTelegramConfigured,
    isEnabled = archiveRouteAlertsEnabled,
    exemptIds = exemptCameraIds,
    loadState = defaultLoadState,
    saveState = defaultSaveState,
    graceMs = DEFAULT_GRACE_MS,
    renagMs = DEFAULT_RENAG_MS,
    logger = console,
} = {}) {
    let state = { firstSeen: {}, reported: [], lastNagMs: null };
    let loaded = false;

    // Load persisted state lazily on first use — at module-import time the DB may not be ready yet.
    function ensureLoaded() {
        if (loaded) return;
        loaded = true;
        try {
            const parsed = loadState();
            if (parsed) state = normalizeState(parsed);
        } catch (error) {
            logger.error?.('[ArchiveAlert] load state failed:', error?.message || error);
        }
    }

    // Advance in-memory state and persist only when it actually changed (avoids a settings write on
    // every quiet tick). Called only for committed transitions — never on a failed send.
    function commit(next) {
        const changed = JSON.stringify(next) !== JSON.stringify(state);
        state = next;
        if (!changed) return;
        try {
            saveState(next);
        } catch (error) {
            logger.error?.('[ArchiveAlert] save state failed:', error?.message || error);
        }
    }

    /**
     * Read the unrouted set, run it through the pure policy, and send whatever transition it
     * decides. Safe on a short interval — a no-op unless the set (or the renag clock) moved.
     */
    async function checkAndAlert(nowMs = Date.now()) {
        if (!isEnabled()) return { skipped: 'disabled' };
        if (!telegramConfigured()) return { skipped: 'telegram_not_configured' };
        // On a host without the tg-archive sidecar EVERY recording camera would read as unrouted —
        // that is not a real gap, it is a box that never had archiving. Stay silent.
        if (!sidecarAvailable()) return { skipped: 'sidecar_unavailable' };
        // Sidecar present but not a single route configured yet = cold start, not a real gap either.
        if (!hasRoutes()) return { skipped: 'not_configured' };

        ensureLoaded();

        let unrouted;
        try {
            const exempt = exemptIds();
            unrouted = listUnrouted().filter(
                (cam) => cam.cameraClass !== 'subscriber' && !exempt.has(cam.id),
            );
        } catch (error) {
            logger.error?.('[ArchiveAlert] list failed:', error?.message || error);
            return { skipped: 'list_error' };
        }

        const { state: nextState, action } = evaluateArchiveRouteAlert(state, {
            unrouted, nowMs, graceMs, renagMs,
        });

        if (action.type === 'none') {
            commit(nextState);
            return { changed: false, unrouted: unrouted.length };
        }

        const message = action.type === 'recover'
            ? buildRecoverMessage()
            : buildAlertMessage(action.cameras, action.reason);
        try {
            const sent = await sendMessage(message);
            if (sent === false) {
                // Delivery failed — do NOT commit, so the same transition is retried next tick.
                return { changed: true, type: action.type, sent: false };
            }
            commit(nextState);
            return { changed: true, type: action.type, cameras: action.cameras?.length ?? 0, sent: true };
        } catch (error) {
            logger.error?.('[ArchiveAlert] send failed:', error?.message || error);
            return { changed: true, type: action.type, sent: false };
        }
    }

    /** Test hook — clear the remembered state (does not persist). */
    function _reset() {
        state = { firstSeen: {}, reported: [], lastNagMs: null };
        loaded = true;
    }

    return { checkAndAlert, buildAlertMessage, buildRecoverMessage, _reset };
}

export default createArchiveRouteAlertService();
