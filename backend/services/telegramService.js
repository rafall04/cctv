/**
 * Purpose: Send Telegram alerts for camera status, feedback, and system events with multi-target routing.
 * Caller: cameraHealthService, feedback flows, admin Telegram config/test endpoints.
 * Deps: database settings table, timezoneService, Telegram Bot API, internal ingest policy resolver.
 * MainFuncs: sendCameraStatusNotifications, sendMonitoringMessage, sendFeedbackMessage, getTelegramStatus.
 * SideEffects: Reads/writes settings, sends outbound Telegram HTTP requests, maintains in-memory cooldown cache.
 */

import { queryOne, execute } from '../database/database.js';
import { config } from '../config/config.js';
import { formatDateTime } from './timezoneService.js';
import { resolveInternalIngestPolicy } from '../utils/internalIngestPolicy.js';

// Cooldown tracking to prevent spam
const notificationCooldowns = new Map();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const TELEGRAM_SEND_TIMEOUT_MS = 10 * 1000; // bound each Telegram API call so a slow/hung request cannot block the caller

// Cache for settings (refresh every 60 seconds)
let settingsCache = null;
let settingsCacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds
const LEGACY_MONITORING_TARGET_ID = 'legacy-monitoring';
const VALID_EVENTS = new Set(['offline', 'online']);
const MASKED_TOKEN_SUFFIX = '...';

// Alert-confirmation windows (anti-flap): a DOWN/UP alert is only sent after the
// camera has held the new state for this long. Operator-tunable via settings;
// these defaults mirror telegramAlertConfirmationPolicy's built-ins.
const DEFAULT_DOWN_CONFIRMATION_MS = 120 * 1000;
const DEFAULT_UP_CONFIRMATION_MS = 60 * 1000;
const MIN_CONFIRMATION_MS = 10 * 1000;       // floor: 10s
const MAX_CONFIRMATION_MS = 30 * 60 * 1000;  // ceiling: 30min

function clampConfirmationMs(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.min(MAX_CONFIRMATION_MS, Math.max(MIN_CONFIRMATION_MS, Math.round(n)));
}

function normalizeAlertConfirmation(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        downMs: clampConfirmationMs(source.downMs, DEFAULT_DOWN_CONFIRMATION_MS),
        upMs: clampConfirmationMs(source.upMs, DEFAULT_UP_CONFIRMATION_MS),
    };
}

function isMaskedTelegramToken(value = '') {
    return typeof value === 'string' && value.endsWith(MASKED_TOKEN_SUFFIX);
}

function resolveBotTokenForSave(nextToken = '', currentToken = '') {
    const normalizedNext = String(nextToken || '').trim();
    const normalizedCurrent = String(currentToken || '').trim();

    if (!normalizedNext) {
        return '';
    }

    if (isMaskedTelegramToken(normalizedNext)) {
        const visiblePrefix = normalizedNext.slice(0, -MASKED_TOKEN_SUFFIX.length);
        if (normalizedCurrent && normalizedCurrent.startsWith(visiblePrefix)) {
            return normalizedCurrent;
        }
    }

    return normalizedNext;
}

function hasCameraMonitoringTarget(settings = {}) {
    return Boolean(settings.monitoringChatId)
        || (Array.isArray(settings.notificationTargets) && settings.notificationTargets.length > 0);
}

function normalizeTelegramTarget(target = {}) {
    const id = String(target.id || target.name || target.chatId || '').trim();
    const chatId = String(target.chatId || '').trim();
    if (!id || !chatId) {
        return null;
    }

    return {
        id,
        name: String(target.name || id).trim(),
        chatId,
        enabled: target.enabled !== false,
    };
}

function normalizeTelegramRule(rule = {}) {
    const targetId = String(rule.targetId || '').trim();
    if (!targetId) {
        return null;
    }

    const events = Array.isArray(rule.events)
        ? rule.events.filter((event) => VALID_EVENTS.has(event))
        : ['offline', 'online'];
    // Default to 'any' so an unset rule covers ALL ingest modes (on_demand,
    // always_on, external). The previous ['always_on'] default silently
    // matched only always-on cameras, so on-demand local cameras (the
    // majority) never produced an alert — the main Telegram precision gap.
    const ingestModes = Array.isArray(rule.ingestModes) && rule.ingestModes.length > 0
        ? rule.ingestModes
        : ['any'];

    return {
        id: String(rule.id || `${targetId}-${rule.scope || 'global'}`).trim(),
        enabled: rule.enabled !== false,
        targetId,
        scope: ['global', 'area', 'camera'].includes(rule.scope) ? rule.scope : 'global',
        areaId: Number.parseInt(rule.areaId, 10),
        cameraId: Number.parseInt(rule.cameraId, 10),
        events,
        ingestModes,
    };
}

