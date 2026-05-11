/**
 * Purpose: Send Telegram alerts for camera status, feedback, and system events with multi-target routing.
 * Caller: cameraHealthService, feedback flows, admin Telegram config/test endpoints.
 * Deps: database settings table, timezoneService, Telegram Bot API, internal ingest policy resolver.
 * MainFuncs: sendCameraStatusNotifications, sendMonitoringMessage, sendFeedbackMessage, getTelegramStatus.
 * SideEffects: Reads/writes settings, sends outbound Telegram HTTP requests, maintains in-memory cooldown cache.
 */

import { queryOne, execute } from '../database/database.js';
import { formatDateTime } from './timezoneService.js';
import { resolveInternalIngestPolicy } from '../utils/internalIngestPolicy.js';

// Cooldown tracking to prevent spam
const notificationCooldowns = new Map();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Cache for settings (refresh every 60 seconds)
let settingsCache = null;
let settingsCacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds
const LEGACY_MONITORING_TARGET_ID = 'legacy-monitoring';
const VALID_EVENTS = new Set(['offline', 'online']);
const MASKED_TOKEN_SUFFIX = '...';

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
    const ingestModes = Array.isArray(rule.ingestModes) && rule.ingestModes.length > 0
        ? rule.ingestModes
        : ['always_on'];

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
            id: 'default-always-on',
            enabled: true,
            targetId: LEGACY_MONITORING_TARGET_ID,
            scope: 'global',
            events: ['offline', 'online'],
            ingestModes: ['always_on'],
        });
    }

    return {
        ...settings,
        notificationTargets: Array.from(targetByChatId.values()),
        notificationRules: rules,
    };
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
            lines.push(`${index + 1}. ${camera.name}`);
        });
        if (areaCameras.length > 20) {
            lines.push(`...dan ${areaCameras.length - 20} kamera lainnya`);
        }
        lines.push('');
    }

    lines.push(formatDateTime(new Date()));
    return lines.join('\n').trim();
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
            settingsCache = normalizeTelegramSettings({
                botToken: '',
                monitoringChatId: '',
                feedbackChatId: '',
                enabled: false
            });
        }
        settingsCacheTime = now;
        return settingsCache;
    } catch (error) {
        console.error('[Telegram] Error reading settings:', error);
        return {
            botToken: '',
            monitoringChatId: '',
            feedbackChatId: '',
            enabled: false
        };
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
 * Send message to Telegram bot
 */
async function sendToTelegram(message, chatId) {
    const settings = getTelegramSettings();
    
    if (!settings.botToken || !chatId) {
        console.log('[Telegram] Bot not configured or chat ID missing');
        return false;
    }

    const url = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }),
        });

        const data = await response.json();
        
        if (!data.ok) {
            console.error('[Telegram] Failed:', data.description);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[Telegram] Error:', error.message);
        return false;
    }
}

export async function sendCameraStatusNotifications(eventType, cameras = []) {
    if (!VALID_EVENTS.has(eventType) || cameras.length === 0) {
        return false;
    }

    const settings = getTelegramSettings();
    if (!settings.botToken) {
        console.log('[Telegram] Bot not configured');
        return false;
    }

    const targetsById = new Map(settings.notificationTargets.map((target) => [target.id, target]));
    const camerasByChatId = new Map();

    for (const camera of cameras) {
        for (const rule of settings.notificationRules) {
            if (!ruleMatchesCamera(rule, camera, eventType)) {
                continue;
            }

            const target = targetsById.get(rule.targetId);
            if (!target?.chatId) {
                continue;
            }

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

        const cooldownKey = `camera_status_${eventType}_${target.chatId}_${targetCameras.map((camera) => camera.id).sort().join('_')}`;
        if (isInCooldown(cooldownKey)) {
            console.log(`[Telegram] Skipping ${eventType} group notification for ${target.name} (cooldown)`);
            continue;
        }

        const message = buildCameraStatusMessage(eventType, targetCameras, target.name);
        const sent = await sendToTelegram(message, target.chatId);
        if (sent) {
            setCooldown(cooldownKey);
            sentCount += 1;
        }
    }

    return sentCount > 0;
}

export async function sendMonitoringMessage(message) {
    const settings = getTelegramSettings();
    return sendToTelegram(message, settings.monitoringChatId);
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
    };
}

export default {
    sendMonitoringMessage,
    sendFeedbackMessage,
    sendTargetTestMessage,
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