function normalizeTelegramSettings(settings = {}) {
    const targets = [];
    if (settings.monitoringChatId) {
        targets.push({
            id: LEGACY_MONITORING_TARGET_ID,
            name: 'Monitoring Utama',
            chatId: String(settings.monitoringChatId).trim(),
            enabled: true,
        });
    }

    if (Array.isArray(settings.notificationTargets)) {
        for (const target of settings.notificationTargets) {
            const normalized = normalizeTelegramTarget(target);
            if (normalized) {
                targets.push(normalized);
            }
        }
    }

    const targetByChatId = new Map();
    for (const target of targets) {
        if (target.enabled) {
            targetByChatId.set(target.chatId, target);
        }
    }

    const rules = Array.isArray(settings.notificationRules)
        ? settings.notificationRules.map(normalizeTelegramRule).filter(Boolean)
        : [];

    if (rules.length === 0 && settings.monitoringChatId) {
        rules.push({
            id: 'default-all-modes',
            enabled: true,
            targetId: LEGACY_MONITORING_TARGET_ID,
            scope: 'global',
            events: ['offline', 'online'],
            ingestModes: ['any'],
        });
    }

    return {
        ...settings,
        notificationTargets: Array.from(targetByChatId.values()),
        notificationRules: rules,
        // Which target receives recording-pipeline health alerts. Empty = fall
        // back to the monitoring chat.
        healthAlertTargetId: String(settings.healthAlertTargetId || '').trim(),
        // Operator-tunable anti-flap windows for camera DOWN/UP alerts.
        alertConfirmation: normalizeAlertConfirmation(settings.alertConfirmation),
        // Chat IDs allowed to COMMAND the bot (send /commands, tap approve/manage
        // buttons). This is the bot's authorization gate — anything outside it is
        // ignored/denied. Empty here means "fall back to the monitoring chat"
        // (resolved by resolveCommandChatIds), so an operator who only set a
        // monitoring chat can manage customers from it with zero extra config.
        commandChatIds: normalizeChatIdList(settings.commandChatIds),
    };
}

function normalizeChatIdList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const result = [];
    for (const raw of value) {
        const id = String(raw == null ? '' : raw).trim();
        if (id && !seen.has(id)) {
            seen.add(id);
            result.push(id);
        }
    }
    return result;
}

/**
 * Resolve the bot command allow-list: the explicitly-configured commandChatIds,
 * or — when none are set — the monitoring chat as a sensible default so the
 * operator's existing chat can manage customers without extra setup.
 */
function resolveCommandChatIds(settings) {
    if (Array.isArray(settings.commandChatIds) && settings.commandChatIds.length > 0) {
        return settings.commandChatIds;
    }
    const monitoring = String(settings.monitoringChatId || '').trim();
    return monitoring ? [monitoring] : [];
}

function getCameraArea(camera = {}) {
    return {
        internal_ingest_policy_default: camera.area_internal_ingest_policy_default,
        internal_on_demand_close_after_seconds: camera.area_internal_on_demand_close_after_seconds,
    };
}

function getCameraIngestMode(camera = {}) {
    if (camera.delivery_type !== 'internal_hls') {
        return 'external';
    }

    return resolveInternalIngestPolicy(camera, getCameraArea(camera)).mode;
}

function ruleMatchesCamera(rule, camera, eventType) {
    if (!rule.enabled || !rule.events.includes(eventType)) {
        return false;
    }

    const ingestMode = getCameraIngestMode(camera);
    if (!rule.ingestModes.includes('any') && !rule.ingestModes.includes(ingestMode)) {
        return false;
    }

    if (rule.scope === 'area') {
        return Number.parseInt(camera.area_id, 10) === rule.areaId;
    }

    if (rule.scope === 'camera') {
        return Number.parseInt(camera.id, 10) === rule.cameraId;
    }

    return true;
}

function buildNotificationRuleIssues(settings = {}) {
    const targetsById = new Map((settings.notificationTargets || []).map((target) => [target.id, target]));
    const issues = [];

    for (const rule of settings.notificationRules || []) {
        if (!targetsById.has(rule.targetId)) {
            issues.push({
                id: rule.id,
                severity: 'error',
                message: 'Rule mengarah ke target Telegram yang tidak tersedia.',
            });
            continue;
        }

        if (rule.scope === 'area' && Number.isNaN(rule.areaId)) {
            issues.push({
                id: rule.id,
                severity: 'error',
                message: 'Rule area membutuhkan areaId valid.',
            });
        }

        if (rule.scope === 'camera' && Number.isNaN(rule.cameraId)) {
            issues.push({
                id: rule.id,
                severity: 'error',
                message: 'Rule kamera membutuhkan cameraId valid.',
            });
        }

        if (!Array.isArray(rule.events) || rule.events.length === 0) {
            issues.push({
                id: rule.id,
                severity: 'error',
                message: 'Rule membutuhkan minimal satu event offline atau online.',
            });
        }
    }

    return issues;
}

function maskChatId(chatId = '') {
    const value = String(chatId || '').trim();
    if (value.length <= 6) {
        return value;
    }
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function formatTargetForDiagnostics(target = {}) {
    return {
        id: target.id,
        name: target.name,
        enabled: target.enabled !== false,
        chatIdMasked: maskChatId(target.chatId),
    };
}

export function inspectCameraNotificationRouting(eventType, camera = {}) {
    const settings = getTelegramSettings();
    const validEvent = VALID_EVENTS.has(eventType);
    const targetsById = new Map(settings.notificationTargets.map((target) => [target.id, target]));
    const matchedTargetByChatId = new Map();
    const matchedRules = [];
    const unmatchedRules = [];

    if (!validEvent) {
        return {
            configured: false,
            canSend: false,
            skippedReason: 'INVALID_EVENT',
            matchedTargets: [],
            matchedRules: [],
            unmatchedRules: [],
            ruleIssues: buildNotificationRuleIssues(settings),
        };
    }

    for (const rule of settings.notificationRules) {
        const target = targetsById.get(rule.targetId);
        const matched = Boolean(target?.chatId && ruleMatchesCamera(rule, camera, eventType));
        const ruleInfo = {
            id: rule.id,
            targetId: rule.targetId,
            targetName: target?.name || rule.targetId,
            scope: rule.scope,
            eventType,
            matched,
        };

        if (matched) {
            matchedRules.push(ruleInfo);
            matchedTargetByChatId.set(target.chatId, formatTargetForDiagnostics(target));
        } else {
            unmatchedRules.push(ruleInfo);
        }
    }

    const matchedTargets = Array.from(matchedTargetByChatId.values());
    const configured = Boolean(settings.botToken && settings.notificationTargets.length > 0);

    return {
        configured,
        canSend: configured && matchedTargets.length > 0,
        skippedReason: !settings.botToken
            ? 'BOT_TOKEN_MISSING'
            : matchedTargets.length === 0
                ? 'NO_MATCHING_TARGET'
                : null,
        matchedTargets,
        matchedRules,
        unmatchedRules,
        ruleIssues: buildNotificationRuleIssues(settings),
    };
}

function groupCamerasByArea(cameras = []) {
    const groups = new Map();
    for (const camera of cameras) {
        const areaName = camera.area_name || camera.areaName || camera.location || 'Tanpa Area';
        if (!groups.has(areaName)) {
            groups.set(areaName, []);
        }
        groups.get(areaName).push(camera);
    }
    return groups;
}

function normalizeAlertDetectedAt(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value;
    }

    if (Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }

    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }

    return null;
}

function buildCameraStatusLine(camera, index, eventType) {
    const lines = [`${index + 1}. ${camera.name}`];
    const detectedAt = normalizeAlertDetectedAt(camera.alertDetectedAt);
    if (detectedAt) {
        const label = eventType === 'offline' ? 'Terdeteksi DOWN' : 'Terdeteksi UP';
        lines.push(`   ${label}: ${formatDateTime(detectedAt)}`);
    }
    return lines;
}

function buildCameraStatusMessage(eventType, cameras = [], targetName = '') {
    const title = eventType === 'offline' ? 'CCTV DOWN' : 'CCTV RECOVERED';
    const groups = groupCamerasByArea(cameras);
    const lines = [
        `<b>${title}${targetName ? ` - ${targetName}` : ''}</b>`,
        `Total: ${cameras.length} kamera`,
        '',
    ];

    for (const [areaName, areaCameras] of groups.entries()) {
        lines.push(`<b>${areaName}</b>`);
        areaCameras.slice(0, 20).forEach((camera, index) => {
            lines.push(...buildCameraStatusLine(camera, index, eventType));
        });
        if (areaCameras.length > 20) {
            lines.push(`...dan ${areaCameras.length - 20} kamera lainnya`);
        }
        lines.push('');
    }

    lines.push(`Alert dikirim: ${formatDateTime(new Date())}`);
    return lines.join('\n').trim();
}

function getEnvTelegramSettings() {
    return normalizeTelegramSettings({
        botToken: config.telegram.botToken || '',
        monitoringChatId: config.telegram.monitoringChatId || '',
        feedbackChatId: config.telegram.feedbackChatId || '',
        enabled: config.telegram.enabled,
    });
}

/**
 * Get Telegram settings from database with caching
 */
function getTelegramSettings() {
    const now = Date.now();
    if (settingsCache && (now - settingsCacheTime) < CACHE_TTL) {
        return settingsCache;
    }

    try {
        const setting = queryOne('SELECT value FROM settings WHERE key = ?', ['telegram_config']);
        if (setting) {
            settingsCache = normalizeTelegramSettings(JSON.parse(setting.value));
        } else {
            settingsCache = getEnvTelegramSettings();
        }
        settingsCacheTime = now;
        return settingsCache;
    } catch (error) {
        console.error('[Telegram] Error reading settings:', error);
        return getEnvTelegramSettings();
    }
}

/**
 * Clear settings cache (call after update)
 */
export function clearSettingsCache() {
    settingsCache = null;
    settingsCacheTime = 0;
}

/**
 * Operator-configured anti-flap windows for camera DOWN/UP alerts.
 * Returns `{ down, up }` in milliseconds, already clamped to sane bounds.
 * The camera health loop reads this each tick (settings are cached 60s).
 */
export function getTelegramAlertConfirmationMs() {
    const settings = getTelegramSettings();
    const normalized = normalizeAlertConfirmation(settings.alertConfirmation);
    return { down: normalized.downMs, up: normalized.upMs };
}

/**
 * Save Telegram settings to database
 */
export function saveTelegramSettings(settings) {
    try {
        const existing = queryOne('SELECT * FROM settings WHERE key = ?', ['telegram_config']);
        const currentSettings = existing?.value
            ? normalizeTelegramSettings(JSON.parse(existing.value))
            : normalizeTelegramSettings({});
        const normalized = normalizeTelegramSettings({
            ...settings,
            botToken: resolveBotTokenForSave(settings.botToken, currentSettings.botToken),
        });
        const valueStr = JSON.stringify(normalized);
        
        if (existing) {
            execute(
                'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
                [valueStr, 'telegram_config']
            );
        } else {
            execute(
                'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)',
                ['telegram_config', valueStr, 'Telegram Bot Configuration']
            );
        }
        
        clearSettingsCache();
        return true;
    } catch (error) {
        console.error('[Telegram] Error saving settings:', error);
        return false;
    }
}

function isInCooldown(key) {
    const lastSent = notificationCooldowns.get(key);
    if (!lastSent) return false;
    return (Date.now() - lastSent) < COOLDOWN_MS;
}

function setCooldown(key) {
    notificationCooldowns.set(key, Date.now());
}

/**
 * Low-level Telegram Bot API call — the single outbound HTTP path for the whole
 * app (sendMessage, editMessageText, answerCallbackQuery, getUpdates, ...).
 * Returns the parsed Telegram response ({ ok, result, description }) or null on
 * a missing token / transport failure / abort. `timeoutMs` overrides the default
 * bound (getUpdates long-polling needs a ceiling above its long-poll timeout),
 * and `signal` lets a caller (e.g. graceful shutdown) cancel an in-flight poll.
 */
export async function callTelegramApi(method, payload = {}, { timeoutMs = TELEGRAM_SEND_TIMEOUT_MS, signal } = {}) {
    const settings = getTelegramSettings();
    if (!settings.botToken) {
        return null;
    }

    const url = `https://api.telegram.org/bot${settings.botToken}/${method}`;
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', onExternalAbort, { once: true });
        }
    }
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        return await response.json();
    } catch (error) {
        if (error?.name !== 'AbortError') {
            // undici surfaces the real reason in error.cause (e.g. ECONNRESET,
            // UND_ERR_HEADERS_TIMEOUT, ENETUNREACH); message alone is just "fetch failed".
            const cause = error?.cause?.code || error?.cause?.message;
            console.error(`[Telegram] API ${method} error:`, error.message, cause ? `(cause: ${cause})` : '');
        }
        return null;
    } finally {
        clearTimeout(timeout);
        if (signal) {
            signal.removeEventListener?.('abort', onExternalAbort);
        }
    }
}

/**
 * Send message to Telegram bot
 */
async function sendToTelegram(message, chatId) {
    if (!chatId) {
        console.log('[Telegram] Chat ID missing');
        return false;
    }

    const data = await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    });

    if (!data) {
        console.log('[Telegram] Bot not configured or request failed');
        return false;
    }
    if (!data.ok) {
        console.error('[Telegram] Failed:', data.description);
        return false;
    }
    return true;
}

export async function sendCameraStatusNotifications(eventType, cameras = [], options = {}) {
    // When `options.detailed` is set the caller needs to know which cameras
    // matched a notification target (`routedCameraIds`) and which actually had
    // a message delivered (`deliveredCameraIds`) — the camera health loop uses
    // this to only advance a confirmed alert once it has truly been sent, and to
    // avoid retrying cameras that simply have no recipient. Other callers keep
    // getting the legacy boolean.
    const emptyDetail = { sent: false, routedCameraIds: [], deliveredCameraIds: [] };
    const finish = (sent, routed, delivered) => (
        options.detailed
            ? { sent, routedCameraIds: Array.from(routed), deliveredCameraIds: Array.from(delivered) }
            : sent
    );

    if (!VALID_EVENTS.has(eventType) || cameras.length === 0) {
        return options.detailed ? emptyDetail : false;
    }

    const settings = getTelegramSettings();
    if (!settings.botToken) {
        console.log('[Telegram] Bot not configured');
        return options.detailed ? emptyDetail : false;
    }

    const targetsById = new Map(settings.notificationTargets.map((target) => [target.id, target]));
    const camerasByChatId = new Map();
    const routedCameraIds = new Set();
    const deliveredCameraIds = new Set();

    for (const camera of cameras) {
        for (const rule of settings.notificationRules) {
            if (!ruleMatchesCamera(rule, camera, eventType)) {
                continue;
            }

            const target = targetsById.get(rule.targetId);
            if (!target?.chatId) {
                continue;
            }

            routedCameraIds.add(camera.id);
            if (!camerasByChatId.has(target.chatId)) {
                camerasByChatId.set(target.chatId, {
                    target,
                    camerasById: new Map(),
                });
            }
            camerasByChatId.get(target.chatId).camerasById.set(camera.id, camera);
        }
    }

    let sentCount = 0;
    for (const { target, camerasById } of camerasByChatId.values()) {
        const targetCameras = Array.from(camerasById.values());
        if (targetCameras.length === 0) {
            continue;
        }

        const cooldownKey = `camera_status_${eventType}_${target.chatId}_${targetCameras.map((camera) => camera.id).sort((a, b) => a - b).join('_')}`;
        if (!options.bypassCooldown && isInCooldown(cooldownKey)) {
            console.log(`[Telegram] Skipping ${eventType} group notification for ${target.name} (cooldown)`);
            continue;
        }

        const message = buildCameraStatusMessage(eventType, targetCameras, target.name);
        const sent = await sendToTelegram(message, target.chatId);
        if (sent) {
            if (!options.bypassCooldown) {
                setCooldown(cooldownKey);
            }
            sentCount += 1;
            for (const camera of targetCameras) {
                deliveredCameraIds.add(camera.id);
            }
        }
    }

    return finish(sentCount > 0, routedCameraIds, deliveredCameraIds);
}

export async function sendMonitoringMessage(message) {
    const settings = getTelegramSettings();
    return sendToTelegram(message, settings.monitoringChatId);
}

/**
 * Send a recording-pipeline health alert to the operator-chosen target group.
 * Falls back to the monitoring chat when no target is set, or when the chosen
 * target was deleted/disabled.
 */
export async function sendHealthAlertMessage(message) {
    const settings = getTelegramSettings();
    const targetId = String(settings.healthAlertTargetId || '').trim();

    let chatId = settings.monitoringChatId;
    if (targetId) {
        const target = (settings.notificationTargets || [])
            .find((candidate) => candidate.id === targetId && candidate.enabled);
        if (target?.chatId) {
            chatId = target.chatId;
        }
    }
    return sendToTelegram(message, chatId);
}

export async function sendFeedbackMessage(message) {
    const settings = getTelegramSettings();
    return sendToTelegram(message, settings.feedbackChatId);
}

export async function sendTargetTestMessage(targetId) {
    const settings = getTelegramSettings();
    const normalizedTargetId = String(targetId || '').trim();
    const target = settings.notificationTargets.find((item) => item.id === normalizedTargetId);

    if (!target?.chatId) {
        return false;
    }

    const message = `
<b>Test Notifikasi Berhasil</b>
Bot Telegram terhubung dengan baik.
Target: ${target.name}
${formatDateTime(new Date())}
    `.trim();

    return sendToTelegram(message, target.chatId);
}

export async function sendCameraOfflineNotification(camera) {
    const cooldownKey = `camera_${camera.id}_offline`;
    
    if (isInCooldown(cooldownKey)) {
        console.log(`[Telegram] Skipping offline notification for ${camera.name} (cooldown)`);
        return false;
    }

    const message = `
🔴 <b>KAMERA OFFLINE</b>
━━━━━━━━━━━━━━━━━━━━
📹 <b>${camera.name}</b>
${camera.location ? `📍 ${camera.location}` : ''}
⏰ ${formatDateTime(new Date())}
━━━━━━━━━━━━━━━━━━━━
<i>Segera periksa koneksi kamera!</i>
    `.trim();

    const sent = await sendMonitoringMessage(message);
    if (sent) {
        setCooldown(cooldownKey);
        console.log(`[Telegram] Sent offline notification for ${camera.name}`);
    }
    return sent;
}

export async function sendCameraOnlineNotification(camera, downtime = null) {
    const cooldownKey = `camera_${camera.id}_online`;
    
    if (isInCooldown(cooldownKey)) {
        console.log(`[Telegram] Skipping online notification for ${camera.name} (cooldown)`);
        return false;
    }

    let downtimeText = '';
    if (downtime && downtime > 0) {
        const minutes = Math.floor(downtime / 60);
        const seconds = downtime % 60;
        downtimeText = minutes > 0 ? `\n⏱ Downtime: ${minutes}m ${seconds}s` : `\n⏱ Downtime: ${seconds}s`;
    }

    const message = `
🟢 <b>KAMERA ONLINE</b>
━━━━━━━━━━━━━━━━━━━━
📹 <b>${camera.name}</b>
${camera.location ? `📍 ${camera.location}` : ''}
⏰ ${formatDateTime(new Date())}${downtimeText}
━━━━━━━━━━━━━━━━━━━━
<i>Kamera kembali normal.</i>
    `.trim();

    const sent = await sendMonitoringMessage(message);
    if (sent) {
        setCooldown(cooldownKey);
        console.log(`[Telegram] Sent online notification for ${camera.name}`);
    }
    return sent;
}

export async function sendMultipleCamerasOfflineNotification(cameras) {
    if (cameras.length === 0) return false;
    const routed = await sendCameraStatusNotifications('offline', cameras);
    if (routed) return true;
    if (cameras.length === 1) return sendCameraOfflineNotification(cameras[0]);

    const cameraList = cameras.map(c => `• ${c.name}`).join('\n');
    
    const message = `
🔴 <b>${cameras.length} KAMERA OFFLINE</b>
━━━━━━━━━━━━━━━━━━━━
${cameraList}
━━━━━━━━━━━━━━━━━━━━
⏰ ${formatDateTime(new Date())}
<i>Segera periksa koneksi!</i>
    `.trim();

    return sendMonitoringMessage(message);
}

export async function sendMultipleCamerasOnlineNotification(cameras) {
    if (cameras.length === 0) return false;
    const routed = await sendCameraStatusNotifications('online', cameras);
    if (routed) return true;
    if (cameras.length === 1) return sendCameraOnlineNotification(cameras[0]);

    const cameraList = cameras.map(c => `• ${c.name}`).join('\n');
    
    const message = `
🟢 <b>${cameras.length} KAMERA ONLINE</b>
━━━━━━━━━━━━━━━━━━━━
${cameraList}
━━━━━━━━━━━━━━━━━━━━
⏰ ${formatDateTime(new Date())}
<i>Semua kamera kembali normal.</i>
    `.trim();

    return sendMonitoringMessage(message);
}

export async function sendFeedbackNotification(feedback) {
    const message = `
📬 <b>Kritik & Saran Baru</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Nama:</b> ${feedback.name || 'Anonim'}
📧 <b>Email:</b> ${feedback.email || '-'}
⏰ <b>Waktu:</b> ${formatDateTime(new Date(feedback.created_at))}
━━━━━━━━━━━━━━━━━━━━
💬 <b>Pesan:</b>
${feedback.message}
━━━━━━━━━━━━━━━━━━━━
<i>ID: #${feedback.id}</i>
    `.trim();

    return sendFeedbackMessage(message);
}

export async function sendTestNotification(type = 'monitoring', options = {}) {
    const message = `
✅ <b>Test Notifikasi Berhasil</b>
━━━━━━━━━━━━━━━━━━━━
Bot Telegram terhubung dengan baik.
Tipe: ${type === 'monitoring' ? 'Monitoring Kamera' : 'Kritik & Saran'}
⏰ ${formatDateTime(new Date())}
━━━━━━━━━━━━━━━━━━━━
    `.trim();

    if (type === 'feedback') {
        return sendFeedbackMessage(message);
    }

    if (type === 'target') {
        return sendTargetTestMessage(options.targetId);
    }

    return sendMonitoringMessage(message);
}

/**
 * Runtime context for the interactive bot (telegramBotService). Exposes whether
 * a token is configured and the resolved command allow-list. The raw token is
 * never returned here — callers send via callTelegramApi, which reads it.
 */
export function getBotRuntimeConfig() {
    const settings = getTelegramSettings();
    return {
        hasToken: Boolean(settings.botToken),
        commandChatIds: resolveCommandChatIds(settings),
    };
}

/** True when `chatId` is authorized to command the bot (after default fallback). */
export function isCommandChat(chatId) {
    const target = String(chatId == null ? '' : chatId).trim();
    if (!target) {
        return false;
    }
    return getBotRuntimeConfig().commandChatIds.includes(target);
}

export function isTelegramConfigured() {
    const settings = getTelegramSettings();
    return !!(settings.botToken && (settings.monitoringChatId || settings.notificationTargets.length > 0));
}

export function isFeedbackConfigured() {
    const settings = getTelegramSettings();
    return !!(settings.botToken && settings.feedbackChatId);
}

export function getTelegramStatus() {
    const settings = getTelegramSettings();
    const notificationRuleIssues = buildNotificationRuleIssues(settings);
    return {
        enabled: !!(settings.botToken && (hasCameraMonitoringTarget(settings) || settings.feedbackChatId)),
        monitoringConfigured: !!(settings.botToken && settings.monitoringChatId),
        cameraMonitoringConfigured: !!(settings.botToken && hasCameraMonitoringTarget(settings)),
        feedbackConfigured: !!(settings.botToken && settings.feedbackChatId),
        botToken: settings.botToken ? `${settings.botToken.substring(0, 10)}...` : '',
        monitoringChatId: settings.monitoringChatId || '',
        feedbackChatId: settings.feedbackChatId || '',
        notificationTargets: settings.notificationTargets || [],
        notificationRules: settings.notificationRules || [],
        notificationRuleIssues,
        healthAlertTargetId: settings.healthAlertTargetId || '',
        alertConfirmation: normalizeAlertConfirmation(settings.alertConfirmation),
        // Bot command authorization: the saved allow-list plus the effective
        // (post-fallback) list the bot actually honors — so the UI can show the
        // monitoring-chat fallback when commandChatIds is empty.
        commandChatIds: settings.commandChatIds || [],
        effectiveCommandChatIds: resolveCommandChatIds(settings),
    };
}

export default {
    callTelegramApi,
    getBotRuntimeConfig,
    isCommandChat,
    sendMonitoringMessage,
    sendHealthAlertMessage,
    sendFeedbackMessage,
    sendTargetTestMessage,
    inspectCameraNotificationRouting,
    sendCameraOfflineNotification,
    sendCameraOnlineNotification,
    sendCameraStatusNotifications,
    sendMultipleCamerasOfflineNotification,
    sendMultipleCamerasOnlineNotification,
    sendFeedbackNotification,
    sendTestNotification,
    isTelegramConfigured,
    isFeedbackConfigured,
    getTelegramStatus,
    saveTelegramSettings,
    clearSettingsCache,
};
